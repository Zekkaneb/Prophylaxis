/**
 * Difficulty tiers: one source of truth for the whole puzzle pipeline.
 *
 * The six authoritative bands are difficulty categories on the **chess.com**
 * rating scale — the scale the trainer displays. The library itself is a sample
 * of the Lichess Open Puzzle Database, whose Glicko-2 ratings run about 200
 * points lower than chess.com's puzzle ratings for the same position, so
 * `toChessComRating()` is applied once at the edge of the library (pool build and
 * import). Everything downstream — stored rows, bands, selection, the trainer —
 * speaks chess.com.
 *
 * `elite` is kept as a legacy overflow band (ratings above Master) because the
 * existing trainer offers it; it is deliberately *not* one of the six.
 *
 * This module is pure and has no runtime imports, so Node scripts and
 * `node --test` can load it directly.
 */

export type PuzzleTierSlug =
  | 'new-to-chess'
  | 'novice'
  | 'intermediate'
  | 'advanced'
  | 'expert'
  | 'master'
  | 'elite';

export interface PuzzleTierBand {
  slug: PuzzleTierSlug;
  name: string;
  /** Inclusive lower bound, chess.com puzzle-rating scale. */
  minRating: number;
  /** Inclusive upper bound. */
  maxRating: number;
  /**
   * Share of the band skipped at the bottom when its pool is built (0–1,
   * default `DEFAULT_POOL_FLOOR_PERCENTILE`). A tier serves the *harder* slice
   * of its label, so `Intermediate 1501–1800` is filled from 1651 upwards.
   *
   * Elite sets this to 0: the database thins out sharply above 3200, so the
   * whole band is already the hard end.
   */
  poolFloorPercentile?: number;
}

/** Default share of a band skipped at the bottom when its pool is built. */
export const DEFAULT_POOL_FLOOR_PERCENTILE = 0.5;

/**
 * chess.com puzzle ratings sit ~200 points above the same puzzle's Lichess
 * Glicko-2 rating. One constant so the ingest script, the published pool and the
 * band table can never disagree about the offset.
 */
export const LICHESS_TO_CHESSCOM_SHIFT = 200;

/** Lichess rating → the chess.com figure the app stores and shows. */
export function toChessComRating(lichessRating: number): number {
  return lichessRating + LICHESS_TO_CHESSCOM_SHIFT;
}

/** The inverse, for tooling that has to compare against Lichess data. */
export function toLichessRating(chessComRating: number): number {
  return chessComRating - LICHESS_TO_CHESSCOM_SHIFT;
}

/** The six authoritative bands, ascending. Order matters for classification. */
export const AUTHORITATIVE_PUZZLE_TIERS: readonly PuzzleTierBand[] = [
  { slug: 'new-to-chess', name: 'New to Chess', minRating: 800, maxRating: 1200 },
  { slug: 'novice', name: 'Novice', minRating: 1201, maxRating: 1500 },
  { slug: 'intermediate', name: 'Intermediate', minRating: 1501, maxRating: 1800 },
  { slug: 'advanced', name: 'Advanced', minRating: 1801, maxRating: 2100 },
  { slug: 'expert', name: 'Expert', minRating: 2101, maxRating: 2400 },
  { slug: 'master', name: 'Master', minRating: 2401, maxRating: 2700 },
] as const;

/** Legacy band kept for the existing Elite option in the puzzle trainer. */
export const EXTENDED_PUZZLE_TIERS: readonly PuzzleTierBand[] = [
  /* No bottom cut: only ~100 quality puzzles exist above chess.com 3200, so the
     whole band is already the hard end of the database. */
  { slug: 'elite', name: 'Elite', minRating: 2701, maxRating: 3700, poolFloorPercentile: 0 },
] as const;

/** Every band the app knows, authoritative ones first. */
export const PUZZLE_TIER_BANDS: readonly PuzzleTierBand[] = [
  ...AUTHORITATIVE_PUZZLE_TIERS,
  ...EXTENDED_PUZZLE_TIERS,
];

export const AUTHORITATIVE_TIER_SLUGS: readonly PuzzleTierSlug[] =
  AUTHORITATIVE_PUZZLE_TIERS.map((tier) => tier.slug);

/** Library-wide bounds: the six authoritative tiers span 800–2700. */
export const RATING_FLOOR = AUTHORITATIVE_PUZZLE_TIERS[0].minRating;
export const RATING_CEILING = AUTHORITATIVE_PUZZLE_TIERS[AUTHORITATIVE_PUZZLE_TIERS.length - 1].maxRating;

/** Curated chunks the app fetches: 1,000 per tier, 6,000 for a fresh library. */
export const TARGET_PUZZLES_PER_TIER = 1000;
export const TARGET_LIBRARY_SIZE = TARGET_PUZZLES_PER_TIER * AUTHORITATIVE_PUZZLE_TIERS.length;

/** Where `scripts/ingest-lichess-puzzles.mjs` writes each tier's chunk. */
export function tierFile(slug: PuzzleTierSlug): string {
  return `/puzzles/${slug}.json`;
}

export function getTierBand(slug: string): PuzzleTierBand | undefined {
  return PUZZLE_TIER_BANDS.find((tier) => tier.slug === slug);
}

/**
 * Lowest rating a band's pool is built from: the band shifted up by
 * `poolFloorPercentile`. Every published tier therefore holds its harder slice,
 * and the floor is data, not a build flag, so pools and labels cannot drift.
 */
export function bandRatingFloor(band: PuzzleTierBand): number {
  const percentile = Math.min(
    1,
    Math.max(0, band.poolFloorPercentile ?? DEFAULT_POOL_FLOOR_PERCENTILE),
  );
  return Math.round(band.minRating + (band.maxRating - band.minRating) * percentile);
}

export function isAuthoritativeTier(slug: string): boolean {
  return AUTHORITATIVE_PUZZLE_TIERS.some((tier) => tier.slug === slug);
}

/**
 * Rating → tier.
 *
 * Uses "highest band whose floor the rating reaches", so fractional ratings or
 * a future band gap can never leave a puzzle unclassified between two bands.
 * Below the first floor (800) the puzzle belongs to no tier; above 2700 the
 * legacy Elite band takes it.
 */
export function classifyPuzzleRating(rating: number): PuzzleTierSlug | null {
  if (!Number.isFinite(rating)) return null;
  if (rating < PUZZLE_TIER_BANDS[0].minRating) return null;

  let match: PuzzleTierBand | null = null;
  for (const band of PUZZLE_TIER_BANDS) {
    if (rating >= band.minRating) match = band;
  }
  return match ? match.slug : null;
}

/** True when the rating falls inside one of the six authoritative bands. */
export function isAuthoritativeRating(rating: number): boolean {
  const slug = classifyPuzzleRating(rating);
  return slug !== null && isAuthoritativeTier(slug);
}
