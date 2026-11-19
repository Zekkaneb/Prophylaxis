/**
 * End-to-end selection on the committed CSV fixture: parse → validate → tier
 * filter → freeze 200 Intermediate puzzles → seven cycles over that exact list.
 *
 * This is the pipeline the browser service runs, minus IndexedDB, so the
 * acceptance flow is covered by `node --test` as well as by the manual check.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseLichessCsv } from '../../src/puzzles/lichessCsv.ts';
import { toStoredPuzzle, validateLichessPuzzle } from '../../src/puzzles/puzzleValidation.ts';
import { DEFAULT_QUALITY_FILTERS } from '../../src/puzzles/types.ts';
import { classifyPuzzleRating } from '../../src/puzzles/tiers.ts';
import {
  eligiblePuzzles,
  hashSeed,
  mulberry32,
  selectBalancedPuzzles,
  selectRandomPuzzles,
} from '../../src/puzzles/selection.ts';
import { cycleMembership, cycleNumbers, membershipSignature } from '../../src/puzzles/trainingModel.ts';
import type { PuzzleTrainingSet } from '../../src/puzzles/types.ts';

const FIXTURE = new URL('../../scripts/fixtures/lichess-puzzles.sample.csv', import.meta.url);
const SEED = 424242;

async function library() {
  const text = await readFile(FIXTURE, 'utf8');
  const parsed = parseLichessCsv(text);
  assert.equal(parsed.rejected.length, 0);

  const valid = parsed.puzzles.filter((record) => validateLichessPuzzle(record).ok);
  assert.equal(valid.length, parsed.puzzles.length);
  return valid.map(toStoredPuzzle);
}

test('filters the fixture into the six tiers', async () => {
  const puzzles = await library();
  const counts: Record<string, number> = {};
  for (const puzzle of puzzles) {
    const slug = classifyPuzzleRating(puzzle.rating);
    assert.ok(slug, `unclassified rating ${puzzle.rating}`);
    counts[slug] = (counts[slug] ?? 0) + 1;
  }

  assert.deepEqual(counts, {
    'new-to-chess': 10,
    novice: 10,
    intermediate: 210,
    advanced: 10,
    expert: 10,
    master: 10,
  });
});

test('selects 200 Intermediate puzzles with a fixed, reproducible ordering', async () => {
  const puzzles = await library();
  const eligible = eligiblePuzzles(puzzles, 'intermediate', DEFAULT_QUALITY_FILTERS);
  assert.equal(eligible.length, 210);

  const first = selectRandomPuzzles(eligible, 200, mulberry32(SEED));
  const second = selectRandomPuzzles(eligible, 200, mulberry32(SEED));

  assert.equal(first.length, 200);
  assert.equal(new Set(first.map((puzzle) => puzzle.puzzle_id)).size, 200);
  for (const puzzle of first) {
    assert.equal(classifyPuzzleRating(puzzle.rating), 'intermediate');
  }
  assert.deepEqual(
    first.map((puzzle) => puzzle.puzzle_id),
    second.map((puzzle) => puzzle.puzzle_id),
  );
});

test('balanced selection of 200 Intermediate puzzles is still unique and in-tier', async () => {
  const puzzles = await library();
  const eligible = eligiblePuzzles(puzzles, 'intermediate', DEFAULT_QUALITY_FILTERS);
  const picked = selectBalancedPuzzles(eligible, 200, mulberry32(hashSeed('balanced-demo')));

  assert.equal(picked.length, 200);
  assert.equal(new Set(picked.map((puzzle) => puzzle.puzzle_id)).size, 200);
  for (const puzzle of picked) {
    assert.equal(classifyPuzzleRating(puzzle.rating), 'intermediate');
  }
});

test('a frozen set feeds all seven cycles identically', async () => {
  const puzzles = await library();
  const eligible = eligiblePuzzles(puzzles, 'intermediate', DEFAULT_QUALITY_FILTERS);
  const selected = selectRandomPuzzles(eligible, 200, mulberry32(SEED));

  const set: PuzzleTrainingSet = {
    set_id: 'set-fixture-intermediate',
    name: 'Intermediate · 200',
    tier_slug: 'intermediate',
    tier_name: 'Intermediate',
    selection_method: 'random',
    puzzle_count: selected.length,
    cycle_target: 7,
    quality_filters: DEFAULT_QUALITY_FILTERS,
    seed: SEED,
    puzzle_ids: selected.map((puzzle) => puzzle.puzzle_id),
    created_at: 1_700_000_000_000,
  };

  const signatures = cycleNumbers(7).map((cycleNum) =>
    membershipSignature(cycleMembership(set, cycleNum)),
  );

  assert.equal(signatures.length, 7);
  assert.equal(new Set(signatures).size, 1);
  assert.equal(signatures[0], membershipSignature(set.puzzle_ids));
});
