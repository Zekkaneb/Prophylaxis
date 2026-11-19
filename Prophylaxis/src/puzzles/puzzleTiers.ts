import type { Puzzle } from '../db';
import fallbackSeeds from './fallbackPuzzles.json';
import { PUZZLE_TIER_BANDS, tierFile } from './tiers.ts';
import type { PuzzleTierBand } from './tiers.ts';
import { tierManifestFile, tierShardFile } from './shardPlan.ts';

export { tierManifestFile, tierShardFile };

/**
 * The runtime tier list used by the puzzle trainer.
 *
 * Bounds come from the central config in `tiers.ts`; this module only adds the
 * static file each tier is served from. Keeping one source of truth means the
 * ingest script, the selection engine and the UI can never disagree about where
 * "Intermediate" starts.
 */

export type { PuzzleTierSlug } from './tiers.ts';
export {
  AUTHORITATIVE_PUZZLE_TIERS,
  AUTHORITATIVE_TIER_SLUGS,
  PUZZLE_TIER_BANDS,
  RATING_CEILING,
  RATING_FLOOR,
  TARGET_LIBRARY_SIZE,
  TARGET_PUZZLES_PER_TIER,
  classifyPuzzleRating,
  getTierBand,
  isAuthoritativeRating,
  isAuthoritativeTier,
  tierFile,
} from './tiers.ts';

export interface PuzzleTier extends PuzzleTierBand {
  /** Legacy single-file chunk served from /public/puzzles/{slug}.json. */
  file: string;
  /** Manifest for the sharded pool, served from /public/puzzles/{slug}/. */
  manifestFile: string;
}

export const PUZZLE_TIERS: readonly PuzzleTier[] = PUZZLE_TIER_BANDS.map((band) => ({
  ...band,
  file: tierFile(band.slug),
  manifestFile: tierManifestFile(band.slug),
}));

export function getTier(slug: string): PuzzleTier | undefined {
  return PUZZLE_TIERS.find((tier) => tier.slug === slug);
}

/** Number of puzzles in the offline mock pool. */
export const FALLBACK_PUZZLE_COUNT = fallbackSeeds.length;

/**
 * Mock puzzles used when `/public/puzzles/{slug}.json` has not been added yet.
 * Ratings are spread evenly across the requested tier so the UI can be tested
 * end to end without any network access or static data.
 */
export function buildFallbackPuzzles(tier: PuzzleTier): Puzzle[] {
  const span = tier.maxRating - tier.minRating;
  const step = fallbackSeeds.length > 1 ? span / (fallbackSeeds.length - 1) : 0;

  return fallbackSeeds.map((seed, index) => ({
    puzzle_id: `mock-${tier.slug}-${String(index + 1).padStart(2, '0')}`,
    fen: seed.fen,
    moves: seed.moves,
    rating: Math.round(tier.minRating + step * index),
    themes: seed.themes,
  }));
}
