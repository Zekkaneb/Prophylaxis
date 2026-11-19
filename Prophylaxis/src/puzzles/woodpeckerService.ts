import {
  db,
  type Puzzle,
  type WoodpeckerCycleResult,
  type WoodpeckerSet,
} from '../db';
import { buildFallbackPuzzles, type PuzzleTier } from './puzzleTiers';
import { assetUrl } from '../assets/assetUrl';
import { normalizePuzzle } from './shardPlan.ts';
import { MIN_TIER_POOL, loadTierManifest, seedTierFromShards } from './shardStore.ts';

export { normalizePuzzle };

/* -------------------------------------------------------------------------- */
/*                            Active session (localStorage)                   */
/* -------------------------------------------------------------------------- */

const SESSION_KEY = 'chess-trainer.woodpecker.session.v1';

/** What happened to one puzzle of a cycle: solved, or skipped after a miss. */
export type PuzzleOutcome = 'solved' | 'missed';

/** Survives refreshes so an interrupted cycle can be resumed instantly. */
export interface WoodpeckerSession {
  activeSetId: string | null;
  currentIndex: number;
  elapsedSeconds: number;
  correctCount: number;
  cycle: number;
  /** One entry per finished puzzle, in order; drives the progress dots. */
  outcomes: PuzzleOutcome[];
}

const EMPTY_SESSION: WoodpeckerSession = {
  activeSetId: null,
  currentIndex: 0,
  elapsedSeconds: 0,
  correctCount: 0,
  cycle: 1,
  outcomes: [],
};

export function readWoodpeckerSession(): WoodpeckerSession {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return { ...EMPTY_SESSION };
    const parsed = JSON.parse(raw) as Partial<WoodpeckerSession>;
    return {
      activeSetId: typeof parsed.activeSetId === 'string' ? parsed.activeSetId : null,
      currentIndex: Number.isFinite(parsed.currentIndex) ? Number(parsed.currentIndex) : 0,
      elapsedSeconds: Number.isFinite(parsed.elapsedSeconds) ? Number(parsed.elapsedSeconds) : 0,
      correctCount: Number.isFinite(parsed.correctCount) ? Number(parsed.correctCount) : 0,
      cycle: Number.isFinite(parsed.cycle) ? Number(parsed.cycle) : 1,
      outcomes: Array.isArray(parsed.outcomes)
        ? parsed.outcomes.filter(
            (value): value is PuzzleOutcome => value === 'solved' || value === 'missed',
          )
        : [],
    };
  } catch (error) {
    console.warn('Could not read the Woodpecker session:', error);
    return { ...EMPTY_SESSION };
  }
}

export function saveWoodpeckerSession(session: WoodpeckerSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (error) {
    console.warn('Could not persist the Woodpecker session:', error);
  }
}

export function clearWoodpeckerSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (error) {
    console.warn('Could not clear the Woodpecker session:', error);
  }
}

/** True while a set is mid-cycle, so the app can reopen the trainer on reload. */
export function hasActiveWoodpeckerSession(): boolean {
  return readWoodpeckerSession().activeSetId !== null;
}

/* -------------------------------------------------------------------------- */
/*                                   Seeding                                  */
/* -------------------------------------------------------------------------- */

/** `shard` = rows came from a published shard pool; `remote` = legacy tier file. */
export type SeedSource = 'cache' | 'shard' | 'remote' | 'fallback';

export interface SeedSummary {
  source: SeedSource;
  count: number;
}

