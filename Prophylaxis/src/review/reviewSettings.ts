import { useCallback, useEffect, useState } from 'react';

/**
 * Game-review depth profiles.
 *
 * Depth is per position (both sides of every non-book move), so the whole-game
 * cost roughly triples from light to heavy. 16 is the floor for the
 * "deep engine-only" Brilliant rule and stays the default.
 */
export type ReviewProfileId = 'light' | 'normal' | 'heavy';

export interface ReviewProfile {
  id: ReviewProfileId;
  label: string;
  /** Stockfish search depth per position. */
  depth: number;
  /** One line explaining the trade-off. */
  blurb: string;
}

export const REVIEW_PROFILES: Record<ReviewProfileId, ReviewProfile> = {
  light: {
    id: 'light',
    label: 'Light',
    depth: 10,
    blurb: 'Quick scan of every move — best for reviewing several games at once.',
  },
  normal: {
    id: 'normal',
    label: 'Normal',
    depth: 16,
    blurb: 'Balanced: keeps the deep Brilliant detection without a long wait.',
  },
  heavy: {
    id: 'heavy',
    label: 'Heavy',
    depth: 22,
    blurb: 'Deep NNUE search: the most accurate verdicts, the slowest pass.',
  },
};

export const REVIEW_PROFILE_IDS: ReviewProfileId[] = ['light', 'normal', 'heavy'];

export const DEFAULT_REVIEW_PROFILE: ReviewProfileId = 'normal';

const STORAGE_KEY = 'chess-trainer.review.v1';

function isProfileId(value: unknown): value is ReviewProfileId {
  return value === 'light' || value === 'normal' || value === 'heavy';
}

export function readReviewProfile(): ReviewProfileId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_REVIEW_PROFILE;
    const parsed = JSON.parse(raw) as { profile?: unknown };
    return isProfileId(parsed.profile) ? parsed.profile : DEFAULT_REVIEW_PROFILE;
  } catch {
    return DEFAULT_REVIEW_PROFILE;
  }
}

/** Selected review profile, persisted locally. */
export function useReviewProfile(): [ReviewProfile, (id: ReviewProfileId) => void] {
  const [id, setId] = useState<ReviewProfileId>(readReviewProfile);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ profile: id }));
    } catch {
      /* private mode — the choice stays in memory */
    }
  }, [id]);

  const select = useCallback((next: ReviewProfileId) => setId(next), []);

  return [REVIEW_PROFILES[id], select];
}
