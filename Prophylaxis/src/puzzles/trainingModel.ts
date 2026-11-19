/**
 * Training-set math: ids, frozen membership and progress summaries.
 *
 * The persistence layer only reads and writes rows; every calculation that
 * decides what a cycle contains or how accurate it was lives here, so it can be
 * tested without a browser.
 *
 * Key invariant: cycle membership is *derived* from the training set's frozen
 * `puzzle_ids`. A cycle never owns a list of its own, which is what makes all
 * cycles of a set use exactly the same puzzles in exactly the same order.
 *
 * Pure module: Node-testable.
 */

import type {
  AttemptSummary,
  CycleProgressSummary,
  PuzzleAttempt,
  PuzzleCycleProgress,
  PuzzleTrainingSet,
  TrainingSetProgress,
} from './types.ts';

export function cycleId(setId: string, cycleNum: number): string {
  return `${setId}:${cycleNum}`;
}

export function attemptId(setId: string, cycleNum: number, puzzleId: string): string {
  return `${setId}:${cycleNum}:${puzzleId}`;
}

/** `[1, 2, …, target]` — the cycle numbers a set plans. */
export function cycleNumbers(target: number): number[] {
  const total = Math.max(0, Math.floor(target));
  return Array.from({ length: total }, (_, index) => index + 1);
}

/**
 * Order-sensitive fingerprint of a membership list. Two passes over the same
 * set must produce the same signature; a regenerated set must not.
 */
