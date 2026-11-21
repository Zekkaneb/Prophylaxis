import { memo, useEffect, useMemo, useState, type FormEvent } from 'react';
import { db, type LineProgress, type SavedReview, type WoodpeckerSet } from '../db';
import type { PlayedGameRecord } from '../play/types';
import { listCourses, courseStats, lineKey } from '../courses/courseService';
import { summarizeReview } from '../review/gameReviewService';
import type { PgnCourseRecord } from '../courses/types';
import {
  PLAYER_ELO_RANGE,
  PLAYER_NAME_MAX,
  playerDisplayName,
} from '../profile/playerProfile.ts';
import { updatePlayerProfile, usePlayerProfile } from '../profile/usePlayerProfile.ts';
import { syncProfileToAccount } from '../sync/profileMirror.ts';
import { useSessionEmail } from '../sync/useSessionEmail.ts';
import type { TabId } from './SideNav';

/**
 * Home overview: what is in the library, what is learned, and the two ways
 * back into practice (drill, review). All numbers come from IndexedDB.
 */

function formatWhen(timestamp: number): string {
  if (!timestamp) return '';
  const diff = Date.now() - timestamp;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export interface DashboardProps {
  onNavigate: (tab: TabId) => void;
  onOpenCourse: (courseId: string) => void;
  onOpenDrill: () => void;
  onOpenReview: () => void;
  onOpenPuzzles: () => void;
}

function Dashboard({
  onNavigate,
  onOpenCourse,
  onOpenDrill,
  onOpenReview,
  onOpenPuzzles,
}: DashboardProps) {
  const [courses, setCourses] = useState<PgnCourseRecord[]>([]);
  const [reviews, setReviews] = useState<SavedReview[]>([]);
  const [progress, setProgress] = useState<LineProgress[]>([]);
  const [woodpeckerSets, setWoodpeckerSets] = useState<WoodpeckerSet[]>([]);
  const [played, setPlayed] = useState<PlayedGameRecord[]>([]);
  const [learnedCount, setLearnedCount] = useState(0);
  const [loading, setLoading] = useState(true);

  /* The player's own card: the name and rating that appear on their side of
     the board and in exported PGN headers. Drafts are local until saved. */
  const profile = usePlayerProfile();
  const accountEmail = useSessionEmail();
  const [firstName, setFirstName] = useState(profile.firstName);
  const [lastName, setLastName] = useState(profile.lastName);
  const [eloDraft, setEloDraft] = useState(String(profile.elo));
  const [profileStatus, setProfileStatus] = useState<string | null>(null);

  useEffect(() => {
    setFirstName(profile.firstName);
    setLastName(profile.lastName);
    setEloDraft(String(profile.elo));
  }, [profile]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        /* The teaching rows are read deeper than the lists below show because the
           streak walks back over whole days of activity. */
        const [courseRows, reviewRows, progressRows, setRows, gameRows, learned] =
          await Promise.all([
            listCourses(),
            db.saved_reviews.orderBy('created_at').reverse().limit(40).toArray(),
            db.line_progress.orderBy('last_drilled').reverse().limit(80).toArray(),
            db.woodpecker_sets.orderBy('created_at').reverse().toArray(),
            db.played_games.orderBy('ended_at').reverse().limit(80).toArray(),
            db.line_progress.filter((row) => row.mastery > 0).count(),
          ]);
        if (cancelled) return;
        setCourses(courseRows);
        setReviews(reviewRows);
        setProgress(progressRows);
        setWoodpeckerSets(setRows);
        setPlayed(gameRows);
        setLearnedCount(learned);
      } catch {
        /* an empty dashboard is better than a crashed one */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const totals = useMemo(() => {
    const lines = courses.reduce((sum, course) => sum + course.chapters.length, 0);
    const plies = courses.reduce((sum, course) => sum + courseStats(course).plies, 0);
    return { lines, plies, learned: learnedCount, reviews: reviews.length };
  }, [courses, learnedCount, reviews.length]);

  /** Consecutive days, ending today or yesterday, with any practice on record. */
  const streakDays = useMemo(() => {
    const key = (timestamp: number) => {
      const date = new Date(timestamp);
      return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    };
    const days = new Set<string>();
    for (const row of progress) if (row.last_drilled) days.add(key(row.last_drilled));
    for (const row of reviews) days.add(key(row.created_at));
    for (const row of played) days.add(key(row.ended_at));
    if (days.size === 0) return 0;

    const cursor = new Date();
    if (!days.has(key(cursor.getTime()))) {
      cursor.setDate(cursor.getDate() - 1);
      if (!days.has(key(cursor.getTime()))) return 0;
    }

    let streak = 0;
    while (days.has(key(cursor.getTime()))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }, [played, progress, reviews]);

  /** Woodpecker programme numbers: cycles finished, accuracy and the live set. */
  const puzzles = useMemo(() => {
    let correct = 0;
    let total = 0;
    let cycles = 0;
    let planned = 0;
    let latest: { accuracy: number; at: number } | null = null;

    for (const entry of woodpeckerSets) {
      planned += entry.cycle_target ?? 0;
      for (const cycle of entry.history) {
        correct += cycle.correct_count;
        total += cycle.total_count;
        cycles += 1;
      }
      const last = entry.history[entry.history.length - 1];
      if (last && (!latest || entry.created_at > latest.at)) {
        latest = {
          accuracy: Math.round((last.correct_count / Math.max(1, last.total_count)) * 100),
          at: entry.created_at,
        };
      }
    }

    /* The set the hub would open: the newest one still short of its plan. */
    const active =
      woodpeckerSets.find((entry) => !entry.cycle_target || entry.history.length < entry.cycle_target) ??
      woodpeckerSets[0] ??
      null;

    return {
      accuracy: total > 0 ? Math.round((correct / total) * 100) : null,
      lastAccuracy: latest?.accuracy ?? null,
      cycles,
      planned,
      active,
    };
  }, [woodpeckerSets]);

  const completionRate = totals.lines > 0 ? Math.round((totals.learned / totals.lines) * 100) : 0;

  const draftElo = Number(eloDraft);
  const previewName = playerDisplayName({ firstName, lastName, elo: profile.elo });
  const previewElo = Number.isFinite(draftElo) && eloDraft.trim() !== '' ? draftElo : profile.elo;

  function handleProfileSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = updatePlayerProfile({
      firstName,
      lastName,
      elo: Number.isFinite(draftElo) ? draftElo : profile.elo,
    });
    setFirstName(saved.firstName);
    setLastName(saved.lastName);
    setEloDraft(String(saved.elo));
    /* Name and rating belong to the account, not just this device. */
    void syncProfileToAccount(saved);
    setProfileStatus('Saved');
  }

  const progressByCourse = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of progress) {
      const current = map.get(row.course_id) ?? 0;
      map.set(row.course_id, Math.max(current, row.mastery));
    }
    return map;
  }, [progress]);

  const chapterTitle = (courseId: string, chapterId: string): string => {
    const course = courses.find((entry) => entry.course_id === courseId);
    return course?.chapters.find((chapter) => chapter.chapter_id === chapterId)?.title ?? 'Line';
  };

  const courseTitle = (courseId: string): string =>
    courses.find((entry) => entry.course_id === courseId)?.title ?? 'Course';

  return (
    <div className="page page--dashboard">
      <div className="page-heading">
        <div>
          <h1>
            Welcome back to your <em>training.</em>
          </h1>
          <p className="subheading">
            Read a line, test it against the board, then drill it until it is automatic —
            it all stays on this device.
          </p>
        </div>
        <div className="heading-actions">
          <button type="button" className="primary-btn" onClick={() => onNavigate('courses')}>
            Import a course
          </button>
          <button type="button" className="secondary-btn" onClick={onOpenDrill}>
            Start drilling
          </button>
        </div>
      </div>

      {/* The player's own card, above the statistics: this is the name and
          rating the board and the exported PGNs print for them. Signed in, the
          account panel owns exactly these fields, so the card would be a
          second form writing the same values. */}
      {!accountEmail && (
      <section className="block dash-profile" aria-labelledby="dash-profile-title">
        <header className="block__head">
          <h2 id="dash-profile-title">Your profile</h2>
          <span className="dash-profile__preview">
            On the board: <strong>{previewName}</strong> · {previewElo} Elo
          </span>
        </header>

        <form className="dash-profile__form" onSubmit={handleProfileSave}>
          <label className="dash-profile__field">
            <span>First name</span>
            <input
              name="firstName"
              autoComplete="given-name"
              maxLength={PLAYER_NAME_MAX}
              value={firstName}
              onChange={(event) => {
                setFirstName(event.target.value);
                setProfileStatus(null);
              }}
            />
          </label>

          <label className="dash-profile__field">
            <span>Last name</span>
            <input
              name="lastName"
              autoComplete="family-name"
              maxLength={PLAYER_NAME_MAX}
              value={lastName}
              onChange={(event) => {
                setLastName(event.target.value);
                setProfileStatus(null);
              }}
            />
          </label>

          <label className="dash-profile__field dash-profile__field--elo">
            <span>Elo rating</span>
            <input
              name="elo"
              type="number"
              inputMode="numeric"
              min={PLAYER_ELO_RANGE.min}
              max={PLAYER_ELO_RANGE.max}
              step={1}
              value={eloDraft}
              onChange={(event) => {
                setEloDraft(event.target.value);
                setProfileStatus(null);
              }}
            />
          </label>

          <div className="dash-profile__actions">
            <button type="submit" className="primary-btn">
              Save profile
            </button>
            <span className="dash-profile__status" role="status">
              {profileStatus ?? ''}
            </span>
          </div>
        </form>
      </section>
      )}

      {/* The training numbers first: what is active right now, how clean it is,
          and whether the habit held this week. */}
      <section className="dash-hero" aria-label="Training statistics">
        <div className="dash-hero__cell">
          <span className="dash-hero__label">Practice streak</span>
          <strong className="dash-hero__value">
            {loading ? '—' : streakDays}
            <span className="dash-hero__unit">{streakDays === 1 ? 'day' : 'days'}</span>
          </strong>
          <span className="dash-hero__hint">
            Consecutive days with a drill, a game or a puzzle cycle
          </span>
        </div>

        <div className="dash-hero__cell">
          <span className="dash-hero__label">Puzzle accuracy</span>
          <strong className="dash-hero__value">
            {loading || puzzles.accuracy === null ? '—' : `${puzzles.accuracy}%`}
          </strong>
          <span className="dash-hero__hint">
            {puzzles.lastAccuracy === null
              ? 'First attempt, across every finished cycle'
              : `First attempt · latest cycle ${puzzles.lastAccuracy}% clean`}
          </span>
        </div>

        <div className="dash-hero__cell">
          <span className="dash-hero__label">Woodpecker cycles</span>
          <strong className="dash-hero__value">
            {loading ? '—' : puzzles.cycles}
            {puzzles.planned > 0 ? (
              <span className="dash-hero__unit">of {puzzles.planned} planned</span>
            ) : null}
          </strong>
          {puzzles.planned > 0 ? (
            <span className="dash-hero__bar" aria-hidden="true">
              <span
                style={{
                  width: `${Math.min(100, Math.round((puzzles.cycles / puzzles.planned) * 100))}%`,
                }}
              />
            </span>
          ) : null}
          <span className="dash-hero__hint">
            {puzzles.active
              ? `${puzzles.active.tier_name} · cycle ${puzzles.active.current_cycle} of ${puzzles.active.cycle_target ?? '∞'}`
              : 'No set frozen yet'}
            {puzzles.active ? (
              <button type="button" className="dash-hero__link" onClick={onOpenPuzzles}>
                Open cycle
              </button>
            ) : null}
          </span>
        </div>

        <div className="dash-hero__cell">
          <span className="dash-hero__label">Course completion</span>
          <strong className="dash-hero__value">
            {loading ? '—' : `${completionRate}%`}
          </strong>
          <span className="dash-hero__bar" aria-hidden="true">
            <span style={{ width: `${Math.min(100, completionRate)}%` }} />
          </span>
          <span className="dash-hero__hint">
            {totals.learned} of {totals.lines} chapters passed their quiz
          </span>
        </div>
      </section>

      <dl className="ledger">
        <div className="ledger__cell">
          <dt>Courses</dt>
          <dd>{loading ? '—' : courses.length}</dd>
          <span className="ledger__hint">
            {loading
              ? 'reading library'
              : `${totals.lines} line${totals.lines === 1 ? '' : 's'} imported`}
          </span>
        </div>
        <div className="ledger__cell">
          <dt>Lines learned</dt>
          <dd>{loading ? '—' : totals.learned}</dd>
          <span className="ledger__hint">passed their chapter quiz</span>
        </div>
        <div className="ledger__cell">
          <dt>Study material</dt>
          <dd>{loading ? '—' : Math.ceil(totals.plies / 2)}</dd>
          <span className="ledger__hint">moves annotated by the parser</span>
        </div>
        <div className="ledger__cell">
          <dt>Game reviews</dt>
          <dd>{loading ? '—' : totals.reviews}</dd>
          <span className="ledger__hint">analysed with Stockfish</span>
        </div>
      </dl>

      <div className="dash-grid">
        <section className="block">
          <header className="block__head">
            <h2>Your repertoire</h2>
            <button type="button" className="link-btn" onClick={() => onNavigate('courses')}>
              View all courses
            </button>
          </header>

          {courses.length === 0 ? (
            <div className="block__empty">
              <p>No courses yet — import a PGN study to see it here.</p>
              <button type="button" className="secondary-btn" onClick={() => onNavigate('courses')}>
                Go to Courses
              </button>
            </div>
          ) : (
            <ul className="course-list">
              {courses.slice(0, 3).map((course) => {
                const mastery = progressByCourse.get(course.course_id) ?? 0;
                return (
                  <li key={course.course_id} className="course-row">
                    <div className="course-row__main">
                      <strong>{course.title}</strong>
                      <span>
                        {course.chapters.length} chapter
                        {course.chapters.length === 1 ? '' : 's'} · plays{' '}
                        {course.repertoire_color === 'b' ? 'Black' : 'White'} ·{' '}
                        {course.source_name}
                      </span>
                      <span className="course-row__bar">
                        <span style={{ width: `${(mastery / 3) * 100}%` }} />
                      </span>
                    </div>
                    <div className="course-row__side">
                      <span className="course-row__pct">Mastery {mastery}/3</span>
                      <button
                        type="button"
                        className="secondary-btn course-row__btn"
                        onClick={() => onOpenCourse(course.course_id)}
                      >
                        Study
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="block">
          <header className="block__head">
            <h2>Recent practice</h2>
          </header>
          {reviews.length === 0 && progress.length === 0 ? (
            <div className="block__empty">
              <p>Nothing yet. Drill a line or review a game and it shows up here.</p>
            </div>
          ) : (
            <ul className="activity">
              {progress.map((row) => (
                <li key={lineKey(row.course_id, row.chapter_id)}>
                  <span className="activity__dot activity__dot--gold" aria-hidden="true" />
                  <div>
                    <strong>{chapterTitle(row.course_id, row.chapter_id)}</strong>
                    <span>
                      Drill · {row.last_percent}% clean · mastery {row.mastery}/3 ·{' '}
                      {formatWhen(row.last_drilled)}
                    </span>
                  </div>
                </li>
              ))}
              {reviews.slice(0, 4).map((review) => {
                const summary = summarizeReview(review);
                return (
                  <li key={review.game_id}>
                    <span className="activity__dot" aria-hidden="true" />
                    <div>
                      <strong>
                        {review.white_player} vs {review.black_player}
                      </strong>
                      <span>
                        Review · {summary.whiteAccuracy.toFixed(1)}% /{' '}
                        {summary.blackAccuracy.toFixed(1)}% · {formatWhen(review.created_at)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <section className="quick-grid">
        <button type="button" className="quick-card" onClick={() => onNavigate('courses')}>
          <span aria-hidden="true">❖</span>
          <strong>Browse courses</strong>
          <em>Import PGN studies and choose the side you play.</em>
        </button>
        <button type="button" className="quick-card" onClick={onOpenDrill}>
          <span aria-hidden="true">◷</span>
          <strong>Drill your lines</strong>
          <em>The board plays the replies; you answer from memory.</em>
        </button>
        <button type="button" className="quick-card" onClick={onOpenReview}>
          <span aria-hidden="true">⌕</span>
          <strong>Review a game</strong>
          <em>Stockfish grades every move in the browser.</em>
        </button>
        <button type="button" className="quick-card" onClick={onOpenPuzzles}>
          <span aria-hidden="true">✦</span>
          <strong>Puzzle cycles</strong>
          <em>Replay one frozen set until the pattern is automatic.</em>
        </button>
      </section>

      <p className="dash-note">
        {courses.length > 0
          ? `${courseTitle(courses[0].course_id)} is the newest course in your library.`
          : 'Import your first PGN study to begin.'}
      </p>
    </div>
  );
}

export default memo(Dashboard);
