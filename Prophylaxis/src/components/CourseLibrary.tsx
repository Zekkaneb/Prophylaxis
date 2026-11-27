import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  chapterLearned,
  courseQuizMoveCount,
  deleteCourse,
  importCoursePgn,
  lineKey,
  listCourses,
  readStudyProgress,
  setCourseColor,
} from '../courses/courseService';
import { db, type LineProgress } from '../db';
import type { PgnCourseRecord } from '../courses/types';
import ActionSheet from './ActionSheet';
import './CourseLibrary.css';

/**
 * PGN course library: import a file, browse the courses it produced, open one
 * in the study view. Parsing/storage live in `src/courses/courseService`; the
 * study screen is `StudyView`, mounted by the Courses route.
 */

const SAMPLE_PGN = `[Event "Sample study"]
[Site "prophylaxis"]
[ChapterName "Italian Game — Main line"]
[White "Study"]
[Black "Repertoire"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d3 d6 {Quiet setup: keep the centre
flexible and castle before pushing.} 6. O-O O-O 7. Re1 a6 {Black keeps the
bishop pair covered.} (7... d5 {The freeing break — only good once the
development is finished.}) *

[Event "Sample study"]
[Site "prophylaxis"]
[ChapterName "Sicilian — Najdorf"]
[White "Study"]
[Black "Repertoire"]
[Result "*"]

1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 {The Najdorf tabiya — the
move that stops b5 and prepares …e5.} (5... g6 {The Dragon: faster kingside
pressure, but the dark squares stay loose.}) *

[Event "Sample study"]
[Site "prophylaxis"]
[ChapterName "Queen's Gambit — Declined"]
[White "Study"]
[Black "Repertoire"]
[Result "*"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 5. e3 O-O {Classical main line: Black
finishes development before resolving the centre.} *`;

const MAX_FILES = 6;

/* Course art, picked deterministically so a course keeps the same cover. */
const COVERS = ['/covers/red.jpg', '/covers/blue.jpg', '/covers/gold.jpg'];

function coverFor(courseId: string): string {
  let hash = 7;
  for (let index = 0; index < courseId.length; index += 1) {
    hash = (hash * 31 + courseId.charCodeAt(index)) % 9973;
  }
  return COVERS[hash % COVERS.length];
}

interface CourseProgress {
  chapters: number;
  learned: number;
  due: number;
  percent: number;
}

export interface CourseLibraryProps {
  /** Top-bar search, matched against course and chapter titles. */
  query?: string;
  /** Clears that search from the empty state, so one click restores the list. */
  onClearSearch?: () => void;
  /** `mode` opens the course straight into reading or straight into review. */
  onStudy: (courseId: string, mode?: 'learn' | 'quiz') => void;
  onNotify?: (message: string, tone?: 'success' | 'error') => void;
}

