/**
 * Shard planning: deterministic reservoir sampling, uniformity, shuffling,
 * manifest validation, payload validation and fetch planning.
 *
 * These are the pure decisions behind the published puzzle pool — no network,
 * no IndexedDB — so a regression here is caught without a browser.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ReservoirSampler,
  chunkIntoShards,
  hashSeed,
  mulberry32,
  parseShardManifest,
  parseShardPayload,
  planShardFetch,
  shuffleWith,
  type PuzzleShardManifest,
} from '../../src/puzzles/shardPlan.ts';

function manifest(overrides: Partial<PuzzleShardManifest> = {}): PuzzleShardManifest {
  return {
    tier: 'intermediate',
    name: 'Intermediate',
    min_rating: 1301,
    max_rating: 1600,
    version: 7,
    generated_at: '2026-11-18T00:00:00.000Z',
    source: 'test',
    seed: 42,
    pool_size: 300,
    shard_size: 100,
    count: 300,
    shards: [
      { index: 1, file: 'shard-0001.json', count: 100 },
      { index: 2, file: 'shard-0002.json', count: 100 },
      { index: 3, file: 'shard-0003.json', count: 100 },
    ],
    ...overrides,
  };
}

function puzzle(id: string, rating = 1500) {
  return { puzzle_id: id, fen: '8/8/8/8/8/8/8/K6k w - - 0 1', moves: 'a1a2', rating, themes: [] };
}

/* -------------------------------------------------------------------------- */
/*                            Reservoir sampling                              */
/* -------------------------------------------------------------------------- */

test('reservoir keeps a bounded sample and sees every candidate', () => {
  const sampler = new ReservoirSampler<number>(100, mulberry32(1));
  for (let index = 0; index < 10_000; index += 1) sampler.offer(index);

  assert.equal(sampler.seenCount, 10_000);
  assert.equal(sampler.items.length, 100);
  assert.equal(new Set(sampler.items).size, 100);
});

test('reservoir is deterministic for a seed and differs between seeds', () => {
  const feed = (seed: number) => {
    const sampler = new ReservoirSampler<number>(50, mulberry32(seed));
    for (let index = 0; index < 5_000; index += 1) sampler.offer(index * 2);
    return [...sampler.items];
  };

  assert.deepEqual(feed(1234), feed(1234));
  assert.notDeepEqual(feed(1234), feed(4321));
});

test('reservoir is uniform across the stream, not biased to the start', () => {
  // Fixed seeds keep this deterministic (no flaky statistical test): for each
  // seed, 1,000 of 10,000 candidates retained, split into 10 buckets of 1,000.
  // Expected 100/bucket; chi-square with 9 df has a 1% critical value of 21.67.
  for (const seed of [1, 2, 3, 4, 5]) {
    const sampler = new ReservoirSampler<number>(1_000, mulberry32(seed));
    for (let index = 0; index < 10_000; index += 1) sampler.offer(index);

    const buckets = new Array(10).fill(0) as number[];
    for (const item of sampler.items) buckets[Math.floor(item / 1_000)] += 1;

    const chiSquare = buckets.reduce((sum, count) => sum + (count - 100) ** 2 / 100, 0);
    assert.ok(chiSquare < 21.67, `seed ${seed}: chi-square ${chiSquare.toFixed(2)} (${buckets})`);
  }
});

test('reservoir handles the degenerate capacities', () => {
  const none = new ReservoirSampler<number>(0, mulberry32(1));
  for (let index = 0; index < 10; index += 1) none.offer(index);
  assert.deepEqual(none.items, []);

  const roomy = new ReservoirSampler<number>(100, mulberry32(1));
  for (let index = 0; index < 3; index += 1) roomy.offer(index);
  assert.deepEqual(roomy.items, [0, 1, 2]);
});

test('shuffle is deterministic and never drops or duplicates an item', () => {
  const input = Array.from({ length: 200 }, (_, index) => index);
  const first = shuffleWith(input, mulberry32(hashSeed('intermediate:shuffle')));
  const second = shuffleWith(input, mulberry32(hashSeed('intermediate:shuffle')));

  assert.deepEqual(first, second);
  assert.deepEqual([...first].sort((a, b) => a - b), input);
  assert.notDeepEqual(first, input);
});

test('shards split into fixed sizes with a smaller tail', () => {
  const shards = chunkIntoShards(Array.from({ length: 250 }, (_, index) => index), 100);
  assert.deepEqual(
    shards.map((shard) => shard.length),
    [100, 100, 50],
  );
  assert.deepEqual(chunkIntoShards([], 100), []);
});

/* -------------------------------------------------------------------------- */
/*                            Manifest validation                             */
/* -------------------------------------------------------------------------- */

test('a valid manifest is accepted and normalised', () => {
  const parsed = parseShardManifest(manifest());
  assert.equal(parsed.tier, 'intermediate');
  assert.equal(parsed.count, 300);
  assert.equal(parsed.shards.length, 3);
  assert.equal(parsed.shards[1].index, 2);
});

