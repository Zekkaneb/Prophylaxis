import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import type { Move } from 'chess.js';
import {
  START_FEN,
  type BoardArrow,
  type BoardOrientation,
  type BoardMove,
} from './ChessBoardWrapper';
import { BoardSlot, useBoardHandle } from '../board/PersistentBoard';
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
 * Course player — one shell, two passes.
 *
 *   learn  — the line plays itself move by move, pausing on every written note
 *            and on every branch until the branch has been walked. The side the
 *            course is written for is yours: those moves are played on the
 *            board, the other side answers by itself.
 *   review — the same rail, board and panel with the answers hidden: the other
 *            side plays, you reproduce your moves, and a finished chapter hands
 *            straight over to the next one.
 *
 * Both passes share the three-column stage, so moving between reading and
 * testing changes what the screen does, never where everything is.
 */

const RANK_FILE = 'abcdefgh';
const STEP_SIZE = 3;
/* The rail shows the active chapter's neighbourhood first. A 40-chapter study
   should not turn the navigation into an endless wall on entry. */
const CHAPTER_WINDOW = 6;
/** A pause after an auto-played move, so the eye can follow it. */
const AUTO_DELAY_MS = 640;
/** The opponent's move in review waits a little less: it is not a lesson. */
const REVIEW_DELAY_MS = 420;
/** How long the passed-chapter strip stays up before the hand-off. */
const ADVANCE_DELAY_MS = 1150;
/** Hint the piece after this many wrong tries; play it for them after five. */
const HINT_AFTER = 3;
const REVEAL_AFTER = 5;

export type StudyMode = 'learn' | 'quiz';

interface DrawnArrow {
  startSquare: string;
  endSquare: string;
}

function annotate(ply: CoursePly | undefined): string {
  if (!ply) return '';
  return ply.nags.map((nag) => nagToSymbol(nag)).join('');
}

function uciOf(move: Move): string {
  return `${move.from}${move.to}${move.promotion ?? ''}`;
}