async function loadTierFile(tier: PuzzleTier): Promise<Puzzle[]> {
  const response = await fetch(assetUrl(tier.file));
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${tier.file}`);

  const payload = (await response.json()) as unknown;
  const entries = Array.isArray(payload)
    ? payload
    : (payload as { puzzles?: unknown[] } | null)?.puzzles;

  if (!Array.isArray(entries)) throw new Error(`Unexpected payload in ${tier.file}`);

  const puzzles = entries
    .map(normalizePuzzle)
    .filter((puzzle): puzzle is Puzzle => puzzle !== null)
    .filter((puzzle) => puzzle.rating >= tier.minRating && puzzle.rating <= tier.maxRating);

  if (puzzles.length === 0) throw new Error(`No usable puzzles in ${tier.file}`);
  return puzzles;
}

/**
 * Ensures the tier has enough puzzles in IndexedDB to sample from.
 *
 * Order of preference:
 * 1. a shard manifest (`/puzzles/{slug}/manifest.json`) — download only the
 *    shards needed to reach `minPool`, recording each in Dexie;
 * 2. the legacy single-tier chunk (`/puzzles/{slug}.json`), exactly as before;
 * 3. the built-in mock pool, so the trainer always works offline.
 *
 * Downloads are additive and idempotent: existing rows are refreshed by id,
 * never deleted, so saved sets keep resolving their frozen membership.
 */
export async function ensureTierSeeded(
  tier: PuzzleTier,
  options: { minPool?: number } = {},
): Promise<SeedSummary> {
  const minPool = Math.max(1, Math.floor(options.minPool ?? MIN_TIER_POOL));

  const manifest = await loadTierManifest(tier, { resolveUrl: assetUrl });
  if (manifest) {
    const result = await seedTierFromShards(tier, {
      manifest,
      targetCount: minPool,
      resolveUrl: assetUrl,
    });

    if (result.failed.length > 0) {
      console.warn(
        `Could not download ${result.failed.length} ${tier.name} shard(s):`,
        result.error,
      );
    }
    if (result.count > 0) {
      return { source: result.source === 'cache' ? 'cache' : 'shard', count: result.count };
    }
    // Nothing local and nothing downloadable — fall through to the legacy file.
  }

  const existing = await db.puzzles
    .where('rating')
    .between(tier.minRating, tier.maxRating, true, true)
    .count();

  if (existing > 0) return { source: 'cache', count: existing };

  try {
    const puzzles = await loadTierFile(tier);
    await db.puzzles.bulkPut(puzzles);
    return { source: 'remote', count: puzzles.length };
  } catch (cause) {
    console.warn(`Falling back to mock puzzles for ${tier.name}:`, cause);
    const puzzles = buildFallbackPuzzles(tier);
    await db.puzzles.bulkPut(puzzles);
    return { source: 'fallback', count: puzzles.length };
  }
}

/* -------------------------------------------------------------------------- */
/*                             Set creation / reads                           */
/* -------------------------------------------------------------------------- */

function sample<T>(items: T[], size: number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = copy[i];
    copy[i] = copy[j];
    copy[j] = swap;
  }
  return copy.slice(0, size);
}

export interface CreatedWoodpeckerSet {
  set: WoodpeckerSet;
  seed: SeedSummary;
  /** How many puzzles the tier actually holds (may be below the requested pool). */
  available: number;
}

/** Programme settings chosen in the trainer's set form. */
export interface WoodpeckerSetOptions {
  /** Planned cycles; 0/omitted means the set repeats indefinitely. */
  cycles?: number;
  /** Per-cycle time budget in seconds; 0/omitted means no limit. */
  timeLimitSeconds?: number;
}

/** Samples the tier and freezes a brand new set with a fixed order. */
export async function createWoodpeckerSet(
  tier: PuzzleTier,
  poolSize: number,
  options: WoodpeckerSetOptions = {},
): Promise<CreatedWoodpeckerSet> {
  const cycles = Math.floor(options.cycles ?? 0);
  const timeLimitSeconds = Math.floor(options.timeLimitSeconds ?? 0);
  if (!Number.isFinite(cycles) || cycles < 0 || cycles > 100) {
    throw new Error('A programme can plan between 0 (unlimited) and 100 cycles.');
  }
  if (!Number.isFinite(timeLimitSeconds) || timeLimitSeconds < 0 || timeLimitSeconds > 7200) {
    throw new Error('The time limit must be between 0 and 120 minutes.');
  }

  // Ask for enough local puzzles for the requested set; the service downloads
  // additional shards only when the local pool cannot satisfy it.
  const seed = await ensureTierSeeded(tier, { minPool: Math.max(poolSize, 1) });

  const pool = await db.puzzles
    .where('rating')
    .between(tier.minRating, tier.maxRating, true, true)
    .toArray();

  if (pool.length === 0) {
    throw new Error(`No puzzles are stored for the ${tier.name} tier.`);
  }

  const count = Math.max(1, Math.min(poolSize, pool.length));
  const selected = sample(pool, count);

  const set: WoodpeckerSet = {
    set_id: `wp-${tier.slug}-${Date.now().toString(36)}`,
    tier_name: tier.name,
    puzzle_ids: selected.map((puzzle) => puzzle.puzzle_id),
    current_cycle: 1,
    history: [],
    created_at: Date.now(),
    cycle_target: cycles > 0 ? cycles : undefined,
    time_limit_seconds: timeLimitSeconds > 0 ? timeLimitSeconds : undefined,
  };

  await db.woodpecker_sets.add(set);
  return { set, seed, available: pool.length };
}

export async function listWoodpeckerSets(): Promise<WoodpeckerSet[]> {
  return db.woodpecker_sets.orderBy('created_at').reverse().toArray();
}

export async function deleteWoodpeckerSet(setId: string): Promise<void> {
  await db.woodpecker_sets.delete(setId);
}

export async function getPuzzle(puzzleId: string): Promise<Puzzle | undefined> {
  return db.puzzles.get(puzzleId);
}

/* -------------------------------------------------------------------------- */
/*                              Cycle completion                              */
/* -------------------------------------------------------------------------- */

export interface CompletedCycle {
  set: WoodpeckerSet;
  result: WoodpeckerCycleResult;
}

/**
 * Appends the finished cycle to the set history, increments `current_cycle`
 * and keeps the frozen `puzzle_ids` untouched for the next pass.
 */
export async function completeCycle(
  set: WoodpeckerSet,
  correctCount: number,
  elapsedSeconds: number,
): Promise<CompletedCycle> {
  const result: WoodpeckerCycleResult = {
    cycle_num: set.current_cycle,
    total_time_seconds: Math.max(0, Math.round(elapsedSeconds)),
    correct_count: Math.max(0, Math.min(correctCount, set.puzzle_ids.length)),
    total_count: set.puzzle_ids.length,
  };

  // A planned programme stops counting up once its last cycle is done; the
  // final cycle can be replayed without inventing a "cycle 8 of 7".
  const target = set.cycle_target ?? 0;
  const nextCycle =
    target > 0 && set.current_cycle >= target ? set.current_cycle : set.current_cycle + 1;

  const updated: WoodpeckerSet = {
    ...set,
    current_cycle: nextCycle,
    history: [...set.history, result],
  };

  await db.woodpecker_sets.put(updated);
  return { set: updated, result };
}
