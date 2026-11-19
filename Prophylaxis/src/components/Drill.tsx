import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import LineQuiz, { type QuizResult } from './LineQuiz';
import {
  chapterLearned,
  chapterQuizSegments,
  chapterReviewed,
  lineKey,
  listCourses,
  readStudyProgress,
  recordDrill,
} from '../courses/courseService';
import type { CourseChapter, PgnCourseRecord } from '../courses/types';
import { db, type LineProgress } from '../db';
import './Drill.css';

/** A line is due when it was never passed, or has not been seen for two days. */
const DUE_AFTER_MS = 2 * 24 * 60 * 60 * 1000;
const DRILL_BATCH = 6;

interface DrillRow {
  course: PgnCourseRecord;
  chapter: CourseChapter;
  progress: LineProgress | undefined;
  questions: number;
  /** The chapter was read to its last move. */
  reviewed: boolean;
  /** Read to the end *and* tested — the only way a line is marked learned. */
  learned: boolean;
  due: boolean;
}

function formatAgo(timestamp: number | undefined): string {
  if (!timestamp) return 'never drilled';
  const minutes = Math.round((Date.now() - timestamp) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export interface DrillProps {
  /** Goes to the Courses library, where lines are imported. */
  onBrowseCourses: () => void;
  onNotify: (message: string, tone?: 'success' | 'error') => void;
}

/**
 * Drill: everything learned so far, with a spaced-repetition nudge.
 *
 * A line is "learned" once its quiz has been passed; the list orders the lines
 * that are most stale first, so the tab always knows what to do next.
 */
function DrillComponent({ onBrowseCourses, onNotify }: DrillProps) {
  const [courses, setCourses] = useState<PgnCourseRecord[]>([]);
  const [progress, setProgress] = useState<Record<string, LineProgress>>({});
  /* Reading progress lives in localStorage, one record per course. */
  const [review, setReview] = useState<Record<string, Record<string, number>>>({});
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<{ course: PgnCourseRecord; chapter: CourseChapter } | null>(
    null,
  );

  const refresh = useCallback(async () => {
    try {
      const [rows, progressRows] = await Promise.all([
        listCourses(),
        db.line_progress.toArray(),
      ]);
      setCourses(rows);
      setProgress(Object.fromEntries(progressRows.map((row) => [row.id, row])));
      setReview(
        Object.fromEntries(rows.map((course) => [course.course_id, readStudyProgress(course.course_id)])),
      );
    } catch (cause) {
      onNotify(`Could not read drill history: ${(cause as Error).message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rows = useMemo<DrillRow[]>(() => {
    const list: DrillRow[] = [];
    for (const course of courses) {
      for (const chapter of course.chapters) {
        if (chapter.plies.length === 0) continue;
        const entry = progress[lineKey(course.course_id, chapter.chapter_id)];
        const questions = chapterQuizSegments(chapter).reduce(
          (sum, segment) => sum + segment.moves.filter((move) => move.color === course.repertoire_color).length,
          0,
        );
        if (questions === 0) continue;
        const reached = review[course.course_id]?.[chapter.chapter_id];
        const reviewed = chapterReviewed(chapter, reached);
        list.push({
          course,
          chapter,
          progress: entry,
          questions,
          reviewed,
          learned: chapterLearned(chapter, reached, entry?.attempts ?? 0),
          due:
            !entry ||
            entry.mastery < 3 ||
            !entry.last_drilled ||
            Date.now() - entry.last_drilled > DUE_AFTER_MS,
        });
      }
    }
    return list.sort((a, b) => {
      const seenA = a.progress?.last_drilled ?? 0;
      const seenB = b.progress?.last_drilled ?? 0;
      if (seenA !== seenB) return seenA - seenB;
      return a.chapter.title.localeCompare(b.chapter.title);
    });
  }, [courses, progress, review]);

  const dueRows = rows.filter((row) => row.due);
  const learned = rows.filter((row) => row.learned).length;
  const solid = rows.filter((row) => (row.progress?.mastery ?? 0) >= 3).length;

  /* The next thing worth doing: stalest unpassed line, newest course first. */
  const startNext = useCallback(() => {
    const next = (dueRows.length > 0 ? dueRows : rows)[0];
    if (!next) {
      onNotify('Import a course first — there is nothing to drill yet.', 'error');
      return;
    }
    setActive({ course: next.course, chapter: next.chapter });
  }, [dueRows, onNotify, rows]);

  const handleFinish = useCallback(
    (result: QuizResult) => {
      if (!active) return;
      void recordDrill(active.course.course_id, active.chapter.chapter_id, result.percent)
        .then(() => {
          onNotify(`Drill saved — ${result.percent}% clean.`);
          return refresh();
        })
        .catch((cause: Error) => onNotify(`Could not save that drill: ${cause.message}`, 'error'));
    },
    [active, onNotify, refresh],
  );

  if (active) {
    const segments = chapterQuizSegments(active.chapter);
    /* Passing a line rolls straight into the next one due, so a drill session
       does not stop on a results menu between chapters. */
    const rest = rows.filter((row) => row.chapter.chapter_id !== active.chapter.chapter_id);
    const nextRow = rest.find((row) => row.due) ?? rest[0];
    const handOff = () => {
      if (!nextRow) {
        setActive(null);
        onNotify('Every line is passed. Nothing else is due right now.');
        return;
      }
      setActive({ course: nextRow.course, chapter: nextRow.chapter });
      onNotify(`Line passed — next up: ${nextRow.chapter.title}`);
    };

    return (
      <LineQuiz
        key={`${active.course.course_id}:${active.chapter.chapter_id}`}
        segments={segments}
        color={active.course.repertoire_color}
        title={active.chapter.title}
        subtitle={`${active.course.title} · drill`}
        onFinish={handleFinish}
        onExit={() => setActive(null)}
        onNextChapter={handOff}
        nextLabel={`next: ${nextRow?.chapter.title ?? 'the next line'}`}
      />
    );
  }

  return (
    <div className="page page--drill">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Drill</p>
          <h1>
            Make the lines <em>stick.</em>
          </h1>
          <p className="subheading">
            The other side plays itself; you answer from memory. Missed lines come back
            first.
          </p>
        </div>
        <div className="heading-actions">
          <button
            type="button"
            className="primary-btn"
            onClick={startNext}
            disabled={rows.length === 0}
          >
            {dueRows.length > 0 ? `Drill ${Math.min(dueRows.length, DRILL_BATCH)} due lines` : 'Drill a line'}
          </button>
        </div>
      </div>

      <dl className="drill-stats">
        <div className="drill-stats__cell">
          <dt>Lines in your library</dt>
          <dd>{loading ? '—' : rows.length}</dd>
        </div>
        <div className="drill-stats__cell">
          <dt>Learned</dt>
          <dd>{loading ? '—' : learned}</dd>
        </div>
        <div className="drill-stats__cell">
          <dt>Solid</dt>
          <dd>{loading ? '—' : solid}</dd>
        </div>
        <div className="drill-stats__cell">
          <dt>Due now</dt>
          <dd>{loading ? '—' : dueRows.length}</dd>
        </div>
      </dl>

      {rows.length === 0 ? (
        <div className="drill-empty">
          <p>
            Nothing to drill yet. Import a PGN study in Courses, read a line, then press
            <strong> Test chapter</strong> — passing it puts the line here.
          </p>
          <button type="button" className="secondary-btn" onClick={onBrowseCourses}>
            Go to Courses
          </button>
        </div>
      ) : (
        <ul className="drill-list">
          {rows.map((row) => {
            const mastery = row.progress?.mastery ?? 0;
            return (
              <li key={lineKey(row.course.course_id, row.chapter.chapter_id)} className="drill-row">
                <div className="drill-row__main">
                  <p className="drill-row__course">{row.course.title}</p>
                  <strong>{row.chapter.title}</strong>
                  <p className="drill-row__meta">
                    {row.questions} move{row.questions === 1 ? '' : 's'} to answer ·{' '}
                    {row.progress ? `${row.progress.last_percent}% last time` : 'not tested'} ·{' '}
                    {row.reviewed ? 'read' : 'not read yet'} ·{' '}
                    {formatAgo(row.progress?.last_drilled)}
                  </p>
                </div>
                <div className="drill-row__side">
                  <span
                    className="drill-row__mastery"
                    aria-label={`Mastery ${mastery} of 3`}
                    title={`Mastery ${mastery} of 3`}
                  >
                    {[1, 2, 3].map((step) => (
                      <span
                        key={step}
                        className={`drill-dot${mastery >= step ? ' is-on' : ''}`}
                        aria-hidden="true"
                      />
                    ))}
                  </span>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => setActive({ course: row.course, chapter: row.chapter })}
                  >
                    Drill
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default memo(DrillComponent);
