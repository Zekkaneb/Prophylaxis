import { useEffect, useState } from 'react';
import {
  PLACEMENT_SEEDS,
  RATING_CALIBRATION_HINT,
  RATING_CATEGORY_HINT,
  RATING_LABELS,
  RATING_CATEGORIES,
  ratingLabel,
} from '../../play/customRating.ts';
import {
  isSeeded,
  loadRatings,
  RATING_EVENT,
  seedRatings,
  type RatingMap,
} from '../../play/ratingStore.ts';
import { useTitleProgress } from '../../play/titleStore.ts';

/**
 * The player's rating, and the one-time placement choice.
 *
 * A brand-new player picks where they think they belong; from then on this card
 * is read-only, showing each category's rating with the placement badge while
 * the first ten games are still settling it.
 */
export function RatingCard({ compact = false }: { compact?: boolean }) {
  const [ratings, setRatings] = useState<RatingMap>({});
  const [busy, setBusy] = useState(false);
  const titleProgress = useTitleProgress();

  useEffect(() => {
    let cancelled = false;
    const read = () => {
      void loadRatings().then((next) => {
        if (!cancelled) setRatings(next);
      });
    };
    read();
    window.addEventListener(RATING_EVENT, read);
    return () => {
      cancelled = true;
      window.removeEventListener(RATING_EVENT, read);
    };
  }, []);

  const seeded = isSeeded(ratings);

  if (!seeded) {
    return (
      <section className="rating-card rating-card--seed" aria-labelledby="rating-seed-title">
        <div className="rating-card__head">
          <p className="play-eyebrow">Rated play</p>
          <h2 id="rating-seed-title">Where do you start?</h2>
        </div>
        <p className="rating-card__note">
          Pick the group that sounds like you. The first ten rated games settle the
          number, and it is kept separately for bullet, blitz, rapid and classical.
        </p>
        <div className="rating-seed" role="group" aria-label="Starting rating">
          {PLACEMENT_SEEDS.map((seed) => (
            <button
              key={seed.id}
              type="button"
              className="rating-seed__option"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void seedRatings(seed.rating).finally(() => setBusy(false));
              }}
            >
              <span className="rating-seed__label">{seed.label}</span>
              <span className="rating-seed__value">{seed.rating}</span>
              <span className="rating-seed__blurb">{seed.blurb}</span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section
      className={`rating-card${compact ? ' rating-card--compact' : ''}`}
      aria-labelledby="rating-title"
    >
      <div className="rating-card__head">
        <p className="play-eyebrow">Your rating</p>
        <h2 id="rating-title">
          {ratings.rapid ? ratingLabel(ratings.rapid.rating, ratings.rapid.games_played < 10) : '—'}
          <small> rapid</small>
        </h2>
      </div>
      <dl className="rating-grid">
        {RATING_CATEGORIES.map((category) => {
          const row = ratings[category];
          const placing = row ? row.games_played < 10 : false;
          return (
            <div key={category} className={`rating-cell${placing ? ' is-placing' : ''}`}>
              <dt>
                {RATING_LABELS[category]}
                <span className="rating-cell__hint">{RATING_CATEGORY_HINT[category]}</span>
              </dt>
              <dd>
                {row ? (
                  <>
                    <strong>{ratingLabel(row.rating, placing)}</strong>
                    <span className="rating-cell__meta">
                      {placing
                        ? `${10 - row.games_played} placement games left`
                        : row.floor
                          ? `Floor ${row.floor} · peak ${row.peak}`
                          : `Peak ${row.peak}`}
                    </span>
                  </>
                ) : (
                  <span className="rating-cell__meta">Not played yet</span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      {titleProgress.summary ? (
        <p className="rating-card__norm">{titleProgress.summary}</p>
      ) : null}
      <p className="rating-card__note">{RATING_CALIBRATION_HINT}</p>
    </section>
  );
}

export default RatingCard;