export function membershipSignature(puzzleIds: readonly string[]): string {
  let hash = 0x811c9dc5;
  for (const id of puzzleIds) {
    for (let index = 0; index < id.length; index += 1) {
      hash ^= id.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 0x2c; /* field separator, so ["ab","c"] ≠ ["a","bc"] */
    hash = Math.imul(hash, 0x01000193);
  }
  return `${puzzleIds.length}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/** The puzzles a cycle must ask for, in order. Read-only view of the set. */
export function cycleMembership(set: PuzzleTrainingSet, cycleNum: number): string[] {
  if (!Number.isInteger(cycleNum) || cycleNum < 1 || cycleNum > set.cycle_target) {
    throw new Error(`Cycle ${cycleNum} is outside "${set.name}" (1–${set.cycle_target}).`);
  }
  return [...set.puzzle_ids];
}

/** Guard for callers that resolved puzzles themselves (e.g. from IndexedDB). */
export function assertFrozenMembership(set: PuzzleTrainingSet, resolvedIds: readonly string[]): void {
  if (resolvedIds.length !== set.puzzle_ids.length) {
    throw new Error(
      `Training set "${set.name}" expects ${set.puzzle_ids.length} puzzles but ${resolvedIds.length} resolved.`,
    );
  }
  for (let index = 0; index < resolvedIds.length; index += 1) {
    if (resolvedIds[index] !== set.puzzle_ids[index]) {
      throw new Error(`Training set "${set.name}" membership changed at position ${index + 1}.`);
    }
  }
}

/**
 * Applies one attempt to a puzzle's row. The first attempt decides
 * `first_attempt_correct`; later correct attempts still mark the puzzle solved.
 */
export function mergeAttempt(
  existing: PuzzleAttempt | undefined,
  input: { correct: boolean; timeMs: number; at?: number },
): PuzzleAttempt {
  const at = input.at ?? Date.now();
  const timeMs = Math.max(0, Math.round(input.timeMs));

  if (!existing) {
    return {
      attempt_id: '',
      set_id: '',
      cycle_num: 0,
      puzzle_id: '',
      attempts: 1,
      first_attempt_correct: input.correct,
      incorrect: !input.correct,
      solved: input.correct,
      time_ms: timeMs,
      first_attempt_at: at,
      last_attempt_at: at,
      completed_at: input.correct ? at : null,
    };
  }

  return {
    ...existing,
    attempts: existing.attempts + 1,
    first_attempt_correct: existing.attempts === 0 ? input.correct : existing.first_attempt_correct,
    incorrect: existing.incorrect || !input.correct,
    solved: existing.solved || input.correct,
    time_ms: existing.time_ms + timeMs,
    last_attempt_at: at,
    completed_at: existing.completed_at ?? (input.correct ? at : null),
  };
}

/** Aggregates a cycle's puzzle rows. Accuracy counts first attempts only. */
export function summarizeAttempts(attempts: readonly PuzzleAttempt[]): AttemptSummary {
  let solved = 0;
  let correct = 0;
  let incorrect = 0;
  let attemptCount = 0;
  let timeMs = 0;

  for (const attempt of attempts) {
    if (attempt.solved) solved += 1;
    if (attempt.first_attempt_correct) correct += 1;
    if (attempt.incorrect) incorrect += 1;
    attemptCount += attempt.attempts;
    timeMs += attempt.time_ms;
  }

  const firstAttempts = attempts.length;
  return {
    solved_count: solved,
    correct_count: correct,
    incorrect_count: incorrect,
    attempt_count: attemptCount,
    first_attempt_accuracy: firstAttempts > 0 ? Math.round((correct / firstAttempts) * 100) : 0,
    total_solve_time_ms: timeMs,
  };
}

/** Rebuilds one cycle row from its puzzle rows (used after every attempt). */
export function buildCycleProgress(
  set: PuzzleTrainingSet,
  cycleNum: number,
  attempts: readonly PuzzleAttempt[],
  options: { status?: PuzzleCycleProgress['status']; completedAt?: number | null } = {},
): PuzzleCycleProgress {
  const summary = summarizeAttempts(attempts);
  const startedAt = attempts.reduce<number | null>(
    (earliest, attempt) => (earliest === null || attempt.first_attempt_at < earliest ? attempt.first_attempt_at : earliest),
    null,
  );
  const completedAt = options.completedAt ?? null;
  const status =
    options.status ??
    (completedAt !== null ? 'completed' : summary.attempt_count > 0 ? 'in-progress' : 'pending');

  return {
    cycle_id: cycleId(set.set_id, cycleNum),
    set_id: set.set_id,
    cycle_num: cycleNum,
    status,
    started_at: startedAt,
    completed_at: completedAt,
    elapsed_ms: completedAt !== null && startedAt !== null ? Math.max(0, completedAt - startedAt) : 0,
    total_solve_time_ms: summary.total_solve_time_ms,
    solved_count: summary.solved_count,
    correct_count: summary.correct_count,
    incorrect_count: summary.incorrect_count,
    attempt_count: summary.attempt_count,
    first_attempt_accuracy: summary.first_attempt_accuracy,
  };
}

/** Overall training progress: cycle states plus the whole programme's totals. */
export function summarizeSetProgress(
  set: PuzzleTrainingSet,
  cycles: readonly PuzzleCycleProgress[],
  attempts: readonly PuzzleAttempt[],
): TrainingSetProgress {
  const ordered = [...cycles].sort((a, b) => a.cycle_num - b.cycle_num);
  const completed = ordered.filter((cycle) => cycle.status === 'completed').length;
  const started = ordered.filter((cycle) => cycle.status !== 'pending').length;

  const solvedIds = new Set<string>();
  let correct = 0;
  let firstAttempts = 0;
  let attemptCount = 0;
  let totalTime = 0;

  for (const attempt of attempts) {
    if (attempt.solved) solvedIds.add(attempt.puzzle_id);
    if (attempt.first_attempt_correct) correct += 1;
    firstAttempts += 1;
    attemptCount += attempt.attempts;
    totalTime += attempt.time_ms;
  }

  const summaries: CycleProgressSummary[] = ordered.map((cycle) => ({
    cycle_id: cycle.cycle_id,
    cycle_num: cycle.cycle_num,
    status: cycle.status,
    started_at: cycle.started_at,
    completed_at: cycle.completed_at,
    elapsed_ms: cycle.elapsed_ms,
    solved_count: cycle.solved_count,
    correct_count: cycle.correct_count,
    incorrect_count: cycle.incorrect_count,
    attempt_count: cycle.attempt_count,
    first_attempt_accuracy: cycle.first_attempt_accuracy,
    total_solve_time_ms: cycle.total_solve_time_ms,
  }));

  return {
    set_id: set.set_id,
    tier_slug: set.tier_slug,
    puzzle_count: set.puzzle_ids.length,
    cycle_target: set.cycle_target,
    cycles_started: started,
    cycles_completed: completed,
    puzzles_solved_ever: solvedIds.size,
    first_attempt_accuracy: firstAttempts > 0 ? Math.round((correct / firstAttempts) * 100) : 0,
    attempt_count: attemptCount,
    total_time_ms: totalTime,
    percent_complete:
      set.cycle_target > 0 ? Math.round((completed / set.cycle_target) * 100) : 0,
    cycles: summaries,
  };
}

/** Which cycle to open next: first unfinished, else the last planned one. */
export function nextCycleNumber(set: PuzzleTrainingSet, cycles: readonly PuzzleCycleProgress[]): number {
  const ordered = [...cycles].sort((a, b) => a.cycle_num - b.cycle_num);
  const pending = ordered.find((cycle) => cycle.status !== 'completed');
  if (pending) return pending.cycle_num;
  return ordered.length === 0 ? 1 : set.cycle_target;
}
