/**
 * Training model: frozen membership, seven-cycle consistency and progress math.
 *
 * These are the invariants the persistence layer relies on, tested without a
 * browser: cycles never own a puzzle list, so all seven passes derive from the
 * same frozen `puzzle_ids`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { PuzzleAttempt, PuzzleTrainingSet } from '../../src/puzzles/types.ts';
import {
  assertFrozenMembership,
  attemptId,
  buildCycleProgress,
  cycleId,
  cycleMembership,
  cycleNumbers,
  membershipSignature,
  mergeAttempt,
  nextCycleNumber,
  summarizeAttempts,
  summarizeSetProgress,
} from '../../src/puzzles/trainingModel.ts';

function makeSet(overrides: Partial<PuzzleTrainingSet> = {}): PuzzleTrainingSet {
  const ids = Array.from({ length: 200 }, (_, index) => `p${String(index + 1).padStart(3, '0')}`);
  return {
    set_id: 'set-intermediate-test',
    name: 'Intermediate · 200 puzzles',
    tier_slug: 'intermediate',
    tier_name: 'Intermediate',
    selection_method: 'random',
    puzzle_count: ids.length,
    cycle_target: 7,
    quality_filters: { minPopularity: 80 },
    seed: 42,
    puzzle_ids: ids,
    created_at: 1_700_000_000_000,
    ...overrides,
  };
}

function attempt(
  setId: string,
  cycleNum: number,
  puzzleId: string,
  patch: Partial<PuzzleAttempt> = {},
): PuzzleAttempt {
  return {
    attempt_id: attemptId(setId, cycleNum, puzzleId),
    set_id: setId,
    cycle_num: cycleNum,
    puzzle_id: puzzleId,
    attempts: 1,
    first_attempt_correct: true,
    incorrect: false,
    solved: true,
    time_ms: 5000,
    first_attempt_at: 1_700_000_000_000,
    last_attempt_at: 1_700_000_005_000,
    completed_at: 1_700_000_005_000,
    ...patch,
  };
}

test('plans 1-based cycle numbers', () => {
  assert.deepEqual(cycleNumbers(7), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(cycleNumbers(0), []);
  assert.deepEqual(cycleNumbers(2.9), [1, 2]);
});

test('membership signatures are stable and order sensitive', () => {
  const ids = ['a', 'b', 'c'];
  assert.equal(membershipSignature(ids), membershipSignature(['a', 'b', 'c']));
  assert.notEqual(membershipSignature(ids), membershipSignature(['c', 'b', 'a']));
  assert.notEqual(membershipSignature(['ab', 'c']), membershipSignature(['a', 'bc']));
  assert.match(membershipSignature(ids), /^3:/);
});

test('all seven cycles use exactly the same 200 puzzles in the same order', () => {
  const set = makeSet();
  assert.equal(set.puzzle_ids.length, 200);

  const signature = membershipSignature(set.puzzle_ids);
  const cycles = cycleNumbers(set.cycle_target).map((cycleNum) => {
    const membership = cycleMembership(set, cycleNum);
    assert.equal(membership.length, 200);
    assert.equal(membershipSignature(membership), signature, `cycle ${cycleNum}`);
    return cycleNum;
  });

  assert.deepEqual(cycles, [1, 2, 3, 4, 5, 6, 7]);
});

test('cycleMembership returns a copy, so callers cannot edit the frozen set', () => {
  const set = makeSet();
  const membership = cycleMembership(set, 1);
  membership[0] = 'tampered';

  assert.notEqual(set.puzzle_ids[0], 'tampered');
  assert.equal(membershipSignature(set.puzzle_ids), membershipSignature(cycleMembership(set, 7)));
});

test('cycle numbers outside the programme are rejected', () => {
  const set = makeSet();
  assert.throws(() => cycleMembership(set, 0), /outside/);
  assert.throws(() => cycleMembership(set, 8), /outside/);
  assert.throws(() => cycleMembership(set, 1.5), /outside/);
});

test('frozen membership guard catches missing or reordered puzzles', () => {
  const set = makeSet();
  assert.doesNotThrow(() => assertFrozenMembership(set, set.puzzle_ids));

  const reordered = [...set.puzzle_ids];
  const first = reordered[0];
  reordered[0] = reordered[1];
  reordered[1] = first;
  assert.throws(() => assertFrozenMembership(set, reordered), /membership changed/);

  assert.throws(() => assertFrozenMembership(set, set.puzzle_ids.slice(0, 199)), /expects 200/);
});

test('an attempt row records the first result and accumulates time', () => {
  const first = mergeAttempt(undefined, { correct: false, timeMs: 4000, at: 100 });
  assert.equal(first.first_attempt_correct, false);
  assert.equal(first.incorrect, true);
  assert.equal(first.solved, false);
  assert.equal(first.attempts, 1);
  assert.equal(first.completed_at, null);

  const second = mergeAttempt(first, { correct: true, timeMs: 6000, at: 200 });
  assert.equal(second.attempts, 2);
  assert.equal(second.first_attempt_correct, false, 'the first attempt stays the first attempt');
  assert.equal(second.incorrect, true);
  assert.equal(second.solved, true);
  assert.equal(second.time_ms, 10_000);
  assert.equal(second.completed_at, 200);
});

test('summarizes accuracy from first attempts only', () => {
  const rows = [
    attempt('s', 1, 'p1'),
    attempt('s', 1, 'p2'),
    attempt('s', 1, 'p3', {
      first_attempt_correct: false,
      incorrect: true,
      attempts: 2,
      time_ms: 9000,
    }),
  ];

  const summary = summarizeAttempts(rows);
  assert.equal(summary.solved_count, 3);
  assert.equal(summary.correct_count, 2);
  assert.equal(summary.incorrect_count, 1);
  assert.equal(summary.attempt_count, 4);
  assert.equal(summary.first_attempt_accuracy, 67);
  assert.equal(summary.total_solve_time_ms, 19_000);
});

test('buildCycleProgress moves pending → in-progress → completed', () => {
  const set = makeSet();

  const pending = buildCycleProgress(set, 1, []);
  assert.equal(pending.status, 'pending');
  assert.equal(pending.started_at, null);
  assert.equal(pending.elapsed_ms, 0);

  const rows = [
    attempt('set-intermediate-test', 1, 'p1', { first_attempt_at: 1000, last_attempt_at: 3000, completed_at: 3000 }),
    attempt('set-intermediate-test', 1, 'p2', { first_attempt_at: 4000, last_attempt_at: 6000, completed_at: 6000 }),
  ];

  const running = buildCycleProgress(set, 1, rows);
  assert.equal(running.status, 'in-progress');
  assert.equal(running.started_at, 1000);
  assert.equal(running.solved_count, 2);
  assert.equal(running.first_attempt_accuracy, 100);
  assert.equal(running.elapsed_ms, 0);

  const done = buildCycleProgress(set, 1, rows, { status: 'completed', completedAt: 10_000 });
  assert.equal(done.status, 'completed');
  assert.equal(done.completed_at, 10_000);
  assert.equal(done.elapsed_ms, 9000, 'from first attempt to completion');
  assert.equal(done.total_solve_time_ms, 10_000);
});

test('cycles keep independent progress', () => {
  const set = makeSet();
  const cycle1 = [attempt(set.set_id, 1, 'p1')];
  const cycle7 = [
    attempt(set.set_id, 7, 'p1', { first_attempt_correct: false, incorrect: true, attempts: 2 }),
  ];

  const first = buildCycleProgress(set, 1, cycle1);
  const seventh = buildCycleProgress(set, 7, cycle7);
  const untouched = buildCycleProgress(set, 2, []);

  assert.equal(first.first_attempt_accuracy, 100);
  assert.equal(first.correct_count, 1);
  assert.equal(seventh.first_attempt_accuracy, 0);
  assert.equal(seventh.incorrect_count, 1);
  assert.equal(seventh.attempt_count, 2);
  assert.equal(untouched.status, 'pending');
  assert.equal(untouched.attempt_count, 0);

  assert.notEqual(first.cycle_id, seventh.cycle_id);
  assert.equal(first.cycle_id, cycleId(set.set_id, 1));
});

test('attempt ids never collide across cycles', () => {
  const ids = new Set<string>();
  for (const cycleNum of cycleNumbers(7)) {
    for (const puzzleId of ['p1', 'p2', 'p3']) ids.add(attemptId('set', cycleNum, puzzleId));
  }
  assert.equal(ids.size, 21);
});

test('summarizes whole-programme progress', () => {
  const set = makeSet();
  const cycles = cycleNumbers(7).map((cycleNum) =>
    buildCycleProgress(
      set,
      cycleNum,
      cycleNum <= 2 ? [attempt(set.set_id, cycleNum, `p${cycleNum}`)] : [],
      cycleNum <= 2 ? { status: 'completed', completedAt: set.created_at + cycleNum * 1000 } : {},
    ),
  );
  const attempts = [attempt(set.set_id, 1, 'p1'), attempt(set.set_id, 2, 'p2')];

  const progress = summarizeSetProgress(set, cycles, attempts);
  assert.equal(progress.puzzle_count, 200);
  assert.equal(progress.cycle_target, 7);
  assert.equal(progress.cycles_completed, 2);
  assert.equal(progress.cycles_started, 2);
  assert.equal(progress.percent_complete, 29);
  assert.equal(progress.puzzles_solved_ever, 2);
  assert.equal(progress.first_attempt_accuracy, 100);
  assert.equal(progress.attempt_count, 2);
  assert.equal(progress.total_time_ms, 10_000);
  assert.equal(progress.cycles.length, 7);
  assert.deepEqual(
    progress.cycles.map((cycle) => cycle.status),
    ['completed', 'completed', 'pending', 'pending', 'pending', 'pending', 'pending'],
  );
});

test('nextCycleNumber points at the first unfinished cycle', () => {
  const set = makeSet();
  const cycles = cycleNumbers(7).map((cycleNum) =>
    buildCycleProgress(set, cycleNum, [], cycleNum <= 3 ? { status: 'completed', completedAt: 1 } : {}),
  );
  assert.equal(nextCycleNumber(set, cycles), 4);
  assert.equal(nextCycleNumber(set, []), 1);
});
