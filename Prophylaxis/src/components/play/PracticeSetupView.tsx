import { useEffect, useMemo, useState } from 'react';
import { courseStats, listCourses } from '../../courses/courseService';
import type { PgnCourseRecord } from '../../courses/types';
import {
  PRACTICE_ELO,
  PRACTICE_MODES,
  practiceBookSize,
  type PracticeMode,
} from '../../play/practice.ts';
import type { PlayColor } from '../../play/types.ts';

export interface PracticeStartOptions {
  course: PgnCourseRecord;
  mode: PracticeMode;
  playerColor: PlayColor;
  elo: number;
}

/**
 * Setup for a repertoire sparring game: which course, which side of it, how
 * strictly the partner follows it, and how strong it plays once the book ends.
 *
 * The course list is read once on mount; the app has no course-change events
 * that reach this screen, and it is re-entered from the tab each time.
 */
export function PracticeSetupView({
  onStart,
}: {
  onStart: (options: PracticeStartOptions) => void;
}) {
  const [courses, setCourses] = useState<PgnCourseRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [color, setColor] = useState<PlayColor>('w');
  const [mode, setMode] = useState<PracticeMode>('sidelines');
  const [elo, setElo] = useState<number>(PRACTICE_ELO.default);

  useEffect(() => {
    let cancelled = false;
    void listCourses()
      .then((rows) => {
        if (cancelled) return;
        setCourses(rows);
        /* The newest course is the one most likely wanted; its own colour is the
           default side, because that is the side it was written for. */
        const first = rows[0];
        if (first) {
          setCourseId(first.course_id);
          setColor(first.repertoire_color);
        }
      })
      .catch(() => {
        if (!cancelled) setError('Your courses could not be read from this device.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = useMemo(
    () => courses?.find((course) => course.course_id === courseId) ?? null,
    [courseId, courses],
  );

  const book = useMemo(() => (selected ? practiceBookSize(selected) : null), [selected]);
  const stats = useMemo(() => (selected ? courseStats(selected) : null), [selected]);

  function chooseCourse(course: PgnCourseRecord) {
    setCourseId(course.course_id);
    setColor(course.repertoire_color);
  }

  if (error) {
    return (
      <div className="play-empty-state">
        <p className="play-eyebrow">Opening practice</p>
        <h2>Your courses could not be opened</h2>
        <p>{error}</p>
      </div>
    );
  }

  if (courses === null) {
    return (
      <div className="play-empty-state">
        <p className="play-eyebrow">Opening practice</p>
        <h2>Loading your courses…</h2>
      </div>
    );
  }

  if (courses.length === 0) {
    return (
      <div className="play-empty-state">
        <p className="play-eyebrow">Opening practice</p>
        <h2>Import a course first</h2>
        <p>
          Repertoire practice spars from one of your saved opening courses. Add a PGN in the
          Courses room, then come back here.
        </p>
        <button
          type="button"
          className="primary-btn"
          onClick={() => {
            window.location.hash = '#/courses';
          }}
        >
          Open Courses
        </button>
      </div>
    );
  }

  return (
    <div className="practice-setup">
      <section className="play-block" aria-labelledby="practice-course-title">
        <div className="play-block__head">
          <p className="play-eyebrow">01 — Course</p>
          <h2 id="practice-course-title">What are you rehearsing?</h2>
        </div>

        <div className="practice-courses" role="radiogroup" aria-label="Course">
          {courses.map((course) => {
            const active = course.course_id === courseId;
            const counts = courseStats(course);
            return (
              <button
                key={course.course_id}
                type="button"
                role="radio"
                aria-checked={active}
                className={`practice-course${active ? ' is-selected' : ''}`}
                onClick={() => chooseCourse(course)}
              >
                <span className="practice-course__head">
                  <span className="practice-course__title">{course.title}</span>
                  <span className="practice-course__side">
                    {course.repertoire_color === 'w' ? 'White' : 'Black'}
                  </span>
                </span>
                <span className="practice-course__meta">
                  {counts.chapters} {counts.chapters === 1 ? 'chapter' : 'chapters'} ·{' '}
                  {counts.plies} plies
                  {counts.variations > 0 ? ` · ${counts.variations} side lines` : ''}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="play-block" aria-labelledby="practice-side-title">
        <div className="play-block__head">
          <p className="play-eyebrow">02 — Side</p>
          <h2 id="practice-side-title">Which side do you play?</h2>
        </div>

        <div className="play-field">
          <span className="play-field__label">Play as</span>
          <div className="play-segment" role="group" aria-label="Your side">
            {(['w', 'b'] as const).map((side) => (
              <button
                key={side}
                type="button"
                aria-pressed={color === side}
                className={`play-segment__option${color === side ? ' is-selected' : ''}`}
                onClick={() => setColor(side)}
              >
                <span>{side === 'w' ? 'White' : 'Black'}</span>
                <small>
                  {selected && selected.repertoire_color === side
                    ? 'Written for this side'
                    : 'The other side of the course'}
                </small>
              </button>
            ))}
          </div>
        </div>

        <div className="play-field">
          <span className="play-field__label">How the partner tests you</span>
          <div className="practice-modes" role="radiogroup" aria-label="Partner behaviour">
            {PRACTICE_MODES.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={mode === option.id}
                className={`practice-mode${mode === option.id ? ' is-selected' : ''}`}
                onClick={() => setMode(option.id)}
              >
                <span className="practice-mode__label">{option.label}</span>
                <span className="practice-mode__hint">{option.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="play-field">
          <span className="play-field__label">Partner strength once the book ends</span>
          <div className="play-bot-range">
            <div className="play-bot-range__head">
              <label htmlFor="practice-elo">Strength</label>
              <output htmlFor="practice-elo">{elo} Elo</output>
            </div>
            <input
              id="practice-elo"
              type="range"
              min={PRACTICE_ELO.min}
              max={PRACTICE_ELO.max}
              step={PRACTICE_ELO.step}
              value={elo}
              onChange={(event) => setElo(Number(event.target.value))}
            />
            <div className="play-bot-range__scale" aria-hidden="true">
              <span>{PRACTICE_ELO.min}</span>
              <span>{PRACTICE_ELO.default}</span>
              <span>{PRACTICE_ELO.max}</span>
            </div>
          </div>
        </div>
      </section>

      <aside className="practice-preview" aria-label="Practice summary">
        <p className="play-eyebrow">Ready when you are</p>
        <h2>{selected ? selected.title : 'No course selected'}</h2>
        <dl className="play-facts">
          <div>
            <dt>Mode</dt>
            <dd>{PRACTICE_MODES.find((entry) => entry.id === mode)?.label}</dd>
          </div>
          <div>
            <dt>You play</dt>
            <dd>{color === 'w' ? 'White' : 'Black'}</dd>
          </div>
          <div>
            <dt>Clock</dt>
            <dd>Untimed</dd>
          </div>
          <div>
            <dt>Book</dt>
            <dd>
              {book ? `${book.moves} course moves · ${book.positions} positions` : '—'}
            </dd>
          </div>
          {stats ? (
            <div>
              <dt>Chapters</dt>
              <dd>{stats.chapters}</dd>
            </div>
          ) : null}
        </dl>
        <button
          type="button"
          className="primary-btn"
          disabled={!selected}
          onClick={() => {
            if (selected) onStart({ course: selected, mode, playerColor: color, elo });
          }}
        >
          Start practice
        </button>
        <p className="practice-preview__note">
          The partner plays your course back to you. When the line runs out, the engine
          finishes the game, and the whole thing is saved to your history like any other game.
        </p>
      </aside>
    </div>
  );
}

export default PracticeSetupView;
