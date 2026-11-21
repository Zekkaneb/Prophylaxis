/**
 * Training sets: persistence for frozen puzzle collections, cycles and attempts.
 *
 * Three tables, three responsibilities — deliberately separate so that a set
 * definition can never be mutated by progress:
 *
 *   puzzle_sets     one row per training set; `puzzle_ids` is written once
 *   puzzle_cycles   one row per planned pass over that set (status + totals)
 *   puzzle_attempts one row per puzzle per cycle (attempts, time, correctness)
 *
 * Everything numeric is derived by `trainingModel.ts`; this module only moves
 * rows in and out of IndexedDB.
 */

import { db } from '../db.ts';
import { recordSyncedChange } from '../sync/outbox.ts';
import { DEFAULT_QUALITY_FILTERS } from './types.ts';
import type {
  PuzzleAttempt,
  PuzzleCycleProgress,
  PuzzleTrainingSet,
  StoredPuzzle,
  TrainingSetConfig,
  TrainingSetProgress,
} from './types.ts';
import { PUZZLE_TIER_BANDS, getTierBand } from './tiers.ts';
import { eligiblePuzzles, hashSeed, mulberry32, selectPuzzles } from './selection.ts';
import {
  attemptId,
  assertFrozenMembership,
  buildCycleProgress,
  cycleId,
  cycleMembership,
  cycleNumbers,
  mergeAttempt,
  summarizeSetProgress,
} from './trainingModel.ts';

/** Guard rails for the configuration form, not a limit on the library. */
const MAX_PUZZLE_COUNT = 5000;
const MAX_CYCLES = 100;

/* -------------------------------------------------------------------------- */
/*                              Library imports                               */
/* -------------------------------------------------------------------------- */

export interface ImportSummary {
  /** Rows that were not in the table before. */
  inserted: number;
  /** Rows whose id already existed and were refreshed. */
  updated: number;
  /** Same id twice in the input; only the first copy is stored. */
  duplicates: number;
  /** Rows missing a primary key, FEN or move list. */
  rejected: number;
}

/**
 * Idempotent bulk upsert. Duplicate ids are collapsed, so replaying a CSV
 * import (or concatenating two exports) never creates a second row.
 */
export async function importPuzzles(puzzles: readonly StoredPuzzle[]): Promise<ImportSummary> {
  const unique = new Map<string, StoredPuzzle>();
  let duplicates = 0;
  let rejected = 0;

  for (const puzzle of puzzles) {
    if (!puzzle.puzzle_id?.trim() || !puzzle.fen?.trim() || !puzzle.moves?.trim()) {
      rejected += 1;
      continue;
    }
    if (unique.has(puzzle.puzzle_id)) {
      duplicates += 1;
      continue;
    }
    unique.set(puzzle.puzzle_id, puzzle);
  }

  const rows = [...unique.values()];
  const existing = rows.length > 0 ? await db.puzzles.bulkGet(rows.map((row) => row.puzzle_id)) : [];
  await db.puzzles.bulkPut(rows);

  let inserted = 0;
  let updated = 0;
  rows.forEach((_, index) => {
    if (existing[index]) updated += 1;
    else inserted += 1;
  });

  return { inserted, updated, duplicates, rejected };
}

export interface LibraryStats {
  total: number;
  /** Tier slug → puzzles stored in that band. */
  byTier: Record<string, number>;
}

/** How much of the library each difficulty tier can draw from. */
export async function getLibraryStats(): Promise<LibraryStats> {
  const total = await db.puzzles.count();
  const byTier: Record<string, number> = {};
  for (const band of PUZZLE_TIER_BANDS) {
    byTier[band.slug] = await db.puzzles
      .where('rating')
      .between(band.minRating, band.maxRating, true, true)
      .count();
  }
  return { total, byTier };
}

/* -------------------------------------------------------------------------- */
/*                              Set definitions                               */
/* -------------------------------------------------------------------------- */

export interface CreatedTrainingSet {
  set: PuzzleTrainingSet;
  /** Eligible puzzles the tier offered before selection. */
  available: number;
  /** Puzzles asked for (equal to `set.puzzle_ids.length`). */
  requested: number;
}

/**
 * Freezes a new training set.
 *
 * The pool is the tier's rating band from the puzzle library, narrowed by the
 * quality filters and deduplicated, then sampled with a seeded PRNG. The chosen
 * ids are stored in order and never rewritten — every later cycle replays this
 * exact list.
 */