function CourseLibrary({ query = '', onClearSearch, onStudy, onNotify }: CourseLibraryProps) {
  const [courses, setCourses] = useState<PgnCourseRecord[]>([]);
  const [progress, setProgress] = useState<Record<string, LineProgress>>({});
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* Which side the incoming study is written for; the board follows it. */
  const [importColor, setImportColor] = useState<'w' | 'b'>('w');

  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const [rows, progressRows] = await Promise.all([listCourses(), db.line_progress.toArray()]);
    setCourses(rows);
    setProgress(Object.fromEntries(progressRows.map((row) => [row.id, row])));
    return rows;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void refresh()
      .catch((cause: Error) => {
        if (!cancelled) setError(`Could not read your library: ${cause.message}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const handleFiles = useCallback(
    async (incoming: File[]) => {
      const files = incoming.slice(0, MAX_FILES);
      if (!files.length) return;
      setBusy(true);
      setError(null);

      const created: PgnCourseRecord[] = [];
      const problems: string[] = [];
      for (const file of files) {
        try {
          const text = await file.text();
          created.push(await importCoursePgn(text, file.name, importColor));
        } catch (cause) {
          problems.push(`${file.name}: ${(cause as Error).message}`);
        }
      }

      if (created.length) {
        const next = await refresh();
        const first = created[0];
        const chapters = created.reduce((sum, entry) => sum + entry.chapters.length, 0);
        onNotify?.(
          `Imported ${chapters} chapter${chapters === 1 ? '' : 's'} from ${
            created.length === 1 ? first.source_name : `${created.length} files`
          }.`,
        );
        const match = next.find((entry) => entry.course_id === first.course_id);
        if (match) onStudy(match.course_id);
      }
      if (problems.length) setError(problems.join(' '));
      setBusy(false);
    },
    [importColor, onNotify, onStudy, refresh],
  );

  const handleColorChange = useCallback(
    async (record: PgnCourseRecord, color: 'w' | 'b') => {
      await setCourseColor(record.course_id, color);
      await refresh();
      onNotify?.(`“${record.title}” now studies the ${color === 'w' ? 'White' : 'Black'} side.`);
    },
    [onNotify, refresh],
  );

  const handleDelete = useCallback(
    async (record: PgnCourseRecord) => {
      await deleteCourse(record.course_id);
      await refresh();
      onNotify?.(`Deleted “${record.title}”.`);
    },
    [onNotify, refresh],
  );

  /* The field is debounced upstream; deferral keeps typing at 60fps on top. */
  const deferredQuery = useDeferredValue(query);
  const [scope, setScope] = useState<'all' | 'w' | 'b'>('all');
  const [pendingDelete, setPendingDelete] = useState<PgnCourseRecord | null>(null);
  const filtered = Boolean(deferredQuery.trim()) || scope !== 'all';

  /* Learned and due are per chapter and come from the same two places the
     study screen reads: the reading cursor and the quiz history. */
  const cardProgress = useMemo(() => {
    const map = new Map<string, CourseProgress>();
    for (const entry of courses) {
      const read = readStudyProgress(entry.course_id);
      let learned = 0;
      let due = 0;
      for (const chapter of entry.chapters) {
        const row = progress[lineKey(entry.course_id, chapter.chapter_id)];
        const attempts = row?.attempts ?? 0;
        if (chapterLearned(chapter, read[chapter.chapter_id], attempts)) learned += 1;
        if (attempts === 0 || (row?.mastery ?? 0) < 3) due += 1;
      }
      const chapters = entry.chapters.length;
      map.set(entry.course_id, {
        chapters,
        learned,
        due,
        percent: chapters === 0 ? 0 : Math.round((learned / chapters) * 100),
      });
    }
    return map;
  }, [courses, progress]);

  /* Search and scope compose: the bar narrows the collection, the field
     narrows the bar's result. */
  const visible = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    const scoped = scope === 'all' ? courses : courses.filter((entry) => entry.repertoire_color === scope);
    if (!needle) return scoped;
    return scoped.filter((entry) => {
      if (entry.title.toLowerCase().includes(needle)) return true;
      if (entry.source_name.toLowerCase().includes(needle)) return true;
      return entry.chapters.some((chapter) => chapter.title.toLowerCase().includes(needle));
    });
  }, [courses, deferredQuery, scope]);

  return (
    <section className="courses" aria-label="PGN courses">
      <div
        className={`courses__drop${dragging ? ' is-dragging' : ''}${busy ? ' is-busy' : ''}`}
        aria-busy={busy}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void handleFiles(Array.from(event.dataTransfer.files));
        }}
      >
        {busy ? (
          <span className="courses__spinner" aria-hidden="true" />
        ) : (
          <span className="courses__drop-icon" aria-hidden="true">
            ⇪
          </span>
        )}
        <div className="courses__drop-text">
          <strong role="status" aria-live="polite">
            {busy ? 'Reading your PGN…' : 'Drop a PGN course here'}
          </strong>
          <p>
            Every game in the file becomes a chapter. Parsed locally, stored on this
            device — nothing is uploaded.
          </p>
        </div>
        <div className="courses__drop-side">
          <span className="courses__side-label" id="import-side-label">
            I play
          </span>
          <div className="courses__side-switch" role="group" aria-labelledby="import-side-label">
            {(['w', 'b'] as const).map((side) => (
              <button
                key={side}
                type="button"
                className={`courses__side-btn${importColor === side ? ' is-active' : ''}`}
                aria-pressed={importColor === side}
                onClick={() => setImportColor(side)}
              >
                {side === 'w' ? 'White' : 'Black'}
              </button>
            ))}
          </div>
        </div>

        <div className="courses__drop-actions">
          <button
            type="button"
            className="primary-btn"
            onClick={() => fileInput.current?.click()}
            disabled={busy}
          >
            Choose file…
          </button>
          <button
            type="button"
            className="secondary-btn"
            disabled={busy}
            onClick={() =>
              void handleFiles([
                new File([SAMPLE_PGN], 'sample-study.pgn', {
                  type: 'application/x-chess-pgn',
                }),
              ])
            }
          >
            Load sample
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".pgn,application/x-chess-pgn,text/plain"
          multiple
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            void handleFiles(files);
          }}
        />
      </div>

      {error && (
        <p className="courses__alert" role="alert">
          {error}
        </p>
      )}

      <div className="courses__head">
        <h2>Library</h2>

        <div className="courses__scope" role="group" aria-label="Filter by repertoire side">
          {([
            ['all', 'All'],
            ['w', 'White'],
            ['b', 'Black'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`courses__scope-btn${scope === value ? ' is-active' : ''}`}
              aria-pressed={scope === value}
              onClick={() => setScope(value)}
            >
              {label}
            </button>
          ))}
        </div>

        <span className="courses__count" role="status" aria-live="polite">
          {loading
            ? 'Loading…'
            : `${visible.length} course${visible.length === 1 ? '' : 's'}${
                scope === 'all' ? '' : ` · ${scope === 'w' ? 'White' : 'Black'}`
              }${query ? ` matching “${query.trim()}”` : ''}`}
        </span>
      </div>

      {!loading && visible.length === 0 && (
        <div className="courses__empty">
          <p>{filtered ? 'No courses match those filters.' : 'No courses yet.'}</p>
          <p>
            {filtered
              ? 'Clear the search or widen the side filter, or import a PGN that contains those chapters.'
              : 'Export a study as PGN, drop it above, and it lands here with one chapter per game.'}
          </p>
          {filtered ? (
            <button
              type="button"
              className="secondary-btn courses__empty-reset"
              onClick={() => {
                setScope('all');
                onClearSearch?.();
              }}
            >
              Clear filters
            </button>
          ) : null}
        </div>
      )}

      <div className="courses__grid">
        {visible.map((entry) => {
          const stats = cardProgress.get(entry.course_id) ?? {
            chapters: entry.chapters.length,
            learned: 0,
            due: 0,
            percent: 0,
          };
          /* Testing a study from the wrong side used to open a quiz that could
             never ask a move; the card says so before the user gets there. */
          const answers = courseQuizMoveCount(entry, entry.repertoire_color);
          const wrongSide =
            answers === 0 &&
            courseQuizMoveCount(entry, entry.repertoire_color === 'w' ? 'b' : 'w') > 0;
          const menuOpen = openMenu === entry.course_id;
          return (
            <article className="course-card" key={entry.course_id}>
              <div className="course-card__cover">
                <img src={coverFor(entry.course_id)} alt="" loading="lazy" decoding="async" />
              </div>

              <div className="course-card__main">
                <div className="course-card__head">
                  <h3>
                    <button
                      type="button"
                      className="course-card__title"
                      onClick={() => onStudy(entry.course_id, 'learn')}
                      title={entry.source_name}
                    >
                      {entry.title}
                    </button>
                  </h3>
                  <div className="course-card__tools">
                    <button
                      type="button"
                      className="course-card__chip"
                      title={`You study ${entry.repertoire_color === 'b' ? 'Black' : 'White'} — click to switch`}
                      onClick={() =>
                        void handleColorChange(entry, entry.repertoire_color === 'w' ? 'b' : 'w')
                      }
                    >
                      {entry.repertoire_color === 'b' ? '♟ Black' : '♙ White'}
                    </button>
                    <button
                      type="button"
                      className="course-card__more"
                      aria-label={`Actions for ${entry.title}`}
                      aria-expanded={menuOpen}
                      onClick={() => setOpenMenu(menuOpen ? null : entry.course_id)}
                    >
                      ⋯
                    </button>
                  </div>
                </div>

                <p className="course-card__count">
                  {stats.learned} / {stats.chapters} chapter{stats.chapters === 1 ? '' : 's'}{' '}
                  learned
                </p>

                <div
                  className="course-card__bar"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={stats.percent}
                  aria-label={`${entry.title} progress`}
                >
                  <span style={{ width: `${stats.percent}%` }} />
                </div>

                {wrongSide && (
                  <p className="course-card__warn">
                    No {entry.repertoire_color === 'w' ? 'White' : 'Black'} moves here — switch
                    the side to review this study.
                  </p>
                )}

                <div className="course-card__actions">
                  <button
                    type="button"
                    className="course-card__btn course-card__btn--review"
                    onClick={() => onStudy(entry.course_id, 'quiz')}
                    disabled={answers === 0}
                    title="Test the chapters you have read"
                  >
                    Review
                    {stats.due > 0 && <span className="course-card__badge">{stats.due}</span>}
                  </button>
                  <button
                    type="button"
                    className="course-card__btn course-card__btn--learn"
                    onClick={() => onStudy(entry.course_id, 'learn')}
                  >
                    Learn
                  </button>
                </div>
              </div>

              {menuOpen && (
                <div className="course-card__menu">
                  <button
                    type="button"
                    className="course-card__menu-item"
                    onClick={() => {
                      setOpenMenu(null);
                      setPendingDelete(entry);
                    }}
                  >
                    Delete course
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <ActionSheet
        open={Boolean(pendingDelete)}
        title="Delete course?"
        message={
          pendingDelete
            ? `“${pendingDelete.title}” and its chapters are removed from this device.`
            : undefined
        }
        confirmLabel="Delete course"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const record = pendingDelete;
          setPendingDelete(null);
          if (record) void handleDelete(record);
        }}
      />
    </section>
  );
}

export default memo(CourseLibrary);