function arrowFor(uci: string | undefined, color: string): BoardArrow | null {
  if (!uci) return null;
  return { startSquare: uci.slice(0, 2), endSquare: uci.slice(2, 4), color };
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

function sideName(color: 'w' | 'b'): string {
  return color === 'w' ? 'White' : 'Black';
}

export interface StudyViewProps {
  course: PgnCourseRecord;
  /** Open straight into reading or straight into the review pass. */
  initialMode?: StudyMode;
  onExit: () => void;
  onNotify: (message: string, tone?: 'success' | 'error') => void;
  onOpenSettings: () => void;
  onOpenReview: () => void;
}

function StudyView({
  course,
  initialMode = 'learn',
  onExit,
  onNotify,
  onOpenSettings,
  onOpenReview,
}: StudyViewProps) {
  const { soundOn, setSoundOn } = useAppearance();
  const boardRef = useBoardHandle();

  const [chapterIndex, setChapterIndex] = useState(0);
  const [mode, setMode] = useState<StudyMode>(initialMode);
  /* The course knows which side it is written for; the board faces that way. */
  const [orientation, setOrientation] = useState<BoardOrientation>(
    course.repertoire_color === 'b' ? 'black' : 'white',
  );
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

  const studyRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  const chapter = course.chapters[chapterIndex];
  const nextChapter = course.chapters[chapterIndex + 1];
  const plies = chapter?.plies ?? [];
  const startFen = chapter?.starting_fen ?? START_FEN;
  const myColor = course.repertoire_color;
  const otherColor = myColor === 'w' ? 'b' : 'w';

  /* -------------------------------- reading -------------------------------- */

  /* Cursor of the last move on the board; -1 is the chapter's first position. */
  const [cursor, setCursor] = useState(-1);
  /* A written branch opened from the coaching panel: which main-line ply it
     replaces, which alternative, and how far into it the reader has stepped. */
  const [sideLine, setSideLine] = useState<{ ply: number; alt: number; step: number } | null>(
    null,
  );
  /* Branches already walked to their end, keyed `ply:alt`. */
  const [walked, setWalked] = useState<Set<string>>(new Set());
  /* Notes already read, keyed by the ply they annotate. */
  const [notesSeen, setNotesSeen] = useState<Set<number>>(new Set());
  const [auto, setAuto] = useState(true);
  const [wrong, setWrong] = useState(0);
  const [hint, setHint] = useState<BoardArrow | null>(null);
  const [flash, setFlash] = useState('');

  /* -------------------------------- review --------------------------------- */

  const [quizSegment, setQuizSegment] = useState(0);
  const [quizMove, setQuizMove] = useState(0);
  const [quizAsked, setQuizAsked] = useState(0);
  const [quizClean, setQuizClean] = useState(0);
  const [quizMistakes, setQuizMistakes] = useState(0);
  const [quizHint, setQuizHint] = useState<BoardArrow | null>(null);
  const [quizMessage, setQuizMessage] = useState('Watch the reply, then play your move.');
  const [quizDone, setQuizDone] = useState(false);
  const [quizResult, setQuizResult] = useState<{
    asked: number;
    clean: number;
    percent: number;
  } | null>(null);

  const quizMistakeRef = useRef(0);
  const quizTurnFen = useRef<string | null>(null);
  const quizFinished = useRef(false);
  const quizAutoPlaying = useRef(false);

  /* ------------------------------ derived line ----------------------------- */

  const learnPly = cursor >= 0 ? plies[cursor] : undefined;
  const learnNext = plies[cursor + 1];
  const positionFen = learnPly ? learnPly.fen_after : startFen;

  const side = sideLine ? plies[sideLine.ply]?.alternatives?.[sideLine.alt] : undefined;
  const sidePly = side && sideLine ? side.plies[sideLine.step] : undefined;
  const sideStartFen =
    side?.plies[0]?.fen_before ?? (sideLine ? plies[sideLine.ply]?.fen_before : undefined) ?? startFen;
  const showingSide = Boolean(side && sideLine);
  const viewFen = showingSide ? (sidePly ? sidePly.fen_after : sideStartFen) : positionFen;
  const viewPly = showingSide ? sidePly : learnPly;
  const viewLastMove: BoardMove | null = viewPly
    ? { from: viewPly.uci.slice(0, 2), to: viewPly.uci.slice(2, 4) }
    : null;

  const branchCount = learnPly?.alternatives?.length ?? 0;
  const unwalked = (learnPly?.alternatives ?? [])
    .map((entry, index) => ({ entry, index }))
    .filter(({ index }) => !walked.has(`${cursor}:${index}`));

  const atEnd = plies.length > 0 && cursor >= plies.length - 1;
  const noteUnread = Boolean(learnPly?.comment) && !notesSeen.has(cursor);
  const yourMove = Boolean(learnNext) && learnNext.color === myColor;
  /* A note or an unexplored branch holds the line until it is dealt with. */
  const paused = !showingSide && (noteUnread || unwalked.length > 0);
  const canPlay = !showingSide && !paused && !atEnd && yourMove;

  const quizSegmentsAll = useMemo(
    () => (chapter ? chapterQuizSegments(chapter) : []),
    [chapter],
  );
  const ownSegments = useMemo(
    () => quizSegmentsAll.filter((entry) => entry.moves.some((move) => move.color === myColor)),
    [quizSegmentsAll, myColor],
  );
  const oppositeSegments = useMemo(
    () => quizSegmentsAll.filter((entry) => entry.moves.some((move) => move.color === otherColor)),
    [quizSegmentsAll, otherColor],
  );
  /* A study is usually written for one side, and the course's colour toggle can
     point at the other one. Asking the side that actually has moves beats a
     quiz that can never ask anything. */
  const switchedSide = ownSegments.length === 0 && oppositeSegments.length > 0;
  const quizSegments = switchedSide ? oppositeSegments : ownSegments;
  const quizColor = switchedSide ? otherColor : myColor;
  const quizLine = quizSegments[quizSegment];
  const quizExpected = quizLine?.moves[quizMove];
  const quizTotal = useMemo(
    () =>
      quizSegments.reduce(
        (total, entry) => total + entry.moves.filter((move) => move.color === quizColor).length,
        0,
      ),
    [quizColor, quizSegments],
  );

  /* ------------------------------- progress ------------------------------- */

  useEffect(() => {
    setProgress(readStudyProgress(course.course_id));
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

  /* Reading progress only moves in the reading pass; a review run does not
     count as having read the chapter. */
  useEffect(() => {
    if (mode !== 'learn' || !chapter) return;
    setProgress((current) => {
      const best = Math.max(current[chapter.chapter_id] ?? -1, cursor);
      if (best === (current[chapter.chapter_id] ?? -1)) return current;
      return { ...current, [chapter.chapter_id]: best };
    });
  }, [chapter, cursor, mode]);

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

  const resetReading = useCallback(() => {
    setCursor(-1);
    setSideLine(null);
    setWalked(new Set());
    setNotesSeen(new Set());
    setAuto(true);
    setWrong(0);
    setHint(null);
    setFlash('');
    setDrawn([]);
    setPendingArrow(null);
  }, []);

  const resetQuiz = useCallback(() => {
    quizFinished.current = false;
    quizMistakeRef.current = 0;
    quizTurnFen.current = null;
    setQuizSegment(0);
    setQuizMove(0);
    setQuizAsked(0);
    setQuizClean(0);
    setQuizMistakes(0);
    setQuizHint(null);
    setQuizDone(false);
    setQuizResult(null);
    setQuizMessage('Watch the reply, then play your move.');
  }, []);

  const selectChapter = useCallback(
    (index: number) => {
      setChapterIndex(index);
      resetReading();
      resetQuiz();
    },
    [resetQuiz, resetReading],
  );

  const startQuiz = useCallback(() => {
    resetQuiz();
    setMode('quiz');
  }, [resetQuiz]);

  const backToReading = useCallback(() => {
    resetQuiz();
    setMode('learn');
    setAuto(true);
  }, [resetQuiz]);

  const goTo = useCallback(
    (next: number) => {
      setSideLine(null);
      setCursor(Math.max(-1, Math.min(plies.length - 1, next)));
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

  /* A branch counts as explored once its last move is on the board. */
  useEffect(() => {
    if (!sideLine) return;
    const variation = plies[sideLine.ply]?.alternatives?.[sideLine.alt];
    if (!variation) return;
    if (sideLine.step < variation.plies.length - 1) return;
    const key = `${sideLine.ply}:${sideLine.alt}`;
    setWalked((current) => {
      if (current.has(key)) return current;
      const next = new Set(current);
      next.add(key);
      return next;
    });
  }, [plies, sideLine]);

  /* ------------------------------- autoplay ------------------------------- */

  useEffect(() => {
    if (mode !== 'learn' || showingSide || !auto || paused || atEnd) return;
    const next = plies[cursor + 1];
    if (!next || next.color === myColor) return;
    const handle = boardRef.current;
    if (!handle) return;

    const at = cursor;
    const timer = window.setTimeout(() => {
      void handle.playMoves([next.uci], { intervalMs: 240 }).then((ok) => {
        if (ok) setCursor((current) => (current === at ? current + 1 : current));
      });
    }, AUTO_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [atEnd, auto, boardRef, cursor, mode, myColor, paused, plies, showingSide]);

  /* Any wrong answer puts the line back where it was. */
  const settleBoard = useCallback(() => {
    boardRef.current?.reset(positionFen);
  }, [boardRef, positionFen]);

  const advanceLesson = useCallback(() => {
    const next = plies[cursor + 1];
    if (!next) return;
    const at = cursor;
    setWrong(0);
    setHint(null);
    setFlash('');
    void boardRef.current?.playMoves([next.uci], { intervalMs: 140 }).then((ok) => {
      if (ok) setCursor((current) => (current === at ? current + 1 : current));
    });
  }, [boardRef, cursor, plies]);

  const continueLine = useCallback(() => {
    if (unwalked.length > 0) {
      setFlash(
        `${unwalked.length} side line${unwalked.length === 1 ? '' : 's'} still to explore — open each and step to its end.`,
      );
      return;
    }
    setNotesSeen((current) => {
      if (current.has(cursor)) return current;
      const next = new Set(current);
      next.add(cursor);
      return next;
    });
    setFlash('');
    setAuto(true);
  }, [cursor, unwalked.length]);

  const primaryAction = useCallback(() => {
    if (showingSide) {
      const lastStep = (side?.plies.length ?? 0) - 1;
      if ((sideLine?.step ?? -1) >= lastStep) setSideLine(null);
      else stepSideLine(1);
      return;
    }
    if (paused) {
      continueLine();
      return;
    }
    if (atEnd) {
      startQuiz();
      return;
    }
    advanceLesson();
  }, [
    advanceLesson,
    atEnd,
    continueLine,
    paused,
    side,
    showingSide,
    sideLine,
    startQuiz,
    stepSideLine,
  ]);

  const stepBack = useCallback(() => {
    /* Browsing backwards stops the auto-play, so the line does not slide out
       from under the position being read. */
    setAuto(false);
    if (showingSide) stepSideLine(-1);
    else goTo(cursor - 1);
  }, [cursor, goTo, showingSide, stepSideLine]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (mode !== 'learn') return;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        primaryAction();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        stepBack();
      } else if (event.key === 'Home') {
        event.preventDefault();
        setAuto(false);
        goTo(-1);
      } else if (event.key === 'End') {
        event.preventDefault();
        setAuto(false);
        goTo(plies.length - 1);
      } else if (event.key === 'Escape' && sideLine) {
        event.preventDefault();
        setSideLine(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goTo, mode, plies.length, primaryAction, sideLine, stepBack]);

  /* ----------------------------- board handlers ---------------------------- */

  const handleLearnMove = useCallback(
    (move: Move) => {
      if (mode !== 'learn' || showingSide) return;
      const expected = plies[cursor + 1];
      if (!expected || expected.color !== myColor) return;

      if (uciOf(move) === expected.uci) {
        setWrong(0);
        setHint(null);
        setFlash('');
        setCursor(cursor + 1);
        return;
      }

      const attempts = wrong + 1;
      setWrong(attempts);
      settleBoard();

      if (attempts >= REVEAL_AFTER) {
        setFlash(`That move was ${expected.san} — playing it for you.`);
        setWrong(0);
        setHint(null);
        void boardRef.current
          ?.playMoves([expected.uci], { intervalMs: 140 })
          .then((ok) => {
            if (ok) setCursor((current) => (current === cursor ? current + 1 : current));
          });
        return;
      }

      if (attempts >= HINT_AFTER) {
        setHint(arrowFor(expected.uci, '#d8b87d'));
        setFlash(`Not that one — the piece with the arrow plays ${expected.san}.`);
        return;
      }

      setFlash('Not the move this line plays. Try again, or press Next move to see it.');
    },
    [boardRef, cursor, mode, myColor, plies, settleBoard, showingSide, wrong],
  );

  const handleQuizMove = useCallback(
    (move: Move) => {
      if (mode !== 'quiz' || quizDone || quizAutoPlaying.current) return;
      if (!quizExpected) return;

      if (uciOf(move) === quizExpected.uci) {
        setQuizAsked((value) => value + 1);
        if (quizMistakeRef.current === 0) setQuizClean((value) => value + 1);
        quizMistakeRef.current = 0;
        setQuizMistakes(0);
        setQuizHint(null);
        setQuizMessage('Correct.');
        setQuizMove((index) => index + 1);
        return;
      }

      /* Wrong move: take the piece back and let them try again. */
      quizMistakeRef.current += 1;
      setQuizMistakes(quizMistakeRef.current);
      if (quizTurnFen.current) boardRef.current?.reset(quizTurnFen.current);

      if (quizMistakeRef.current >= REVEAL_AFTER) {
        setQuizMessage(`That move was ${quizExpected.san} — playing it for you.`);
        quizAutoPlaying.current = true;
        setQuizAsked((value) => value + 1);
        const expected = quizExpected.uci;
        window.setTimeout(() => {
          void boardRef.current
            ?.playMoves([expected], { intervalMs: 120 })
            .finally(() => {
              quizAutoPlaying.current = false;
              quizMistakeRef.current = 0;
              setQuizMistakes(0);
              setQuizHint(null);
              setQuizMove((index) => index + 1);
            });
        }, 520);
        return;
      }

      if (quizMistakeRef.current >= HINT_AFTER) {
        setQuizHint(arrowFor(quizExpected.uci, '#d8b87d'));
        setQuizMessage(
          `Not that one. The highlighted piece is the one — move it to ${quizExpected.uci.slice(2, 4)}.`,
        );
        return;
      }

      setQuizMessage('Not that move. Look for the piece your line moves here.');
    },
    [boardRef, mode, quizDone, quizExpected],
  );

  /* The review engine: advance the opponent, wait for the player, one ply at a
     time. Segment ends roll into the next line, the last one into the hand-off.
     The reset below is declared first on purpose: the board must already be on
     the segment's start position when this effect reads it. */
  useEffect(() => {
    if (mode !== 'quiz' || quizDone) return;
    if (!quizLine) return;
    boardRef.current?.cancelPlayback();
    boardRef.current?.reset(quizLine.startFen);
    quizMistakeRef.current = 0;
    setQuizMistakes(0);
    setQuizHint(null);
  }, [boardRef, mode, quizDone, quizLine]);

  useEffect(() => {
    if (mode !== 'quiz' || quizDone) return;
    if (!quizLine) return;
    if (!quizExpected) {
      if (quizSegment + 1 < quizSegments.length) {
        setQuizSegment((index) => index + 1);
        setQuizMove(0);
        setQuizMessage('Next line.');
        return;
      }
      if (quizFinished.current) return;
      quizFinished.current = true;
      const percent = quizAsked === 0 ? 0 : Math.round((quizClean / quizAsked) * 100);
      const summary = { asked: quizAsked, clean: quizClean, percent };
      setQuizResult(summary);
      setQuizDone(true);
      void recordDrill(course.course_id, chapter?.chapter_id ?? '', percent)
        .then(() => db.line_progress.where('course_id').equals(course.course_id).toArray())
        .then((rows) => setTests(Object.fromEntries(rows.map((row) => [row.chapter_id, row]))))
        .catch(() => {});
      onNotify(
        percent >= 90
          ? `Chapter passed — ${percent}% clean.`
          : `Chapter reviewed — ${percent}% clean.`,
      );
      return;
    }

    if (quizExpected.color === quizColor) {
      quizTurnFen.current = boardRef.current?.getFen() ?? null;
      setQuizMessage('Your move.');
      return;
    }

    quizAutoPlaying.current = true;
    const timer = window.setTimeout(() => {
      void boardRef.current
        ?.playMoves([quizExpected.uci], { intervalMs: 120 })
        .finally(() => {
          quizAutoPlaying.current = false;
          setQuizMove((index) => index + 1);
        });
    }, REVIEW_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      quizAutoPlaying.current = false;
    };
  }, [
    boardRef,
    chapter,
    course.course_id,
    mode,
    onNotify,
    quizAsked,
    quizClean,
    quizColor,
    quizDone,
    quizExpected,
    quizLine,
    quizSegment,
    quizSegments,
  ]);

  /* Passing a chapter hands straight over to the next one — still in review,
     so a whole course can be worked through without touching the rail. */
  useEffect(() => {
    if (mode !== 'quiz' || !quizDone) return;
    const timer = window.setTimeout(() => {
      if (nextChapter) {
        selectChapter(chapterIndex + 1);
        onNotify(`Next up: ${nextChapter.title}`);
      }
    }, ADVANCE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [chapterIndex, mode, nextChapter, onNotify, quizDone, selectChapter]);

  /* --------------------------------- arrows -------------------------------- */

  const learnArrows = useMemo<BoardArrow[]>(() => {
    if (mode !== 'learn') return [];
    const list: BoardArrow[] = drawn.map((arrow) => ({ ...arrow, color: '#7fb2ff' }));
    if (hint) list.push(hint);
    else if (suggestionOn && !showingSide) {
      const idea = arrowFor(learnNext?.uci, '#3f9a57');
      if (idea) list.push(idea);
    }
    return list;
  }, [drawn, hint, learnNext, mode, showingSide, suggestionOn]);

  const quizArrows = useMemo<BoardArrow[]>(() => (quizHint ? [quizHint] : []), [quizHint]);

  const highlights = useMemo(() => {
    const mark = mode === 'learn' ? hint : quizHint;
    if (!mark) return undefined;
    return { [mark.startSquare]: { background: 'rgba(216, 184, 125, 0.45)' } };
  }, [hint, mode, quizHint]);

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
    else
      void element
        .requestFullscreen?.()
        .catch(() => onNotify('Full screen was blocked.', 'error'));
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

  /* Chess speak, not parser speak: a line is counted in moves, and the active
     move is labelled with its number and the side that plays it. */
  const moveLabel = (ply: CoursePly | undefined): string =>
    ply ? `Move ${ply.move_number}${ply.color === 'b' ? '…' : '.'}` : 'Start';
  const depthTotal = Math.ceil(
    (showingSide ? (side?.plies.length ?? 0) : plies.length) / 2,
  );
  const movesLabel = (count: number): string => `${count} move${count === 1 ? '' : 's'}`;
  const depthSummary =
    moveLabel(viewPly) === 'Start'
      ? `Start · ${movesLabel(depthTotal)}`
      : `${moveLabel(viewPly)}${showingSide ? ` of ${depthTotal} in the side line` : ` of ${depthTotal}`}`;

  const sideLabel =
    showingSide && sideLine && side
      ? `${plies[sideLine.ply]?.move_number ?? 0}${
          plies[sideLine.ply]?.color === 'w' ? '.' : '…'
        } ${side.san} instead of ${plies[sideLine.ply]?.san}`
      : '';

  /* The line's own status, in one sentence. */
  const learnPrompt = (() => {
    if (plies.length === 0) {
      return 'This chapter starts from a position — study it, then step through the notes.';
    }
    if (showingSide) {
      return unwalkedForSide(sideLabel);
    }
    if (cursor < 0) {
      if (yourMove) return `Your move — play the first ${sideName(myColor)} move of this line.`;
      return auto
        ? 'The board starts the line. Your moves are yours to play.'
        : 'Read the position, then press Next move.';
    }
    if (noteUnread) return 'Read the note, then continue the line.';
    if (unwalked.length > 0) {
      return `${unwalked.length} side line${unwalked.length === 1 ? '' : 's'} break off here — explore ${unwalked.length === 1 ? 'it' : 'them'} to move on.`;
    }
    if (atEnd) return 'Line complete. Test it — the other side plays itself and you answer.';
    if (!auto) return 'Auto-play is paused. Press Next move to step, or Play to let it run.';
    if (yourMove) return `Your move — play the ${sideName(myColor)} move in this line.`;
    return 'Playing on…';
  })();

  function unwalkedForSide(label: string): string {
    const total = side?.plies.length ?? 0;
    const step = sideLine?.step ?? -1;
    if (step >= total - 1) return `${label} — explored. Back to the main line.`;
    return `${label} — step to the end to mark it explored.`;
  }

  const primaryLabel = showingSide
    ? (sideLine?.step ?? -1) >= (side?.plies.length ?? 0) - 1
      ? 'Main line'
      : 'Next move'
    : paused
      ? 'Continue'
      : atEnd
        ? 'Test chapter'
        : 'Next move';

  /* Every branch on the move must be walked before the line moves on. */
  const primaryDisabled = plies.length === 0 || (!showingSide && unwalked.length > 0);

  const quizPercent = quizTotal === 0 ? 0 : Math.round((quizAsked / quizTotal) * 100);

  return (
    <div className={`study${collapsed ? ' is-collapsed' : ''}`} ref={studyRef}>
      <h1 className="visually-hidden">
        {mode === 'quiz' ? 'Reviewing' : 'Studying'} {course.title}
      </h1>

      {/* ------------------------------- rail ------------------------------- */}
      <aside className="study__rail" aria-label="Course chapters">
        <header className="study__rail-head">
          <button
            type="button"
            className="study__icon"
            onClick={onExit}
            title="Back to courses"
            aria-label="Back to courses"
          >
            ←
          </button>
          {!collapsed && (
            <div className="study__rail-title">
              <span>{mode === 'quiz' ? 'Review' : 'Course'}</span>
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

            {mode === 'learn' ? (
              <div className="study__steps">
                <h3>Steps in this chapter</h3>
                <div className="study__step-list">
                  {steps.map((step) => {
                    const done = cursor >= step.end;
                    return (
                      <button
                        key={step.start}
                        type="button"
                        className={`study__step${done ? ' is-done' : ''}${
                          cursor >= step.start && cursor <= step.end ? ' is-current' : ''
                        }`}
                        onClick={() => {
                          setAuto(false);
                          goTo(step.end);
                        }}
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
            ) : (
              <div className="study__steps">
                <h3>This run</h3>
                <dl className="study__run-stats">
                  <div>
                    <dt>Answered</dt>
                    <dd>
                      {quizAsked}/{quizTotal}
                    </dd>
                  </div>
                  <div>
                    <dt>Clean</dt>
                    <dd>{quizClean}</dd>
                  </div>
                  <div>
                    <dt>Lines</dt>
                    <dd>
                      {Math.min(quizSegment + 1, Math.max(1, quizSegments.length))}/
                      {quizSegments.length}
                    </dd>
                  </div>
                </dl>
                <button type="button" className="study__chapters-toggle" onClick={backToReading}>
                  ← Back to reading this chapter
                </button>
              </div>
            )}
          </>
        )}
      </aside>

      {/* ------------------------------- stage ------------------------------ */}
      <div className="study__stage">
        <div className="study__board-head">
          <div className="study__board-head-title">
            <strong title={chapter.title}>{chapter.title}</strong>
            <span>
              {mode === 'quiz' ? 'Review · ' : ''}
              {mode === 'quiz'
                ? `${quizAsked}/${quizTotal} moves`
                : `${depthSummary}${showingSide ? ' · side line' : ''}`}
            </span>
          </div>
          {mode === 'learn' && (
            <button
              type="button"
              className="study__mode-btn"
              onClick={startQuiz}
              disabled={plies.length === 0}
              title="Test this chapter — the same board, no answers"
            >
              Review
            </button>
          )}
        </div>

        <div className="study__board-host">
          {/* Exactly the board, centred in the column: the drawing layer and the
              click-to-square maths both ride on this box, so they stay aligned
              at every scale. */}
          <div className="study__board-frame" ref={hostRef}>
            <BoardSlot
              props={{
                fen: mode === 'learn' ? viewFen : undefined,
                orientation,
                interactive:
                  mode === 'learn'
                    ? canPlay
                    : !quizDone && quizExpected?.color === quizColor,
                arrows: mode === 'learn' ? learnArrows : quizArrows,
                highlights,
                lastMove: mode === 'learn' ? viewLastMove : null,
                highlightLastMove: true,
                onMove: mode === 'learn' ? handleLearnMove : handleQuizMove,
              }}
            />
            {mode === 'learn' && drawMode && (
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

        {mode === 'learn' ? (
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
        ) : (
          <div className="study__board-tools study__board-tools--quiet">
            <span>No hints in review — the line is yours.</span>
          </div>
        )}

        <div className="study__banner">
          {mode === 'quiz' ? (
            <>
              <p>
                {quizDone && quizResult ? (
                  <strong>
                    {quizResult.percent}% clean — {nextChapter ? `next: ${nextChapter.title}` : 'the end of the course'}.
                  </strong>
                ) : (
                  quizMessage
                )}
              </p>
              <div className="study__banner-actions">
                {quizDone ? (
                  <button type="button" className="secondary-btn" onClick={onExit}>
                    Back to library
                  </button>
                ) : (
                  <button type="button" className="secondary-btn" onClick={backToReading}>
                    Read instead
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="study__banner-copy">
                <p>
                  {showingSide && side ? (
                    <>
                      <strong>Side line:</strong> {sideLabel}
                    </>
                  ) : (
                    learnPrompt
                  )}
                </p>
                {flash && <p className="study__banner-flash">{flash}</p>}
                {!showingSide && unwalked.length > 0 && (
                  <p className="study__banner-hint">
                    {branchCount} side line{branchCount === 1 ? '' : 's'} on this move ·{' '}
                    {branchCount - unwalked.length} explored
                  </p>
                )}
                {!showingSide && noteUnread && learnPly?.comment && (
                  <blockquote className="study__banner-note">{learnPly.comment}</blockquote>
                )}
              </div>
              <div className="study__banner-actions">
                <button
                  type="button"
                  className={`study__tool study__auto${auto ? ' is-on' : ''}`}
                  aria-pressed={auto}
                  onClick={() => setAuto((current) => !current)}
                  title={auto ? 'Pause the auto-play' : 'Let the line play itself'}
                >
                  {auto ? '❚❚ Auto' : '▶ Auto'}
                </button>
                <button
                  type="button"
                  className="study__nav"
                  onClick={stepBack}
                  disabled={showingSide ? (sideLine?.step ?? -1) <= -1 : cursor <= -1}
                  aria-label={showingSide ? 'Previous side-line move' : 'Previous move'}
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="study__next"
                  onClick={primaryAction}
                  disabled={primaryDisabled}
                >
                  {primaryLabel}
                  <span className="study__next-chevron" aria-hidden="true">
                    ›
                  </span>
                </button>
                {showingSide && (
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => setSideLine(null)}
                  >
                    Close
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ------------------------------- panel ------------------------------ */}
      <aside className="study__panel" aria-label={mode === 'quiz' ? 'Review' : 'Notation and coaching'}>
        {mode === 'quiz' ? (
          <>
            <header className="study__panel-head">
              <div>
                <span className="study__eyebrow">Line {quizSegments.length === 0 ? 0 : quizSegment + 1} of {quizSegments.length}</span>
                <strong className="study__depth-label">
                  {quizTotal === 0 ? 'Nothing to ask' : `${quizAsked} of ${quizTotal} answered`}
                </strong>
              </div>
              <div className="study__panel-actions">
                <button
                  type="button"
                  className="study__icon"
                  onClick={() => setOrientation((current) => (current === 'white' ? 'black' : 'white'))}
                  title="Flip board"
                  aria-label="Flip board"
                >
                  ⇅
                </button>
              </div>
            </header>

            <div className="study__depth" aria-hidden="true">
              <span style={{ width: `${quizPercent}%` }} />
            </div>

            <div className="study__quiz">
              <p className="study__quiz-title">{quizLine?.label ?? 'Your line'}</p>
              <p className="study__quiz-msg" aria-live="polite">
                {quizDone && quizResult
                  ? `${quizResult.clean} of ${quizResult.asked} moves answered cleanly.`
                  : quizMessage}
              </p>
              <dl className="study__run-stats study__run-stats--wide">
                <div>
                  <dt>Move</dt>
                  <dd>
                    {Math.min(quizAsked + 1, quizTotal)} / {quizTotal}
                  </dd>
                </div>
                <div>
                  <dt>Clean</dt>
                  <dd>{quizClean}</dd>
                </div>
                <div>
                  <dt>Tries</dt>
                  <dd>{quizMistakes}</dd>
                </div>
              </dl>
              <p className="study__quiz-hint">
                The other side answers by itself. Wrong moves come back to you, so you can
                find the right piece.
              </p>
              {switchedSide && (
                <p className="study__quiz-hint study__quiz-hint--warn">
                  This chapter has no {sideName(myColor)} moves, so review asks for{' '}
                  {sideName(quizColor)}. Switch the course side in the library to test it the
                  other way round.
                </p>
              )}
            </div>

            <footer className="study__toolbar">
              <button
                type="button"
                className="study__icon"
                onClick={onOpenSettings}
                title="Settings"
                aria-label="Settings"
              >
                ⚙
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
                onClick={backToReading}
                title="Back to reading this chapter"
                aria-label="Back to reading this chapter"
              >
                ✎
              </button>
            </footer>
          </>
        ) : (
          <>
            <header className="study__panel-head">
              <div>
                <span className="study__eyebrow">{showingSide ? 'Side line' : 'Line depth'}</span>
                <strong className="study__depth-label">{depthSummary}</strong>
              </div>
              <div className="study__panel-actions">
                <button
                  type="button"
                  className={`study__icon${viewPly && bookmarks.has(cursor) && !showingSide ? ' is-on' : ''}`}
                  onClick={() => {
                    if (!viewPly || showingSide) return;
                    const next = new Set(bookmarks);
                    if (next.has(cursor)) next.delete(cursor);
                    else next.add(cursor);
                    persistBookmarks(next);
                  }}
                  disabled={!viewPly || showingSide}
                  aria-pressed={Boolean(viewPly && !showingSide && bookmarks.has(cursor))}
                  title="Bookmark this move"
                  aria-label="Bookmark this move"
                >
                  {viewPly && !showingSide && bookmarks.has(cursor) ? '★' : '☆'}
                </button>
                <button
                  type="button"
                  className="study__icon"
                  onClick={startQuiz}
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
                      ? side?.plies.length
                        ? (((sideLine?.step ?? 0) + 1) / side.plies.length) * 100
                        : 0
                      : plies.length
                        ? ((cursor + 1) / plies.length) * 100
                        : 0
                  }%`,
                }}
              />
            </div>

            {showingSide && (
              <div className="study__sidelabel">
                <span>{sideLabel}</span>
                <button type="button" className="study__linkbtn" onClick={() => setSideLine(null)}>
                  Back to main line
                </button>
              </div>
            )}

            <div
              className="study__moves"
              role="group"
              aria-label={showingSide ? 'Side line' : 'Main line'}
            >
              {(showingSide && side ? side.plies : plies).map((ply, index) => {
                const current = showingSide ? index === sideLine?.step : index === cursor;
                const past = showingSide ? index < (sideLine?.step ?? -1) : index < cursor;
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
                      else {
                        setAuto(false);
                        goTo(index);
                      }
                    }}
                  >
                    {ply.color === 'w' && <span className="study__ply-no">{ply.move_number}.</span>}
                    <span className="study__ply-san">{ply.san}</span>
                    <span className="study__ply-nag">{annotate(ply)}</span>
                    {ply.comment && (
                      <span
                        className={`study__ply-note${
                          !showingSide && index === cursor && noteUnread ? ' is-unread' : ''
                        }`}
                        aria-label="has a note"
                      />
                    )}
                  </button>
                );
              })}
              {!showingSide && plies.length === 0 && (
                <p className="study__rail-empty">Position only.</p>
              )}
            </div>

            <div className="study__coach">
              <h3>{showingSide ? 'Side line note' : 'Why this move'}</h3>
              <p>
                {viewPly?.comment ||
                  (showingSide
                    ? 'This written alternative is part of the chapter — step through it above.'
                    : cursor < 0
                      ? 'The line starts here. The board plays it on, pausing wherever the coach has something to say.'
                      : 'No note on this move. Press Next move to keep the line going.')}
              </p>

              {/* Only the move on the board has branches: the panel never lists
                  another move's side lines. */}
              {!showingSide && branchCount > 0 && (
                <div className="study__alts">
                  <h4>
                    Side lines
                    <span className="study__alts-count">
                      {branchCount - unwalked.length}/{branchCount}
                    </span>
                  </h4>
                  <p className="study__alts-hint">
                    {unwalked.length > 0
                      ? 'Step each one to its end before the line moves on.'
                      : 'All of them explored — continue the line when ready.'}
                  </p>
                  <ul>
                    {(learnPly?.alternatives ?? []).map((alt, index) => {
                      const done = walked.has(`${cursor}:${index}`);
                      return (
                        <li
                          key={`${alt.san}-${index}`}
                          className={done ? 'is-done' : undefined}
                        >
                          <button
                            type="button"
                            className="study__alt"
                            onClick={() => setSideLine({ ply: cursor, alt: index, step: -1 })}
                          >
                            <strong>{alt.san}</strong>
                            <span>{alt.comment || 'Also playable in this position.'}</span>
                            <em>
                              {done ? 'explored' : movesLabel(Math.ceil(alt.plies.length / 2))}
                            </em>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>

            <footer className="study__toolbar">
              <button
                type="button"
                className="study__icon"
                onClick={onOpenSettings}
                title="Settings"
                aria-label="Settings"
              >
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
          </>
        )}
      </aside>
    </div>
  );
}

export default memo(StudyView);
