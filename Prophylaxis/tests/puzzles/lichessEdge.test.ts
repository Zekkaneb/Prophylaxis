/**
 * Real-shaped edge cases: ratings outside the six bands, duplicates, empty
 * themes, unreadable positions and impossible moves — all values the audit of
 * the real `lichess_db_puzzle.csv` found at the edges of the database.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseLichessCsv } from '../../src/puzzles/lichessCsv.ts';
import { validateLichessPuzzle } from '../../src/puzzles/puzzleValidation.ts';
import { classifyPuzzleRating, toChessComRating } from '../../src/puzzles/tiers.ts';
import { DEFAULT_QUALITY_FILTERS } from '../../src/puzzles/types.ts';
import { matchesQualityFilters } from '../../src/puzzles/selection.ts';

const EDGE = new URL('../../scripts/fixtures/lichess-puzzles.edge.csv', import.meta.url);

async function parseEdge() {
  const text = await readFile(EDGE, 'utf8');
  return parseLichessCsv(text);
}

test('classifies ratings at the edges of the real database', async () => {
  const result = await parseEdge();
  assert.equal(result.rejected.length, 0);

  const belowFloor = result.puzzles.find((puzzle) => puzzle.rating === 399);
  const aboveMaster = result.puzzles.find((puzzle) => puzzle.rating === 3128);
  assert.ok(belowFloor, '399-rated puzzle missing');
  assert.ok(aboveMaster, '3128-rated puzzle missing');

  /* The bands are chess.com-scaled, so classify the shifted figure. */
  assert.equal(classifyPuzzleRating(toChessComRating(399)), null);
  assert.equal(classifyPuzzleRating(toChessComRating(3128)), 'elite');
});

test('collapses duplicate ids from the file', async () => {
  const result = await parseEdge();
  /* Seven rows, one of which repeats the first id. */
  assert.equal(result.duplicates, 1);
  assert.equal(result.puzzles.length, 6);
});

test('rejects empty themes, unreadable FENs and illegal moves', async () => {
  const result = await parseEdge();

  const failures = result.puzzles
    .map((puzzle) => ({ id: puzzle.puzzle_id, validation: validateLichessPuzzle(puzzle) }))
    .filter((entry) => !entry.validation.ok);

  assert.equal(failures.length, 3);
  const reasons = failures.map((entry) => entry.validation.reason ?? '');
  assert.ok(reasons.some((reason) => /themes/.test(reason)), reasons.join(' | '));
  assert.ok(reasons.some((reason) => /illegal FEN/.test(reason)), reasons.join(' | '));
  assert.ok(reasons.some((reason) => /illegal in this position/.test(reason)), reasons.join(' | '));
});

test('quality filters see the real metadata extremes', async () => {
  const result = await parseEdge();
  const belowFloor = result.puzzles.find((puzzle) => puzzle.rating === 399);
  assert.ok(belowFloor);

  /* popularity 0, RD 500, plays 0 — everything the defaults gate. */
  assert.equal(belowFloor.popularity, 0);
  assert.equal(belowFloor.rating_deviation, 500);
  assert.equal(belowFloor.plays, 0);
  assert.equal(belowFloor.game_url, '');
  assert.equal(matchesQualityFilters(belowFloor, DEFAULT_QUALITY_FILTERS), false);

  const aboveMaster = result.puzzles.find((puzzle) => puzzle.rating === 3128);
  assert.ok(aboveMaster);
  assert.deepEqual(aboveMaster.opening_tags, ['Sicilian_Defense', 'Najdorf_Variation']);
  assert.equal(matchesQualityFilters(aboveMaster, DEFAULT_QUALITY_FILTERS), true);
});
