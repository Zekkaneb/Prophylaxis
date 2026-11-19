/**
 * Selection: deterministic randomness, uniqueness, quality filters and the
 * theme-balanced method.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { StoredPuzzle } from '../../src/puzzles/types.ts';
import {
  applyQualityFilters,
  balanceThemeOf,
  dedupePuzzles,
  eligiblePuzzles,
  hashSeed,
  matchesQualityFilters,
  mulberry32,
  selectBalancedPuzzles,
  selectPuzzles,
  selectRandomPuzzles,
} from '../../src/puzzles/selection.ts';

const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function puzzle(
  id: string,
  rating: number,
  themes: string[],
  overrides: Partial<StoredPuzzle> = {},
): StoredPuzzle {
  return {
    puzzle_id: id,
    fen: FEN,
    moves: 'e2e4 e7e5',
    rating,
    themes,
    popularity: 90,
    rating_deviation: 70,
    plays: 5000,
    ...overrides,
  };
}

function pool(count: number, rating = 1500): StoredPuzzle[] {
  return Array.from({ length: count }, (_, index) =>
    puzzle(`p${String(index + 1).padStart(3, '0')}`, rating, ['fork', 'middlegame']),
  );
}

test('the same seed always selects the same puzzles in the same order', () => {
  const candidates = pool(50);
  const first = selectRandomPuzzles(candidates, 20, mulberry32(hashSeed('intermediate-200')));
  const second = selectRandomPuzzles(candidates, 20, mulberry32(hashSeed('intermediate-200')));

  assert.deepEqual(
    first.map((entry) => entry.puzzle_id),
    second.map((entry) => entry.puzzle_id),
  );
});

test('different seeds pick different orders', () => {
  const candidates = pool(50);
  const a = selectRandomPuzzles(candidates, 20, mulberry32(1));
  const b = selectRandomPuzzles(candidates, 20, mulberry32(2));

  assert.notDeepEqual(
    a.map((entry) => entry.puzzle_id),
    b.map((entry) => entry.puzzle_id),
  );
});

test('never returns a puzzle twice', () => {
  const candidates = [...pool(10), ...pool(10)]; // duplicated ids on purpose
  const picked = selectRandomPuzzles(candidates, 25, mulberry32(7));

  const ids = picked.map((entry) => entry.puzzle_id);
  assert.equal(ids.length, 10);
  assert.equal(new Set(ids).size, ids.length);
});

test('never asks for more puzzles than the pool holds', () => {
  assert.equal(selectRandomPuzzles(pool(5), 200, mulberry32(3)).length, 5);
  assert.deepEqual(selectRandomPuzzles(pool(5), 0, mulberry32(3)), []);
});

test('dedupe keeps the first occurrence and the original order', () => {
  const rows = [puzzle('a', 1400, ['fork']), puzzle('b', 1500, ['pin']), puzzle('a', 1600, ['skewer'])];
  assert.deepEqual(
    dedupePuzzles(rows).map((entry) => entry.puzzle_id),
    ['a', 'b'],
  );
});

test('quality filters gate popularity, deviation, plays and themes', () => {
  const lowPopularity = puzzle('low-pop', 1500, ['fork'], { popularity: 10 });
  const highDeviation = puzzle('high-rd', 1500, ['fork'], { rating_deviation: 350 });
  const rare = puzzle('rare', 1500, ['fork'], { plays: 5 });
  const noTheme = puzzle('no-theme', 1500, ['endgame']);
  const keeper = puzzle('keeper', 1500, ['fork']);

  const filters = {
    minPopularity: 80,
    maxRatingDeviation: 100,
    minPlays: 50,
    requiredThemes: ['fork'],
  };

  assert.equal(matchesQualityFilters(keeper, filters), true);
  assert.equal(matchesQualityFilters(lowPopularity, filters), false);
  assert.equal(matchesQualityFilters(highDeviation, filters), false);
  assert.equal(matchesQualityFilters(rare, filters), false);
  assert.equal(matchesQualityFilters(noTheme, filters), false);
  assert.deepEqual(
    applyQualityFilters([lowPopularity, highDeviation, rare, noTheme, keeper], filters).map(
      (entry) => entry.puzzle_id,
    ),
    ['keeper'],
  );
});

test('excluded themes remove puzzles carrying them', () => {
  const candidates = [puzzle('a', 1500, ['fork', 'mateIn1']), puzzle('b', 1500, ['fork'])];
  assert.deepEqual(
    applyQualityFilters(candidates, { excludedThemes: ['mateIn1'] }).map((entry) => entry.puzzle_id),
    ['b'],
  );
});

test('missing metadata does not fail a quality gate', () => {
  const bare: StoredPuzzle = { puzzle_id: 'bare', fen: FEN, moves: 'e2e4 e7e5', rating: 1500, themes: ['fork'] };
  assert.equal(matchesQualityFilters(bare, { minPopularity: 80, maxRatingDeviation: 40, minPlays: 100 }), true);
});

test('eligiblePuzzles combines tier bounds, filters and dedupe', () => {
  const candidates = [
    puzzle('n1', 1500, ['fork']),
    puzzle('i1', 1501, ['fork']),
    puzzle('i2', 1800, ['fork']),
    puzzle('i2', 1800, ['fork']),
    puzzle('i3', 1800, ['endgame']),
    puzzle('a1', 1801, ['fork']),
    puzzle('i4', 1700, ['fork'], { popularity: 5 }),
  ];

  assert.deepEqual(
    eligiblePuzzles(candidates, 'intermediate', { minPopularity: 80 }).map((entry) => entry.puzzle_id),
    ['i1', 'i2', 'i3'],
  );
});

test('balanced selection spreads picks evenly across themes', () => {
  const themes = ['fork', 'pin', 'skewer', 'mateIn2', 'endgame', 'hangingPiece'];
  const candidates = themes.flatMap((theme) =>
    Array.from({ length: 10 }, (_, index) => puzzle(`${theme}-${index}`, 1500, [theme])),
  );

  const picked = selectBalancedPuzzles(candidates, 30, mulberry32(11));
  assert.equal(picked.length, 30);
  assert.equal(new Set(picked.map((entry) => entry.puzzle_id)).size, 30);

  const perTheme = new Map<string, number>();
  for (const entry of picked) perTheme.set(entry.themes[0], (perTheme.get(entry.themes[0]) ?? 0) + 1);
  assert.equal(perTheme.size, 6);
  for (const theme of themes) assert.equal(perTheme.get(theme), 5, theme);
});

test('balanced selection still prefers the priority theme on multi-theme puzzles', () => {
  const candidates = Array.from({ length: 12 }, (_, index) =>
    puzzle(`m${index}`, 1500, index % 2 === 0 ? ['mateIn1', 'fork'] : ['fork', 'pin']),
  );
  const picked = selectBalancedPuzzles(candidates, 12, mulberry32(5));
  assert.equal(picked.length, 12);
  assert.equal(new Set(picked.map((entry) => entry.puzzle_id)).size, 12);
});

test('real Lichess theme lists bucket by motif, not by phase or quality tags', () => {
  /* The real Themes column starts with tags like these. */
  assert.equal(balanceThemeOf(puzzle('a', 1500, ['crushing', 'endgame', 'kingsideAttack', 'short'])), 'kingsideAttack');
  assert.equal(balanceThemeOf(puzzle('b', 1500, ['advantage', 'middlegame', 'fork', 'long'])), 'fork');
  assert.equal(balanceThemeOf(puzzle('c', 1500, ['mate', 'mateIn2', 'middlegame'])), 'mateIn2');
  assert.equal(balanceThemeOf(puzzle('d', 1500, ['crushing', 'short'])), 'crushing');

  const pool = [
    puzzle('r1', 1500, ['crushing', 'endgame', 'fork']),
    puzzle('r2', 1500, ['advantage', 'middlegame', 'pin']),
    puzzle('r3', 1500, ['mate', 'mateIn2', 'short']),
    puzzle('r4', 1500, ['crushing', 'skewer', 'long']),
  ];
  const picked = selectBalancedPuzzles(pool, 4, mulberry32(9));
  assert.equal(picked.length, 4);
  assert.deepEqual(
    picked.map((entry) => balanceThemeOf(entry)).sort(),
    ['fork', 'mateIn2', 'pin', 'skewer'],
  );
});

test('selectPuzzles dispatches on the requested method', () => {
  const candidates = pool(20);
  const balanced = selectPuzzles(candidates, { count: 10, method: 'balanced', random: mulberry32(4) });
  const random = selectPuzzles(candidates, { count: 10, method: 'random', random: mulberry32(4) });

  assert.equal(balanced.length, 10);
  assert.equal(random.length, 10);
  assert.equal(new Set(balanced.map((entry) => entry.puzzle_id)).size, 10);
});
