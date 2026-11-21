import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  courseQuizMoveCount,
  courseStats,
  deleteCourse,
  importCoursePgn,
  listCourses,
  setCourseColor,
} from '../courses/courseService';
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

function formatDate(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

export interface CourseLibraryProps {
  /** Top-bar search, matched against course and chapter titles. */
  query?: string;
  /** Clears that search from the empty state, so one click restores the list. */
  onClearSearch?: () => void;
  onStudy: (courseId: string) => void;
  onNotify?: (message: string, tone?: 'success' | 'error') => void;
}

function CourseLibrary({ query = '', onClearSearch, onStudy, onNotify }: CourseLibraryProps) {
  const [courses, setCourses] = useState<PgnCourseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* Which side the incoming study is written for; the board follows it. */
  const [importColor, setImportColor] = useState<'w' | 'b'>('w');

  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const rows = await listCourses();
    setCourses(rows);
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
          const summary = courseStats(entry);
          /* Testing a study from the wrong side used to open a quiz that could
             never ask a move; the card says so before the user gets there. */
          const answers = courseQuizMoveCount(entry, entry.repertoire_color);
          const wrongSide =
            answers === 0 &&
            courseQuizMoveCount(entry, entry.repertoire_color === 'w' ? 'b' : 'w') > 0;
          return (
            <article className="course-card" key={entry.course_id}>
              <div className="course-card__top">
                <span className="course-card__tag">
                  {summary.chapters} chapter{summary.chapters === 1 ? '' : 's'}
                </span>
                <button
                  type="button"
                  className={`course-card__side course-card__side--${entry.repertoire_color}`}
                  title="Switch the side this course studies"
                  onClick={() =>
                    void handleColorChange(entry, entry.repertoire_color === 'w' ? 'b' : 'w')
                  }
                >
                  {entry.repertoire_color === 'b' ? 'Black' : 'White'}
                </button>
                <button
                  type="button"
                  className="icon-btn course-card__delete"
                  aria-label={`Delete ${entry.title}`}
                  title="Delete course"
                  onClick={() => setPendingDelete(entry)}
                >
                  ✕
                </button>
              </div>
              <h3>
                <button
                  type="button"
                  className="course-card__title-btn"
                  onClick={() => onStudy(entry.course_id)}
                >
                  {entry.title}
                </button>
              </h3>
              <p className="course-card__meta">
                {Math.ceil(summary.plies / 2)} moves · {summary.notes} notes
                {summary.variations > 0 ? ` · ${summary.variations} variations` : ''}
              </p>
              <p className="course-card__source" title={entry.source_name}>
                {entry.source_name}
              </p>
              {wrongSide && (
                <p className="course-card__warn">
                  No {entry.repertoire_color === 'w' ? 'White' : 'Black'} moves here — switch
                  the side to test and drill this study.
                </p>
              )}
              <div className="course-card__foot">
                <span className="course-card__date">{formatDate(entry.imported_at)}</span>
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => onStudy(entry.course_id)}
                >
                  Study
                </button>
              </div>
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