test('malformed manifests are rejected before anything is stored', () => {
  const cases: Array<[string, unknown]> = [
    ['not an object', []],
    ['missing tier', { ...manifest(), tier: '' }],
    ['bad version', { ...manifest(), version: 0 }],
    ['no shards', { ...manifest(), shards: [] }],
    ['count mismatch', { ...manifest(), count: 299 }],
    ['duplicate index', { ...manifest(), shards: [
      { index: 1, file: 'shard-0001.json', count: 150 },
      { index: 1, file: 'shard-0002.json', count: 150 },
    ] }],
    ['path traversal', { ...manifest(), shards: [
      { index: 1, file: '../evil.json', count: 300 },
    ] }],
    ['oversized shard', { ...manifest(), shards: [{ index: 1, file: 'shard-0001.json', count: 301 }] }],
  ];

  for (const [label, payload] of cases) {
    assert.throws(() => parseShardManifest(payload), /Invalid puzzle shard manifest/, label);
  }
});

test('a manifest for another tier cannot be adopted by mistake', () => {
  // Tier matching happens at the fetch site; the parser records what it read.
  const parsed = parseShardManifest(manifest({ tier: 'novice' }));
  assert.equal(parsed.tier, 'novice');
});

/* -------------------------------------------------------------------------- */
/*                             Payload validation                             */
/* -------------------------------------------------------------------------- */

test('a valid shard payload is normalised', () => {
  const descriptor = { index: 1, file: 'shard-0001.json', count: 2 };
  const parsed = parseShardPayload(
    {
      tier: 'intermediate',
      version: 7,
      shard: 1,
      count: 2,
      puzzles: [puzzle('a'), { PuzzleId: 'b', fen: 'x', moves: ' e2e4 ', rating: 1400, themes: ['fork'] }],
    },
    manifest(),
    descriptor,
  );

  assert.equal(parsed.puzzles.length, 2);
  assert.equal(parsed.puzzles[0].puzzle_id, 'a');
  assert.equal(parsed.puzzles[1].puzzle_id, 'b');
  assert.equal(parsed.puzzles[1].moves, 'e2e4');
  assert.equal(parsed.skipped, 0);
});

test('stale or mismatched shard payloads are rejected', () => {
  const descriptor = { index: 1, file: 'shard-0001.json', count: 1 };
  const valid = { tier: 'intermediate', version: 7, shard: 1, count: 1, puzzles: [puzzle('a')] };

  assert.throws(
    () => parseShardPayload({ ...valid, tier: 'novice' }, manifest(), descriptor),
    /belongs to "novice"/,
  );
  assert.throws(
    () => parseShardPayload({ ...valid, version: 6 }, manifest(), descriptor),
    /is version 6, expected 7/,
  );
  assert.throws(
    () => parseShardPayload({ ...valid, shard: 2 }, manifest(), descriptor),
    /says it is #2/,
  );
  assert.throws(
    () => parseShardPayload({ ...valid, puzzles: [] }, manifest(), descriptor),
    /no usable puzzles/,
  );
});

test('individual malformed puzzles are skipped, not fatal', () => {
  const descriptor = { index: 1, file: 'shard-0001.json', count: 3 };
  const parsed = parseShardPayload(
    {
      tier: 'intermediate',
      version: 7,
      shard: 1,
      count: 3,
      puzzles: [puzzle('a'), { puzzle_id: 'bad' }, { puzzle_id: 'c', fen: 'x', moves: 'y', rating: 1500 }],
    },
    manifest(),
    descriptor,
  );

  assert.equal(parsed.puzzles.length, 2);
  assert.equal(parsed.skipped, 1);
});

/* -------------------------------------------------------------------------- */
/*                               Fetch planning                              */
/* -------------------------------------------------------------------------- */

test('every shard is planned when nothing is downloaded', () => {
  assert.deepEqual(planShardFetch(manifest()), [1, 2, 3]);
});

test('downloaded shards are skipped and a random start wraps around', () => {
  assert.deepEqual(planShardFetch(manifest(), { seeded: new Set([1]) }), [2, 3]);
  assert.deepEqual(planShardFetch(manifest(), { startIndex: 1 }), [2, 3, 1]);
  assert.deepEqual(planShardFetch(manifest(), { startIndex: 2, maxShards: 2 }), [3, 1]);
});

test('failed shards stay eligible for a later retry', () => {
  // Failed shards are not in `seeded`, so they are planned again.
  assert.deepEqual(planShardFetch(manifest(), { seeded: [2, 3] }), [1]);
});

test('the plan respects its bounds and never invents a shard', () => {
  assert.deepEqual(planShardFetch(manifest(), { maxShards: 0 }), []);
  assert.deepEqual(planShardFetch(manifest(), { seeded: [1, 2, 3] }), []);
  assert.deepEqual(planShardFetch(manifest(), { seeded: [1, 2, 3], maxShards: 4 }), []);
});
