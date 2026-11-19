import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import { START_FEN, type BoardOrientation } from './ChessBoardWrapper';
import { BoardSlot } from '../board/PersistentBoard';
import LineQuiz from './LineQuiz';
import { nagToSymbol } from '../pgn/index.ts';
import {
  chapterLearned,
  chapterQuizSegments,
  readStudyProgress,
  recordDrill,
  writeStudyProgress,
} from '../courses/courseService';
import { db, type LineProgress } from '../db';
import { useAppearance } from '../theme/ThemeProvider';
import type { CourseChapter, CoursePly, PgnCourseRecord } from '../courses/types';
import './StudyView.css';

/**
 * Three-column study screen.
 *
 *   rail   — course title, priority filter, chapter progress, step list
 *   stage  — square board, annotation overlay, study banner with Next
 *   panel  — move text, coaching notes, alternatives, utility toolbar
 *
 * All chapter data comes from the PGN import (`src/courses/courseService`),
 * so the screen never parses at render time.
 */

const RANK_FILE = 'abcdefgh';
const STEP_SIZE = 3;
/* The rail shows the active chapter's neighbourhood first. A 40-chapter study
   should not turn the navigation into an endless wall on entry. */
const CHAPTER_WINDOW = 6;

interface DrawnArrow {
  startSquare: string;
  endSquare: string;
}

function annotate(ply: CoursePly | undefined): string {
  if (!ply) return '';
  return ply.nags.map((nag) => nagToSymbol(nag)).join('');
}

/** Rebuilds a re-importable PGN for the current chapter. */
function chapterToPgn(chapter: CourseChapter): string {
  const headers = { ...chapter.headers };
  if (chapter.starting_fen) {
    headers.SetUp = '1';
    headers.FEN = chapter.starting_fen;
  }
  const tagLines = Object.entries(headers).map(
    ([name, value]) => `[${name} "${String(value).replace(/"/g, "'")}"]`,
  );
  const parts: string[] = [];
  for (const ply of chapter.plies) {
    if (ply.color === 'w') parts.push(`${ply.move_number}.`);
    parts.push(ply.comment ? `${ply.san} {${ply.comment}}` : ply.san);
  }
  parts.push(chapter.result || '*');
  return `${tagLines.join('\n')}\n\n${parts.join(' ')}\n`;
}

function bookmarkKey(courseId: string, chapterId: string): string {
  return `chess-trainer.study-bookmarks.${courseId}.${chapterId}`;
}

export interface StudyViewProps {
  course: PgnCourseRecord;
  initialChapterId?: string | null;
  onExit: () => void;
  onNotify: (message: string, tone?: 'success' | 'error') => void;
  onOpenSettings: () => void;
  onOpenReview: () => void;
}

