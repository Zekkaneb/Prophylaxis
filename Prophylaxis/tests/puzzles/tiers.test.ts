/**
 * Difficulty tiers: the six authoritative bands, boundaries and classification.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTHORITATIVE_PUZZLE_TIERS,
  AUTHORITATIVE_TIER_SLUGS,
  DEFAULT_POOL_FLOOR_PERCENTILE,
  PUZZLE_TIER_BANDS,
  RATING_CEILING,
  RATING_FLOOR,
  LICHESS_TO_CHESSCOM_SHIFT,
  bandRatingFloor,
  TARGET_LIBRARY_SIZE,
  TARGET_PUZZLES_PER_TIER,
  classifyPuzzleRating,
  getTierBand,
  isAuthoritativeRating,
  isAuthoritativeTier,
  tierFile,
  toChessComRating,
  toLichessRating,
} from '../../src/puzzles/tiers.ts';

test('defines exactly the six authoritative tiers with the documented bounds', () => {
  assert.deepEqual(
    AUTHORITATIVE_PUZZLE_TIERS.map((tier) => [tier.name, tier.minRating, tier.maxRating]),
    [
      ['New to Chess', 800, 1200],
      ['Novice', 1201, 1500],
      ['Intermediate', 1501, 1800],
      ['Advanced', 1801, 2100],
      ['Expert', 2101, 2400],
      ['Master', 2401, 2700],
    ],
  );
  assert.equal(AUTHORITATIVE_PUZZLE_TIERS.length, 6);
  assert.equal(AUTHORITATIVE_TIER_SLUGS.length, 6);
  assert.equal(RATING_FLOOR, 800);
  assert.equal(RATING_CEILING, 2700);
  assert.equal(TARGET_PUZZLES_PER_TIER, 1000);
  assert.equal(TARGET_LIBRARY_SIZE, 6000);
});

test('bands ascend without gaps between them', () => {
  const bands = PUZZLE_TIER_BANDS;
  for (let index = 1; index < bands.length; index += 1) {
    assert.equal(bands[index].minRating, bands[index - 1].maxRating + 1);
    assert.ok(bands[index].minRating > bands[index - 1].minRating);
  }
});

test('classifies every boundary in the right tier', () => {
  const expected: Array<[number, string]> = [
    [800, 'new-to-chess'],
    [1200, 'new-to-chess'],
    [1201, 'novice'],
    [1500, 'novice'],
    [1501, 'intermediate'],
    [1800, 'intermediate'],
    [1801, 'advanced'],
    [2100, 'advanced'],
    [2101, 'expert'],
    [2400, 'expert'],
    [2401, 'master'],
    [2700, 'master'],
    [2701, 'elite'],
    [3700, 'elite'],
  ];

  for (const [rating, slug] of expected) {
    assert.equal(classifyPuzzleRating(rating), slug, `rating ${rating}`);
  }
});

test('leaves unrated or sub-800 puzzles unclassified', () => {
  assert.equal(classifyPuzzleRating(799), null);
  assert.equal(classifyPuzzleRating(0), null);
  assert.equal(classifyPuzzleRating(Number.NaN), null);
  assert.equal(classifyPuzzleRating(Number.POSITIVE_INFINITY), null);
});

test('treats only the six as authoritative', () => {
  assert.equal(isAuthoritativeTier('intermediate'), true);
  assert.equal(isAuthoritativeTier('elite'), false);
  assert.equal(isAuthoritativeTier('nonsense'), false);
  assert.equal(isAuthoritativeRating(1500), true);
  assert.equal(isAuthoritativeRating(2800), false);
  assert.equal(isAuthoritativeRating(400), false);
});

test('each pool is built from the harder slice of its band', () => {
  assert.equal(DEFAULT_POOL_FLOOR_PERCENTILE, 0.5);
  const floors = Object.fromEntries(
    PUZZLE_TIER_BANDS.map((band) => [band.slug, bandRatingFloor(band)]),
  );

  assert.deepEqual(floors, {
    'new-to-chess': 1000,
    novice: 1351,
    intermediate: 1651,
    advanced: 1951,
    expert: 2251,
    master: 2551,
    /* Elite keeps its whole band: almost no quality puzzles exist above 3200. */
    elite: 2701,
  });

  for (const band of PUZZLE_TIER_BANDS) {
    const floor = bandRatingFloor(band);
    assert.ok(floor >= band.minRating, `${band.slug} floor below the band`);
    assert.ok(floor <= band.maxRating, `${band.slug} floor above the band`);
  }
});

test('converts Lichess ratings to the chess.com scale by 200 points', () => {
  assert.equal(LICHESS_TO_CHESSCOM_SHIFT, 200);
  assert.equal(toChessComRating(1400), 1600);
  assert.equal(toChessComRating(319), 519);
  assert.equal(toLichessRating(1600), 1400);
  /* Every band is the Lichess band shifted by the same offset. */
  assert.equal(AUTHORITATIVE_PUZZLE_TIERS[0].minRating, toChessComRating(600));
  assert.equal(AUTHORITATIVE_PUZZLE_TIERS.at(-1)?.maxRating, toChessComRating(2500));
});

test('looks up bands and tier files', () => {
  assert.equal(getTierBand('intermediate')?.minRating, 1501);
  assert.equal(getTierBand('nope'), undefined);
  assert.equal(tierFile('intermediate'), '/puzzles/intermediate.json');
});
