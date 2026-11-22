import {
  bookAccuracy,
  moveLabel,
  practiceModeLabel,
  sideLineTally,
  type PracticeSnapshot,
} from '../../play/practice.ts';

/**
 * The scorecard for a repertoire sparring game.
 *
 * Two views of the same numbers: a one-line strip under the tab bar while the
 * game is running (are you still in your course, right now?) and the feedback
 * block the end-of-game card shows (what did the drill actually test?).
 */

function statLabel(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export function PracticeStrip({ practice }: { practice: PracticeSnapshot }) {
  const accuracy = bookAccuracy(practice);
  const inBook = practice.deviation === null;

  return (
    <div className="practice-strip" role="status" aria-live="polite">
      <span className="practice-strip__course">
        <span className="practice-strip__dot" aria-hidden="true" />
        {practice.courseTitle}
      </span>
      <span className="practice-strip__mode">{practiceModeLabel(practice.mode)}</span>
      <span className="practice-strip__stat">
        <strong>{practice.bookMoves}</strong> of {practice.playerMoves}{' '}
        {statLabel(practice.playerMoves, 'move', 'moves')} in book
      </span>
      <span className="practice-strip__stat practice-strip__stat--quiet">{accuracy}%</span>
      {practice.streak >= 3 ? (
        <span className="practice-strip__stat practice-strip__stat--good">
          {practice.streak} in a row
        </span>
      ) : null}
      {!inBook && practice.deviation ? (
        <span className="practice-strip__deviation">
          Off book at {moveLabel(practice.deviation.ply, practice.deviation.playedSan)}
          {practice.deviation.expectedSans.length > 0
            ? ` · course had ${practice.deviation.expectedSans.join(' or ')}`
            : ''}
        </span>
      ) : null}
      {practice.bookEndedPly !== null && inBook ? (
        <span className="practice-strip__stat practice-strip__stat--quiet">
          Book ended at ply {practice.bookEndedPly}
        </span>
      ) : null}
    </div>
  );
}

export function PracticeFeedback({ practice }: { practice: PracticeSnapshot }) {
  const accuracy = bookAccuracy(practice);
  const tally = sideLineTally(practice);
  const deviation = practice.deviation;

  return (
    <section className="practice-feedback" aria-label="Opening practice feedback">
      <p className="play-eyebrow">Prepared opening</p>
      <h4 className="practice-feedback__title">{practice.courseTitle}</h4>

      <p className="practice-feedback__lede">
        {deviation
          ? `You stayed in the course for ${practice.bestStreak} ${statLabel(practice.bestStreak, 'move', 'moves')} at your best, and left it on ${moveLabel(deviation.ply, deviation.playedSan)}.`
          : practice.playerMoves > 0
            ? `Every one of your ${practice.playerMoves} ${statLabel(practice.playerMoves, 'move', 'moves')} matched the course.`
            : 'No moves were played from the course.'}
      </p>

      <dl className="practice-feedback__facts">
        <div>
          <dt>Book accuracy</dt>
          <dd>
            {practice.bookMoves} / {practice.playerMoves} · {accuracy}%
          </dd>
        </div>
        <div>
          <dt>Longest stay</dt>
          <dd>
            {practice.bestStreak} {statLabel(practice.bestStreak, 'move', 'moves')}
          </dd>
        </div>
        <div>
          <dt>Course replies</dt>
          <dd>
            {practice.partnerBookMoves} from the book
            {tally.faced > 0
              ? ` · ${tally.faced} ${statLabel(tally.faced, 'side line', 'side lines')}`
              : ''}
          </dd>
        </div>
      </dl>

      {deviation ? (
        <div className="practice-feedback__note">
          <p>
            <strong>{moveLabel(deviation.ply, deviation.playedSan)}</strong> is not in{' '}
            {deviation.chapterTitle === practice.courseTitle
              ? 'the course'
              : `“${deviation.chapterTitle}”`}
            .
          </p>
          {deviation.expectedSans.length > 0 ? (
            <p className="practice-feedback__hint">
              The course plays {deviation.expectedSans.map((san) => san).join(' or ')} here.
            </p>
          ) : null}
        </div>
      ) : practice.bookEndedPly !== null ? (
        <p className="practice-feedback__hint">
          The course ran out at ply {practice.bookEndedPly}; everything after that was your own
          play.
        </p>
      ) : null}

      {practice.partnerLines.length > 0 ? (
        <div className="practice-feedback__lines">
          <p className="practice-feedback__hint">What the partner tested</p>
          <ul>
            {practice.partnerLines.map((line) => (
              <li key={`${line.ply}-${line.san}`}>
                <span className="practice-feedback__line-move">
                  {moveLabel(line.ply, line.san)}
                </span>
                <span className="practice-feedback__line-kind">
                  {line.kind === 'side' ? 'side line' : 'left the book'}
                </span>
                <span
                  className={
                    line.answeredInBook === true
                      ? 'practice-feedback__line-ok'
                      : line.answeredInBook === false
                        ? 'practice-feedback__line-off'
                        : ''
                  }
                >
                  {line.answeredInBook === true
                    ? 'you stayed in book'
                    : line.answeredInBook === false
                      ? 'you left the book here'
                      : 'not answered'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="practice-feedback__hint">
        Review the game to see where the engine disagreed with the line.
      </p>
    </section>
  );
}

export default PracticeStrip;