function StudyView({
  course,
  initialChapterId,
  onExit,
  onNotify,
  onOpenSettings,
  onOpenReview,
}: StudyViewProps) {
  const { soundOn, setSoundOn } = useAppearance();

  const startIndex = Math.max(
    0,
    course.chapters.findIndex((entry) => entry.chapter_id === initialChapterId),
  );

  const [chapterIndex, setChapterIndex] = useState(startIndex);
  const [plyIndex, setPlyIndex] = useState(-1);
  /* The course knows which side it is written for; the board faces that way. */
  const [orientation, setOrientation] = useState<BoardOrientation>(
    course.repertoire_color === 'b' ? 'black' : 'white',
  );
  const [quizOpen, setQuizOpen] = useState(false);
  /* Phones start with the chapter shelf folded so the board is the first thing
     on screen; tablets and desktops keep it open. */
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.matchMedia('(max-width: 720px)').matches;
    } catch {
      return false;
    }
  });
  const [priorityOnly, setPriorityOnly] = useState(false);
  const [showAllChapters, setShowAllChapters] = useState(false);
  const [suggestionOn, setSuggestionOn] = useState(true);
  const [drawMode, setDrawMode] = useState(false);
  const [drawn, setDrawn] = useState<DrawnArrow[]>([]);
  const [pendingArrow, setPendingArrow] = useState<string | null>(null);
  const [bookmarks, setBookmarks] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState<Record<string, number>>({});
  /* Quiz results per chapter, so the rail can tell read-only from learned. */
  const [tests, setTests] = useState<Record<string, LineProgress>>({});
  /* A written side line opened from the coaching panel: main-line ply it
     replaces, which alternative, and how far into it the reader has stepped. */
  const [sideLine, setSideLine] = useState<{ ply: number; alt: number; step: number } | null>(
    null,
  );


  const studyRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  const chapter = course.chapters[chapterIndex];
  const nextChapter = course.chapters[chapterIndex + 1];
  const plies = chapter?.plies ?? [];
  const startFen = chapter?.starting_fen ?? START_FEN;

  const fen = plyIndex >= 0 && plies[plyIndex] ? plies[plyIndex].fen_after : startFen;
  const activePly = plyIndex >= 0 ? plies[plyIndex] : undefined;
  const nextPly = plies[plyIndex + 1];

  /* The board can be stepping a side line instead of the main line. Both views
     share the stage, the banner and the notation panel. */
  const sideVariation = sideLine ? plies[sideLine.ply]?.alternatives?.[sideLine.alt] : undefined;
  const showingSide = Boolean(sideLine && sideVariation);
  const sidePly = showingSide && sideLine ? sideVariation?.plies[sideLine.step] : undefined;
  const sideStartFen =
    sideVariation?.plies[0]?.fen_before ??
    (sideLine ? plies[sideLine.ply]?.fen_before : undefined) ??
    startFen;
  const viewFen = showingSide ? (sidePly ? sidePly.fen_after : sideStartFen) : fen;
  const viewPly = showingSide ? sidePly : activePly;
  const viewNext = showingSide ? sideVariation?.plies[(sideLine?.step ?? -1) + 1] : nextPly;
  const viewLastMove = viewPly
    ? { from: viewPly.uci.slice(0, 2), to: viewPly.uci.slice(2, 4) }
    : null;

  /* ------------------------------- progress ------------------------------- */

  useEffect(() => {
    setProgress(readStudyProgress(course.course_id));
    setSideLine(null);
    let alive = true;
    void db.line_progress
      .where('course_id')
      .equals(course.course_id)
      .toArray()
      .then((rows) => {
        if (alive) setTests(Object.fromEntries(rows.map((row) => [row.chapter_id, row])));
      })
      .catch(() => {
        if (alive) setTests({});
      });
    return () => {
      alive = false;
    };
  }, [course.course_id]);

  useEffect(() => {
    if (!chapter) return;
    setProgress((current) => {
      const best = Math.max(current[chapter.chapter_id] ?? -1, plyIndex);
      if (best === (current[chapter.chapter_id] ?? -1)) return current;
      return { ...current, [chapter.chapter_id]: best };
    });
  }, [chapter, plyIndex]);

  /* Debounced persistence: stepping quickly leaves a single write behind. */
  useEffect(() => {
    const timer = setTimeout(() => {
      writeStudyProgress(course.course_id, progress);
    }, 400);
    return () => clearTimeout(timer);
  }, [course.course_id, progress]);

  useEffect(() => {
    if (!chapter) return;
    try {
      const raw = localStorage.getItem(bookmarkKey(course.course_id, chapter.chapter_id));
      setBookmarks(new Set(raw ? (JSON.parse(raw) as number[]) : []));
    } catch {
      setBookmarks(new Set());
    }
    setDrawn([]);
    setPendingArrow(null);
    setSideLine(null);
  }, [chapter, course.course_id]);

  const persistBookmarks = useCallback(
    (next: Set<number>) => {
      setBookmarks(next);
      if (!chapter) return;
      try {
        localStorage.setItem(
          bookmarkKey(course.course_id, chapter.chapter_id),
          JSON.stringify([...next]),
        );
      } catch {
        /* storage is optional */
      }
    },
    [chapter, course.course_id],
  );

  /* ------------------------------ navigation ------------------------------ */

  const goTo = useCallback(
    (next: number) => {
      setSideLine(null);
      setPlyIndex(Math.max(-1, Math.min(plies.length - 1, next)));
    },
    [plies.length],
  );

  /* Stepping a side line is a separate cursor from the main line, so leaving it
     returns the reader exactly where they were. */
  const stepSideLine = useCallback(
    (delta: number) => {
      setSideLine((current) => {
        if (!current) return current;
        const variation = plies[current.ply]?.alternatives?.[current.alt];
        if (!variation) return null;
        const step = Math.max(-1, Math.min(variation.plies.length - 1, current.step + delta));
        return { ...current, step };
      });
    },
    [plies],
  );

  const selectChapter = useCallback((index: number) => {
    setChapterIndex(index);
    setPlyIndex(-1);
    setDrawn([]);
    setPendingArrow(null);
    setSideLine(null);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (sideLine) {
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          stepSideLine(1);
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          stepSideLine(-1);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          setSideLine(null);
        }
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        goTo(plyIndex + 1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goTo(plyIndex - 1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        goTo(-1);
      } else if (event.key === 'End') {
        event.preventDefault();
        goTo(plies.length - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goTo, plies.length, plyIndex, sideLine, stepSideLine]);

  /* -------------------------------- arrows -------------------------------- */

  const arrows = useMemo(() => {
    const list = drawn.map((arrow) => ({ ...arrow, color: '#7fb2ff' }));
    if (suggestionOn && viewNext) {
      list.push({
        startSquare: viewNext.uci.slice(0, 2),
        endSquare: viewNext.uci.slice(2, 4),
        color: '#3f9a57',
      });
    }
    return list;
  }, [drawn, suggestionOn, viewNext]);

  const squareFromEvent = (event: MouseEvent<HTMLElement>): string | null => {
    const host = hostRef.current;
    if (!host) return null;
    const rect = host.getBoundingClientRect();
    const fx = (event.clientX - rect.left) / rect.width;
    const fy = (event.clientY - rect.top) / rect.height;
    if (fx < 0 || fx >= 1 || fy < 0 || fy >= 1) return null;
    const fileIndex = Math.min(7, Math.floor(fx * 8));
    const rankIndex = Math.min(7, Math.floor(fy * 8));
    const file = orientation === 'white' ? fileIndex : 7 - fileIndex;
    const rank = orientation === 'white' ? 8 - rankIndex : rankIndex + 1;
    return `${RANK_FILE[file]}${rank}`;
  };

  const handleArrowClick = (event: MouseEvent<HTMLElement>) => {
    const square = squareFromEvent(event);
    if (!square) return;
    if (!pendingArrow) {
      setPendingArrow(square);
      return;
    }
    if (pendingArrow !== square) {
      setDrawn((current) => [...current, { startSquare: pendingArrow, endSquare: square }]);
    }
    setPendingArrow(null);
  };

  /* ------------------------------- actions -------------------------------- */

  const steps = useMemo(() => {
    const out: Array<{ start: number; end: number; label: string; san: string }> = [];
    for (let index = 0; index < plies.length; index += STEP_SIZE) {
      const end = Math.min(plies.length - 1, index + STEP_SIZE - 1);
      out.push({
        start: index,
        end,
        label: `Moves ${plies[index].move_number} to ${plies[end].move_number}`,
        san: plies
          .slice(index, end + 1)
          .map((ply) => ply.san)
          .join(' '),
      });
    }
    return out;
  }, [plies]);

  const visibleChapters = useMemo(
    () =>
      course.chapters
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => !priorityOnly || entry.plies.some((ply) => ply.comment)),
    [course.chapters, priorityOnly],
  );

  const chapterWindow = useMemo(() => {
    if (showAllChapters || visibleChapters.length <= CHAPTER_WINDOW) return visibleChapters;
    const active = visibleChapters.findIndex(({ index }) => index === chapterIndex);
    const start = Math.max(
      0,
      Math.min(
        active < 0 ? 0 : active - Math.floor(CHAPTER_WINDOW / 2),
        visibleChapters.length - CHAPTER_WINDOW,
      ),
    );
    return visibleChapters.slice(start, start + CHAPTER_WINDOW);
  }, [chapterIndex, showAllChapters, visibleChapters]);

  const chapterPercent = (entry: CourseChapter): number => {
    if (entry.plies.length === 0) return 0;
    const reached = (progress[entry.chapter_id] ?? -1) + 1;
    return Math.round((reached / entry.plies.length) * 100);
  };

  /* Learned needs both halves of the loop: read to the end and tested. */
  const learnedChapters = useMemo(() => {
    const learned = new Set<string>();
    for (const entry of course.chapters) {
      const tested = tests[entry.chapter_id]?.attempts ?? 0;
      if (chapterLearned(entry, progress[entry.chapter_id], tested)) learned.add(entry.chapter_id);
    }
    return learned;
  }, [course.chapters, progress, tests]);

  const copyText = useCallback(
    async (text: string, message: string) => {
      try {
        await navigator.clipboard.writeText(text);
        onNotify(message);
      } catch {
        onNotify('Clipboard is unavailable in this browser.', 'error');
      }
    },
    [onNotify],
  );

  const handleFullscreen = () => {
    const element = studyRef.current;
    if (!element) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void element.requestFullscreen?.().catch(() => onNotify('Full screen was blocked.', 'error'));
  };

  const handleAnalyse = () => {
    if (!chapter) return;
    void copyText(chapterToPgn(chapter), 'Line copied — paste it into Game review.');
    onOpenReview();
  };

  const handleShare = () => {
    if (!chapter) return;
    void copyText(chapterToPgn(chapter), 'Chapter PGN copied to the clipboard.');
  };

  if (!chapter) {
    return (
      <div className="study study--empty">
        <p>This course has no chapters.</p>
        <button type="button" className="secondary-btn" onClick={onExit}>
          Back to library
        </button>
      </div>
    );
  }

  const atLineEnd = plies.length > 0 && plyIndex >= plies.length - 1;

  /* Chess speak, not parser speak: a line is counted in moves, and the active
     move is labelled with its number and the side that plays it. */
  const moveLabel = (ply: CoursePly | undefined): string =>
    ply ? `Move ${ply.move_number}${ply.color === 'b' ? '…' : '.'}` : 'Start';
  const depthLabel = showingSide ? moveLabel(sidePly) : moveLabel(activePly);
  const depthTotal = Math.ceil(
    (showingSide ? (sideVariation?.plies.length ?? 0) : plies.length) / 2,
  );
  const movesLabel = (count: number): string => `${count} move${count === 1 ? '' : 's'}`;
  const depthSummary =
    depthLabel === 'Start' ? `Start · ${movesLabel(depthTotal)}` : `${depthLabel} of ${depthTotal}`;

  /* Every written branch of the chapter, so the sidelines are visible from any
     move — not only the one that happens to carry them. Small enough to build
     on each render; a hook here would sit after an early return. */
  const chapterSideLines: Array<{
    ply: number;
    alt: number;
    san: string;
    comment: string;
    moves: number;
    prefix: string;
  }> = [];
  plies.forEach((ply, index) => {
    for (const [alt, variation] of (ply.alternatives ?? []).entries()) {
      chapterSideLines.push({
        ply: index,
        alt,
        san: variation.san,
        comment: variation.comment,
        moves: Math.ceil(variation.plies.length / 2),
        prefix: `${ply.move_number}${ply.color === 'w' ? '.' : '…'}`,
      });
    }
  });

  const activeAlternatives = activePly?.alternatives ?? [];

  const sideLabel =
    showingSide && sideLine && sideVariation
      ? `${plies[sideLine.ply]?.move_number ?? 0}${
          plies[sideLine.ply]?.color === 'w' ? '.' : '…'
        } ${sideVariation.san} instead of ${plies[sideLine.ply]?.san}`
      : '';

  const prompt =
    plies.length === 0
      ? 'This chapter starts from a position — study it, then step through the notes.'
      : plyIndex < 0
        ? 'Study this move. When ready click Next for the quiz!'
        : atLineEnd
          ? 'Line complete. Test it — the other side plays itself and you answer.'
          : activePly?.comment
            ? 'Read the coaching note, then click Next to keep the line going.'
            : 'Follow the main line: click Next to play the next move.';

  if (quizOpen && chapter) {
    return (
      <LineQuiz
        key={`${course.course_id}:${chapter.chapter_id}`}
        segments={chapterQuizSegments(chapter)}
        color={course.repertoire_color}
        title={chapter.title}
        subtitle={course.title}
        onExit={() => setQuizOpen(false)}
        onFinish={(result) => {
          void recordDrill(course.course_id, chapter.chapter_id, result.percent)
            .then(() => db.line_progress.where('course_id').equals(course.course_id).toArray())
            .then((rows) => setTests(Object.fromEntries(rows.map((row) => [row.chapter_id, row]))))
            .catch(() => {});
          onNotify(`Quiz saved — ${result.percent}% of your moves were clean.`);
        }}
        onNextChapter={() => {
          setQuizOpen(false);
          if (nextChapter) {
            selectChapter(chapterIndex + 1);
            onNotify(`Chapter passed — next up: ${nextChapter.title}`);
          } else {
            onNotify('Last chapter passed — the course is yours.');
          }
        }}
        nextLabel={nextChapter ? `next: ${nextChapter.title}` : 'the end of the course'}
      />
    );
  }

  return (
    <div className={`study${collapsed ? ' is-collapsed' : ''}`} ref={studyRef}>
      <h1 className="visually-hidden">Studying {course.title}</h1>

      {/* ------------------------------- rail ------------------------------- */}
      <aside className="study__rail" aria-label="Course chapters">
        <header className="study__rail-head">
          <button type="button" className="study__icon" onClick={onExit} title="Back to courses" aria-label="Back to courses">
            ←
          </button>
          {!collapsed && (
            <div className="study__rail-title">
              <span>Course</span>
              <strong title={course.title}>{course.title}</strong>
            </div>
          )}
          <button
            type="button"
            className="study__icon"
            onClick={() => setCollapsed((current) => !current)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand chapter panel' : 'Collapse chapter panel'}
            title={collapsed ? 'Expand chapter panel' : 'Collapse chapter panel'}
          >
            {collapsed ? '»' : '«'}
          </button>
        </header>

        {collapsed ? (
          <div className="study__rail-mini" aria-hidden="true">
            <span>{course.chapters.length}</span>
            <em>chapters</em>
          </div>
        ) : (
          <>
            <label className="study__switch">
              <input
                type="checkbox"
                checked={priorityOnly}
                onChange={(event) => setPriorityOnly(event.target.checked)}
              />
              <span>Priority lines</span>
              <em>
                {course.chapters.filter((entry) => entry.plies.some((ply) => ply.comment)).length}
              </em>
            </label>

            <div className="study__chapter-shelf">
              <div className="study__chapters-head">
                <h3>Chapters</h3>
                <span>{visibleChapters.length}</span>
              </div>

              <div className="study__chapters">
                {chapterWindow.map(({ entry, index }) => {
                const percent = chapterPercent(entry);
                return (
                  <button
                    key={entry.chapter_id}
                    type="button"
                    className={`study__chapter${index === chapterIndex ? ' is-active' : ''}`}
                    aria-current={index === chapterIndex}
                    onClick={() => selectChapter(index)}
                  >
                    <span className="study__chapter-top">
                      <span className="study__chapter-name">{entry.title}</span>
                      {learnedChapters.has(entry.chapter_id) && (
                        <span className="study__chapter-learned">Learned</span>
                      )}
                      <span className="study__chapter-pct">{percent}%</span>
                    </span>
                    <span className="study__chapter-bar">
                      <span style={{ width: `${percent}%` }} />
                    </span>
                    <span className="study__chapter-meta">
                      {Math.ceil(entry.plies.length / 2)} moves · {entry.result}
                    </span>
                  </button>
                );
              })}
                {visibleChapters.length === 0 && (
                  <p className="study__rail-empty">No annotated chapters in this course.</p>
                )}
              </div>

              {visibleChapters.length > CHAPTER_WINDOW && (
                <button
                  type="button"
                  className="study__chapters-toggle"
                  onClick={() => setShowAllChapters((current) => !current)}
                >
                  {showAllChapters
                    ? 'Show fewer chapters'
                    : `Show all ${visibleChapters.length} chapters`}
                </button>
              )}
            </div>

            <div className="study__steps">
              <h3>Steps in this chapter</h3>
              <div className="study__step-list">
                {steps.map((step) => {
                  const done = plyIndex >= step.end;
                  return (
                    <button
                      key={step.start}
                      type="button"
                      className={`study__step${done ? ' is-done' : ''}${
                        plyIndex >= step.start && plyIndex <= step.end ? ' is-current' : ''
                      }`}
                      onClick={() => goTo(step.end)}
                    >
                      <span className="study__step-label">{step.label}</span>
                      <span className="study__step-san" title={step.san}>
                        {step.san}
                      </span>
                      <span className="study__step-dot" aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </aside>

      {/* ------------------------------- stage ------------------------------ */}
      <div className="study__stage">
        {/* Status bar above the board: the same anchor every room has, so the
            board sits at the same height in Courses as in Play or Review. */}
        <div className="study__board-head">
          <div className="study__board-head-title">
            <strong title={chapter?.title}>{chapter?.title ?? 'Chapter'}</strong>
            <span>
              {depthSummary}
              {showingSide ? ' · side line' : ''}
            </span>
          </div>
        </div>

        <div className="study__board-host">
          {/* Exactly the board, centred in the column: the drawing layer and the
              click-to-square maths both ride on this box, so they stay aligned
              at every scale. */}
          <div className="study__board-frame" ref={hostRef}>
            <BoardSlot
              props={{
                fen: viewFen,
                orientation,
                interactive: false,
                arrows,
                lastMove: viewLastMove,
                highlightLastMove: Boolean(viewPly),
              }}
            />
            {drawMode && (
              <button
                type="button"
                className={`study__arrow-layer${pendingArrow ? ' is-armed' : ''}`}
                aria-label="Draw an arrow: choose a start square, then an end square"
                onClick={handleArrowClick}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setPendingArrow(null);
                }}
              />
            )}
          </div>
        </div>

        <div className="study__board-tools">
          <button
            type="button"
            className={`study__tool${suggestionOn ? ' is-on' : ''}`}
            aria-pressed={suggestionOn}
            onClick={() => setSuggestionOn((current) => !current)}
            title="Show the idea arrow for the next move"
          >
            ➤ Idea arrow
          </button>
          <button
            type="button"
            className={`study__tool${drawMode ? ' is-on' : ''}`}
            aria-pressed={drawMode}
            onClick={() => {
              setDrawMode((current) => !current);
              setPendingArrow(null);
            }}
            title="Click two squares to draw your own arrow"
          >
            ✎ Draw arrow
          </button>
          {drawn.length > 0 && (
            <button
              type="button"
              className="study__tool"
              onClick={() => setDrawn([])}
              title="Remove the arrows you drew"
            >
              Clear ({drawn.length})
            </button>
          )}
        </div>

        <div className="study__banner">
          {showingSide ? (
            <>
              <p>
                <strong>Side line:</strong> {sideLabel}. Step through it — the chapter
                test asks for these moves too.
              </p>
              <div className="study__banner-actions">
                <button
                  type="button"
                  className="study__nav"
                  onClick={() => stepSideLine(-1)}
                  disabled={(sideLine?.step ?? -1) <= -1}
                  aria-label="Previous side-line move"
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="study__next"
                  onClick={() => stepSideLine(1)}
                  disabled={(sideLine?.step ?? -1) >= (sideVariation?.plies.length ?? 0) - 1}
                >
                  Next move
                  <span className="study__next-chevron" aria-hidden="true">
                    ›
                  </span>
                </button>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setSideLine(null)}
                >
                  Main line
                </button>
              </div>
            </>
          ) : (
            <>
              <p>{prompt}</p>
              <div className="study__banner-actions">
                <button
                  type="button"
                  className="study__nav"
                  onClick={() => goTo(plyIndex - 1)}
                  disabled={plyIndex <= -1}
                  aria-label="Previous move"
                >
                  ‹
                </button>
                {atLineEnd ? (
                  <button type="button" className="study__next" onClick={() => setQuizOpen(true)}>
                    Test chapter
                    <span className="study__next-chevron" aria-hidden="true">
                      ›
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="study__next"
                    onClick={() => goTo(plyIndex + 1)}
                    disabled={plies.length === 0}
                  >
                    Next move
                    <span className="study__next-chevron" aria-hidden="true">
                      ›
                    </span>
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ------------------------------- panel ------------------------------ */}
      <aside className="study__panel" aria-label="Notation and coaching">
        <header className="study__panel-head">
          <div>
            <span className="study__eyebrow">{showingSide ? 'Side line' : 'Line depth'}</span>
            <strong className="study__depth-label">{depthSummary}</strong>
          </div>
          <div className="study__panel-actions">
            <button
              type="button"
              className={`study__icon${activePly && bookmarks.has(plyIndex) ? ' is-on' : ''}`}
              onClick={() => {
                if (!activePly) return;
                const next = new Set(bookmarks);
                if (next.has(plyIndex)) next.delete(plyIndex);
                else next.add(plyIndex);
                persistBookmarks(next);
              }}
              disabled={!activePly}
              aria-pressed={Boolean(activePly && bookmarks.has(plyIndex))}
              title="Bookmark this move"
              aria-label="Bookmark this move"
            >
              {activePly && bookmarks.has(plyIndex) ? '★' : '☆'}
            </button>
            <button
              type="button"
              className="study__icon"
              onClick={() => setQuizOpen(true)}
              disabled={plies.length === 0}
              title="Test this chapter"
              aria-label="Test this chapter"
            >
              ▶
            </button>
          </div>
        </header>

        <div className="study__depth" aria-hidden="true">
          <span
            style={{
              width: `${
                showingSide
                  ? sideVariation?.plies.length
                    ? (((sideLine?.step ?? 0) + 1) / sideVariation.plies.length) * 100
                    : 0
                  : plies.length
                    ? ((plyIndex + 1) / plies.length) * 100
                    : 0
              }%`,
            }}
          />
        </div>

        {showingSide && sideVariation && (
          <div className="study__sidelabel">
            <span>{sideLabel}</span>
            <button
              type="button"
              className="study__linkbtn"
              onClick={() => setSideLine(null)}
            >
              Back to main line
            </button>
          </div>
        )}

        <div className="study__moves" role="group" aria-label={showingSide ? 'Side line' : 'Main line'}>
          {(showingSide && sideVariation ? sideVariation.plies : plies).map((ply, index) => {
            const current = showingSide ? index === sideLine?.step : index === plyIndex;
            const past = showingSide ? index < (sideLine?.step ?? -1) : index < plyIndex;
            const marked = !showingSide && bookmarks.has(index);
            return (
              <button
                key={`${ply.uci}-${index}`}
                type="button"
                className={`study__ply${current ? ' is-current' : ''}${past ? ' is-past' : ''}${
                  marked ? ' is-marked' : ''
                }`}
                onClick={() => {
                  if (showingSide && sideLine) setSideLine({ ...sideLine, step: index });
                  else goTo(index);
                }}
              >
                {ply.color === 'w' && <span className="study__ply-no">{ply.move_number}.</span>}
                <span className="study__ply-san">{ply.san}</span>
                <span className="study__ply-nag">{annotate(ply)}</span>
                {!showingSide && (ply.alternatives?.length ?? 0) > 0 && (
                  <span
                    className="study__ply-alt"
                    aria-label="has side lines"
                    title={`${ply.alternatives?.length} side line${
                      (ply.alternatives?.length ?? 0) === 1 ? '' : 's'
                    }`}
                  >
                    ↳
                  </span>
                )}
                {ply.comment && <span className="study__ply-note" aria-label="has a note" />}
              </button>
            );
          })}
          {!showingSide && plies.length === 0 && (
            <p className="study__rail-empty">Position only.</p>
          )}
        </div>

        <div className="study__coach">
          <h3>{showingSide ? 'Side line' : 'Why this move'}</h3>
          <p>
            {viewPly?.comment ||
              (showingSide
                ? 'This written alternative is part of the chapter — step through it above.'
                : 'Step onto a move with a note to read the coach’s explanation.')}
          </p>

          {!showingSide && (
            <div className="study__alts">
              <h4>
                Side lines
                <span className="study__alts-count">
                  {activeAlternatives.length || chapterSideLines.length}
                </span>
              </h4>
              {activeAlternatives.length > 0 ? (
                <ul>
                  {activeAlternatives.map((alt, index) => (
                    <li key={`${alt.san}-${index}`}>
                      <button
                        type="button"
                        className="study__alt"
                        onClick={() => setSideLine({ ply: plyIndex, alt: index, step: -1 })}
                      >
                        <strong>{alt.san}</strong>
                        <span>{alt.comment || 'Also playable in this position.'}</span>
                        <em>{movesLabel(Math.ceil(alt.plies.length / 2))}</em>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : chapterSideLines.length > 0 ? (
                <>
                  <p className="study__alts-hint">
                    No branch on this move — the chapter breaks off here:
                  </p>
                  <ul>
                    {chapterSideLines.slice(0, 6).map((entry) => (
                      <li key={`${entry.ply}-${entry.alt}`}>
                        <button
                          type="button"
                          className="study__alt"
                          onClick={() => {
                            goTo(entry.ply);
                            setSideLine({ ply: entry.ply, alt: entry.alt, step: -1 });
                          }}
                        >
                          <strong>
                            {entry.prefix} {entry.san}
                          </strong>
                          <span>{entry.comment || 'Alternative in this position.'}</span>
                          <em>{movesLabel(entry.moves)}</em>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="study__alts-hint">No sidelines written in this chapter.</p>
              )}
            </div>
          )}
        </div>

        <footer className="study__toolbar">
          <button type="button" className="study__icon" onClick={onOpenSettings} title="Settings" aria-label="Settings">
            ⚙
          </button>
          <button
            type="button"
            className="study__icon"
            onClick={() => setOrientation((current) => (current === 'white' ? 'black' : 'white'))}
            title="Flip board"
            aria-label="Flip board"
          >
            ⇅
          </button>
          <button
            type="button"
            className={`study__icon${soundOn ? ' is-on' : ''}`}
            aria-pressed={soundOn}
            onClick={() => setSoundOn(!soundOn)}
            title={soundOn ? 'Mute sounds' : 'Unmute sounds'}
            aria-label={soundOn ? 'Mute sounds' : 'Unmute sounds'}
          >
            {soundOn ? '◉' : '◌'}
          </button>
          <button
            type="button"
            className="study__icon"
            onClick={handleFullscreen}
            title="Full screen"
            aria-label="Full screen"
          >
            ⛶
          </button>
          <button
            type="button"
            className="study__icon"
            onClick={handleAnalyse}
            title="Analyse this line in Game review"
            aria-label="Analyse this line in Game review"
          >
            ⌕
          </button>
          <button
            type="button"
            className="study__icon"
            onClick={handleShare}
            title="Copy chapter PGN"
            aria-label="Copy chapter PGN"
          >
            ⇪
          </button>
        </footer>
      </aside>
    </div>
  );
}

export default memo(StudyView);