export async function createTrainingSet(config: TrainingSetConfig): Promise<CreatedTrainingSet> {
  const band = getTierBand(config.tier);
  if (!band) throw new Error(`Unknown difficulty tier "${config.tier}".`);

  if (!Number.isInteger(config.puzzleCount) || config.puzzleCount < 1) {
    throw new Error('A training set needs at least one puzzle.');
  }
  if (config.puzzleCount > MAX_PUZZLE_COUNT) {
    throw new Error(`A training set can hold at most ${MAX_PUZZLE_COUNT} puzzles.`);
  }
  if (!Number.isInteger(config.cycles) || config.cycles < 1) {
    throw new Error('A training programme needs at least one cycle.');
  }
  if (config.cycles > MAX_CYCLES) {
    throw new Error(`A training programme can plan at most ${MAX_CYCLES} cycles.`);
  }
  if (config.selection !== 'random' && config.selection !== 'balanced') {
    throw new Error(`Unknown selection method "${config.selection}".`);
  }

  const quality = { ...DEFAULT_QUALITY_FILTERS, ...(config.quality ?? {}) };
  const pool = await db.puzzles
    .where('rating')
    .between(band.minRating, band.maxRating, true, true)
    .toArray();

  const eligible = eligiblePuzzles(pool, config.tier, quality);
  if (eligible.length < config.puzzleCount) {
    throw new Error(
      `Only ${eligible.length} eligible ${band.name} puzzles are stored; ${config.puzzleCount} requested. ` +
        'Import more puzzles or relax the quality filters.',
    );
  }

  const seed = config.seed ?? hashSeed(`${config.tier}:${Date.now()}:${Math.random()}`);
  const selected = selectPuzzles(eligible, {
    count: config.puzzleCount,
    method: config.selection,
    random: mulberry32(seed),
    balanceThemes: config.balanceThemes,
  });

  if (selected.length < config.puzzleCount) {
    throw new Error(
      `Selection produced ${selected.length} puzzles but ${config.puzzleCount} were requested.`,
    );
  }

  const set: PuzzleTrainingSet = {
    set_id: `set-${config.tier}-${Date.now().toString(36)}-${seed.toString(36).slice(-4)}`,
    name: config.name?.trim() || `${band.name} · ${selected.length} puzzles`,
    tier_slug: config.tier,
    tier_name: band.name,
    selection_method: config.selection,
    puzzle_count: selected.length,
    cycle_target: config.cycles,
    quality_filters: quality,
    seed,
    puzzle_ids: selected.map((puzzle) => puzzle.puzzle_id),
    created_at: Date.now(),
  };

  const cycles = cycleNumbers(config.cycles).map((cycleNum) => buildCycleProgress(set, cycleNum, []));

  await db.transaction('rw', db.puzzle_sets, db.puzzle_cycles, async () => {
    await db.puzzle_sets.add(set);
    await db.puzzle_cycles.bulkAdd(cycles);
  });

  /* A set is one row plus one row per cycle; every one of them is a change the
     other devices need, so the set cannot arrive without its cycles. */
  await recordSyncedChange('puzzle_sets', set.set_id, false);
  for (const cycle of cycles) {
    await recordSyncedChange('puzzle_cycles', cycle.cycle_id, false);
  }

  return { set, available: eligible.length, requested: config.puzzleCount };
}

export async function getTrainingSet(setId: string): Promise<PuzzleTrainingSet | undefined> {
  return db.puzzle_sets.get(setId);
}

/** Newest first. */
export async function listTrainingSets(): Promise<PuzzleTrainingSet[]> {
  return db.puzzle_sets.orderBy('created_at').reverse().toArray();
}

/** Removes a set and everything recorded against it. */
export async function deleteTrainingSet(setId: string): Promise<void> {
  /* Ids first: after the delete there is nothing left to name the tombstones. */
  const [attemptIds, cycleIds] = await Promise.all([
    db.puzzle_attempts.where('set_id').equals(setId).primaryKeys(),
    db.puzzle_cycles.where('set_id').equals(setId).primaryKeys(),
  ]);

  await db.transaction('rw', db.puzzle_sets, db.puzzle_cycles, db.puzzle_attempts, async () => {
    await db.puzzle_attempts.where('set_id').equals(setId).delete();
    await db.puzzle_cycles.where('set_id').equals(setId).delete();
    await db.puzzle_sets.delete(setId);
  });

  for (const id of attemptIds) await recordSyncedChange('puzzle_attempts', String(id), true);
  for (const id of cycleIds) await recordSyncedChange('puzzle_cycles', String(id), true);
  await recordSyncedChange('puzzle_sets', setId, true);
}

export async function getTrainingCycles(setId: string): Promise<PuzzleCycleProgress[]> {
  const rows = await db.puzzle_cycles.where('set_id').equals(setId).toArray();
  return rows.sort((a, b) => a.cycle_num - b.cycle_num);
}

export async function getTrainingCycle(
  setId: string,
  cycleNum: number,
): Promise<PuzzleCycleProgress | undefined> {
  return db.puzzle_cycles.get(cycleId(setId, cycleNum));
}

/**
 * The puzzles for a cycle, in the set's frozen order.
 *
 * Membership is read from the set every time — cycles have no list of their
 * own, so cycle 1 and cycle 7 cannot drift apart.
 */
