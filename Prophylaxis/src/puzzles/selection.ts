/**
 * Puzzle selection: filters, deduplication and the two selection methods.
 *
 * Deterministic by construction — every choice comes from a seeded PRNG — so a
 * set created with a recorded seed can be reproduced exactly.
 *
 * Pure module: Node-testable.
 */

import type { PuzzleQualityFilters, SelectionMethod, StoredPuzzle } from './types.ts';
import { getTierBand } from './tiers.ts';

/** FNV-1a: stable 32-bit hash, used to turn a seed phrase into a PRNG seed. */
export function hashSeed(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: small, fast, reproducible PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates over a copy; the input array is never mutated. */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const value = copy[index];
    copy[index] = copy[swapIndex];
    copy[swapIndex] = value;
  }
  return copy;
}

/**
 * Keeps the first puzzle seen for each id. Order of first appearance is
 * preserved, so dedupe is stable across imports and concatenated exports.
 */
export function dedupePuzzles<T extends { puzzle_id: string }>(puzzles: readonly T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const puzzle of puzzles) {
    if (seen.has(puzzle.puzzle_id)) continue;
    seen.add(puzzle.puzzle_id);
    unique.push(puzzle);
  }
  return unique;
}

/** Puzzles whose rating falls inside the tier's band. */
export function puzzlesInTier(puzzles: readonly StoredPuzzle[], tierSlug: string): StoredPuzzle[] {
  const band = getTierBand(tierSlug);
  if (!band) return [];
  return puzzles.filter((puzzle) => puzzle.rating >= band.minRating && puzzle.rating <= band.maxRating);
}

/**
 * Applies the quality gates. A missing field never fails a gate: puzzles stored
 * before the Lichess metadata existed keep working.
 */
export function matchesQualityFilters(puzzle: StoredPuzzle, filters: PuzzleQualityFilters): boolean {
  if (
    filters.minPopularity !== undefined &&
    puzzle.popularity !== undefined &&
    puzzle.popularity < filters.minPopularity
  ) {
    return false;
  }
  if (
    filters.maxRatingDeviation !== undefined &&
    puzzle.rating_deviation !== undefined &&
    puzzle.rating_deviation > filters.maxRatingDeviation
  ) {
    return false;
  }
  if (filters.minPlays !== undefined && puzzle.plays !== undefined && puzzle.plays < filters.minPlays) {
    return false;
  }
  if (filters.requiredThemes && filters.requiredThemes.length > 0) {
    if (!filters.requiredThemes.some((theme) => puzzle.themes.includes(theme))) return false;
  }
  if (filters.excludedThemes && filters.excludedThemes.length > 0) {
    if (filters.excludedThemes.some((theme) => puzzle.themes.includes(theme))) return false;
  }
  return true;
}

export function applyQualityFilters(
  puzzles: readonly StoredPuzzle[],
  filters: PuzzleQualityFilters | undefined,
): StoredPuzzle[] {
  if (!filters) return [...puzzles];
  return puzzles.filter((puzzle) => matchesQualityFilters(puzzle, filters));
}

/** Unique, quality-filtered puzzles eligible for a tier. */
export function eligiblePuzzles(
  puzzles: readonly StoredPuzzle[],
  tierSlug: string,
  filters?: PuzzleQualityFilters,
): StoredPuzzle[] {
  return dedupePuzzles(applyQualityFilters(puzzlesInTier(puzzles, tierSlug), filters));
}

export function selectRandomPuzzles(
  pool: readonly StoredPuzzle[],
  count: number,
  random: () => number,
): StoredPuzzle[] {
  if (count <= 0) return [];
  return shuffle(dedupePuzzles(pool), random).slice(0, Math.min(count, pool.length));
}