export async function getCyclePuzzles(
  setId: string,
  cycleNum: number,
): Promise<{ set: PuzzleTrainingSet; cycle: PuzzleCycleProgress | undefined; puzzles: StoredPuzzle[] }> {
  const set = await getTrainingSet(setId);
  if (!set) throw new Error(`Training set "${setId}" does not exist.`);

  const ids = cycleMembership(set, cycleNum);
  const rows = await db.puzzles.bulkGet(ids);
  const puzzles = rows.filter((row): row is StoredPuzzle => row !== undefined);
  if (puzzles.length !== ids.length) {
    const missing = ids.filter((_, index) => rows[index] === undefined);
    throw new Error(
      `${missing.length} puzzle(s) in "${set.name}" are missing from the library: ${missing.slice(0, 5).join(', ')}.`,
    );
  }
  assertFrozenMembership(set, puzzles.map((puzzle) => puzzle.puzzle_id));

  return { set, cycle: await getTrainingCycle(setId, cycleNum), puzzles };
}

/* -------------------------------------------------------------------------- */
/*                             Progress recording                             */
/* -------------------------------------------------------------------------- */

export interface AttemptInput {
  correct: boolean;
  /** Time spent on this attempt, ms. */
  timeMs: number;
  /** Epoch ms; defaults to now. */
  at?: number;
}

/**
 * Records one attempt on one puzzle of one cycle and refreshes that cycle's
 * totals. Attempts in different cycles never touch each other.
 */
export async function recordAttempt(
  setId: string,
  cycleNum: number,
  puzzleId: string,
  input: AttemptInput,
): Promise<{ attempt: PuzzleAttempt; cycle: PuzzleCycleProgress }> {
  const set = await getTrainingSet(setId);
  if (!set) throw new Error(`Training set "${setId}" does not exist.`);

  cycleMembership(set, cycleNum);
  if (!set.puzzle_ids.includes(puzzleId)) {
    throw new Error(`Puzzle "${puzzleId}" is not part of "${set.name}".`);
  }

  const id = attemptId(setId, cycleNum, puzzleId);
  let attempt: PuzzleAttempt | undefined;
  let cycle: PuzzleCycleProgress | undefined;

  await db.transaction('rw', db.puzzle_attempts, db.puzzle_cycles, async () => {
    const existing = await db.puzzle_attempts.get(id);
    const merged = mergeAttempt(existing, input);
    const row: PuzzleAttempt = {
      ...merged,
      attempt_id: id,
      set_id: setId,
      cycle_num: cycleNum,
      puzzle_id: puzzleId,
    };
    await db.puzzle_attempts.put(row);

    const cycleRows = await db.puzzle_attempts
      .where('[set_id+cycle_num]')
      .equals([setId, cycleNum])
      .toArray();
    const current = await db.puzzle_cycles.get(cycleId(setId, cycleNum));
    const updated = buildCycleProgress(set, cycleNum, cycleRows, {
      status: current?.status === 'completed' ? 'completed' : undefined,
      completedAt: current?.completed_at ?? null,
    });
    await db.puzzle_cycles.put(updated);

    attempt = row;
    cycle = updated;
  });

  if (!attempt || !cycle) throw new Error('Could not record that attempt.');
  await recordSyncedChange('puzzle_attempts', attempt.attempt_id, false);
  await recordSyncedChange('puzzle_cycles', cycle.cycle_id, false);
  return { attempt, cycle };
}

/** Closes a cycle: status, completion time and final totals are frozen. */
export async function completeCycle(setId: string, cycleNum: number): Promise<PuzzleCycleProgress> {
  const set = await getTrainingSet(setId);
  if (!set) throw new Error(`Training set "${setId}" does not exist.`);
  cycleMembership(set, cycleNum);

  const rows = await db.puzzle_attempts
    .where('[set_id+cycle_num]')
    .equals([setId, cycleNum])
    .toArray();

  const current = await db.puzzle_cycles.get(cycleId(setId, cycleNum));
  const completedAt = current?.completed_at ?? Date.now();
  const updated = buildCycleProgress(set, cycleNum, rows, {
    status: 'completed',
    completedAt,
  });

  await db.puzzle_cycles.put(updated);
  await recordSyncedChange('puzzle_cycles', updated.cycle_id, false);
  return updated;
}

/** One cycle's puzzle rows, for history views. */
export async function getCycleAttempts(setId: string, cycleNum: number): Promise<PuzzleAttempt[]> {
  return db.puzzle_attempts.where('[set_id+cycle_num]').equals([setId, cycleNum]).sortBy('puzzle_id');
}

/** Cycles + overall training progress for one set. */
export async function getSetProgress(setId: string): Promise<TrainingSetProgress> {
  const set = await getTrainingSet(setId);
  if (!set) throw new Error(`Training set "${setId}" does not exist.`);

  const [cycles, attempts] = await Promise.all([
    getTrainingCycles(setId),
    db.puzzle_attempts.where('set_id').equals(setId).toArray(),
  ]);

  return summarizeSetProgress(set, cycles, attempts);
}