/**
 * Themes worth spreading a balanced set across, in priority order.
 *
 * The list follows the real Lichess vocabulary (73 themes measured in the
 * Open Puzzle Database). Motifs come first because Lichess puts phase and
 * quality tags (`endgame`, `crushing`, `short`) at the front of its `Themes`
 * column — bucketing on `themes[0]` alone would group half the library under
 * "crushing" instead of tactics. A puzzle is bucketed by the first entry it
 * carries; anything unrecognised falls back to `themes[0]`.
 */
export const BALANCE_THEME_PRIORITY: readonly string[] = [
  /* Motifs, most specific first. */
  'fork',
  'pin',
  'skewer',
  'discoveredAttack',
  'discoveredCheck',
  'doubleCheck',
  'sacrifice',
  'deflection',
  'attraction',
  'clearance',
  'interference',
  'intermezzo',
  'xRayAttack',
  'capturingDefender',
  'hangingPiece',
  'trappedPiece',
  'exposedKing',
  'quietMove',
  'zugzwang',
  'promotion',
  'underPromotion',
  'advancedPawn',
  'enPassant',
  'castling',
  'collinearMove',
  'attackingF2F7',
  /* Attacks and mate nets. */
  'kingsideAttack',
  'queensideAttack',
  'mateIn1',
  'mateIn2',
  'mateIn3',
  'mateIn4',
  'mateIn5',
  'backRankMate',
  'smotheredMate',
  'arabianMate',
  'anastasiaMate',
  'bodenMate',
  'dovetailMate',
  'hookMate',
  'killBoxMate',
  'morphysMate',
  'operaMate',
  'pillsburysMate',
  'vukovicMate',
  'doubleBishopMate',
  'cornerMate',
  'epauletteMate',
  'swallowstailMate',
  'triangleMate',
  'balestraMate',
  'blindSwineMate',
  /* Phases, only when the puzzle carries no motif. */
  'endgame',
  'middlegame',
  'opening',
];

export function balanceThemeOf(puzzle: StoredPuzzle, themes?: readonly string[]): string {
  const pool = themes ?? BALANCE_THEME_PRIORITY;
  for (const theme of pool) {
    if (puzzle.themes.includes(theme)) return theme;
  }
  return puzzle.themes[0] ?? 'untagged';
}

/**
 * Theme-balanced selection: one pick per theme bucket per pass, cycling until
 * the requested count is reached. The order inside each bucket is shuffled, so
 * the result is both spread across themes and reproducible from the seed.
 */
export function selectBalancedPuzzles(
  pool: readonly StoredPuzzle[],
  count: number,
  random: () => number,
  themes?: readonly string[],
): StoredPuzzle[] {
  const unique = dedupePuzzles(pool);
  if (count <= 0) return [];

  const buckets = new Map<string, StoredPuzzle[]>();
  for (const puzzle of shuffle(unique, random)) {
    const key = balanceThemeOf(puzzle, themes);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(puzzle);
    else buckets.set(key, [puzzle]);
  }

  /* Biggest buckets first so a small bucket is never starved by a large one. */
  const order = [...buckets.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([, bucket]) => bucket);

  const picked: StoredPuzzle[] = [];
  const taken = new Set<string>();
  while (picked.length < count) {
    let placed = false;
    for (const bucket of order) {
      if (picked.length >= count) break;
      const next = bucket.find((puzzle) => !taken.has(puzzle.puzzle_id));
      if (!next) continue;
      taken.add(next.puzzle_id);
      picked.push(next);
      placed = true;
    }
    if (!placed) break;
  }
  return picked;
}

export interface SelectionRequest {
  count: number;
  method: SelectionMethod;
  /** Pass a seeded generator; omit only when reproducibility does not matter. */
  random?: () => number;
  balanceThemes?: readonly string[];
}

/** Dispatches to the requested method over an already-filtered pool. */
export function selectPuzzles(pool: readonly StoredPuzzle[], request: SelectionRequest): StoredPuzzle[] {
  const random = request.random ?? Math.random;
  if (request.method === 'balanced') {
    return selectBalancedPuzzles(pool, request.count, random, request.balanceThemes);
  }
  return selectRandomPuzzles(pool, request.count, random);
}
