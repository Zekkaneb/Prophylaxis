/**
 * Shard loading + persistence against a real Dexie database
 * (`fake-indexeddb` provides IndexedDB in Node).
 *
 * Covers the behaviours the browser depends on: manifest-driven downloads,
 * shard bookkeeping in Dexie, idempotent/duplicate-safe writes, retries and
 * failed shards, manifest version changes, pruning safety around frozen sets
 * and cycle membership stability across all seven cycles.
 */

import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import type { PuzzleShardManifest } from '../../src/puzzles/shardPlan.ts';
import type { PuzzleTrainingSet, StoredPuzzle } from '../../src/puzzles/types.ts';

const { db } = await import('../../src/db.ts');
const { buildCycleProgress, cycleMembership } = await import('../../src/puzzles/trainingModel.ts');
const {
  listTierShardStates,
  loadTierManifest,
  pruneShardPuzzles,
  seedTierFromShards,
  shardStateId,
} = await import('../../src/puzzles/shardStore.ts');

const TIER = { slug: 'intermediate', minRating: 1501, maxRating: 1800 };

beforeEach(async () => {
  await db.delete();
  await db.open();
});

/* -------------------------------------------------------------------------- */
/*                                  Fixtures                                  */
/* -------------------------------------------------------------------------- */

function puzzles(prefix: string, count: number, start = 0): StoredPuzzle[] {
  return Array.from({ length: count }, (_, index) => ({
    puzzle_id: `${prefix}-${start + index}`,
    fen: '8/8/8/8/8/8/8/K6k w - - 0 1',
    moves: 'a1a2',
    rating: 1600 + ((start + index) % 100),
    themes: ['fork'],
  }));
}

function payload(version: number, shard: number, rows: StoredPuzzle[]) {
  return { tier: 'intermediate', version, shard, count: rows.length, puzzles: rows };
}

function manifestFor(version: number, counts: number[]): PuzzleShardManifest {
  return {
    tier: 'intermediate',
    name: 'Intermediate',
    min_rating: 1501,
    max_rating: 1800,
    version,
    generated_at: '2026-11-18T00:00:00.000Z',
    source: 'test',
    seed: 1,
    pool_size: counts.reduce((sum, count) => sum + count, 0),
    shard_size: Math.max(...counts),
    count: counts.reduce((sum, count) => sum + count, 0),
    shards: counts.map((count, index) => ({
      index: index + 1,
      file: `shard-${String(index + 1).padStart(4, '0')}.json`,
      count,
    })),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type FetcherEntry = unknown | (() => Response) | Response;

/**
 * Serves shard files by file name and records every request. A function entry
 * lets a test fail the first N attempts.
 */
function makeFetcher(files: Record<string, FetcherEntry>) {
  const calls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const file = url.split('/').pop() ?? '';
    const entry = files[file];

    if (entry === undefined) return new Response('not found', { status: 404 });
    if (entry instanceof Response) return entry.clone();
    if (typeof entry === 'function') return (entry as () => Response)();
    return jsonResponse(entry);
  }) as typeof fetch;

  return { fetcher, calls };
}

async function tierCount(): Promise<number> {
  return db.puzzles.where('rating').between(1501, 1800, true, true).count();
}

/* -------------------------------------------------------------------------- */
/*                              Downloading/state                             */
/* -------------------------------------------------------------------------- */

test('downloads only enough shards and records them in Dexie', async () => {
  const { fetcher, calls } = makeFetcher({
    'shard-0001.json': payload(1, 1, puzzles('a', 100)),
    'shard-0002.json': payload(1, 2, puzzles('b', 100)),
  });

  const result = await seedTierFromShards(TIER, {
    manifest: manifestFor(1, [100, 100]),
    targetCount: 100,
    fetcher,
    random: () => 0,
    retryDelayMs: 0,
  });

  assert.equal(result.source, 'shard');
  assert.deepEqual(result.downloaded, [1]);
  assert.deepEqual(result.failed, []);
  assert.equal(result.count, 100);
  assert.equal(calls.length, 1);

  const rows = await db.puzzles.where('rating').between(1501, 1800, true, true).toArray();
  assert.equal(rows.length, 100);
  assert.equal(rows[0].shard_id, shardStateId('intermediate', 1, 1));
  assert.equal(rows[0].source, 'lichess');
  assert.ok(rows[0].imported_at);

  const states = await listTierShardStates('intermediate');
  assert.equal(states.length, 1);
  assert.equal(states[0].status, 'downloaded');
  assert.equal(states[0].puzzle_count, 100);
  assert.equal(states[0].manifest_version, 1);
  assert.equal(states[0].attempts, 1);
});

test('a satisfied pool is served from cache without another request', async () => {
  const { fetcher, calls } = makeFetcher({
    'shard-0001.json': payload(1, 1, puzzles('a', 100)),
  });
  const manifest = manifestFor(1, [100]);

  await seedTierFromShards(TIER, { manifest, targetCount: 100, fetcher, retryDelayMs: 0 });
  const again = await seedTierFromShards(TIER, {
    manifest,
    targetCount: 50,
    fetcher,
    retryDelayMs: 0,
  });

  assert.equal(again.source, 'cache');
  assert.equal(again.count, 100);
  assert.equal(calls.length, 1);
});

test('placeholder mock rows are replaced by a published pool', async () => {
  /* The shape `buildFallbackPuzzles()` writes when a tier has no pool yet. */
  const mocks = Array.from({ length: 20 }, (_, index) => ({
    puzzle_id: `mock-intermediate-${String(index + 1).padStart(2, '0')}`,
    fen: '8/8/8/8/8/8/8/K6k w - - 0 1',
    moves: 'a1a2',
    rating: 1700,
    themes: ['mateIn1'],
  }));
  await db.puzzles.bulkPut(mocks);
  assert.equal(await tierCount(), 20);

  const { fetcher } = makeFetcher({ 'shard-0001.json': payload(1, 1, puzzles('a', 100)) });
  const result = await seedTierFromShards(TIER, {
    manifest: manifestFor(1, [100]),
    targetCount: 10,
    fetcher,
    retryDelayMs: 0,
  });

  /* 20 mock rows used to satisfy the target, so no shard was ever fetched. */
  assert.equal(result.source, 'shard');
  assert.equal(result.count, 100);
  assert.equal(await db.puzzles.where('puzzle_id').startsWith('mock-').count(), 0);
});

test('a placeholder frozen into a saved set survives the cleanup', async () => {
  await db.puzzles.put({
    puzzle_id: 'mock-intermediate-01',
    fen: '8/8/8/8/8/8/8/K6k w - - 0 1',
    moves: 'a1a2',
    rating: 1700,
    themes: [],
  });
  await db.woodpecker_sets.add({
    set_id: 'wp-mock',
    tier_name: 'Intermediate',
    puzzle_ids: ['mock-intermediate-01'],
    current_cycle: 1,
    history: [],
    created_at: 1,
  });

  const { fetcher } = makeFetcher({ 'shard-0001.json': payload(1, 1, puzzles('a', 5)) });
  await seedTierFromShards(TIER, {
    manifest: manifestFor(1, [5]),
    targetCount: 1,
    fetcher,
    retryDelayMs: 0,
  });

  assert.ok(await db.puzzles.get('mock-intermediate-01'), 'a saved set still resolves');
});

test('duplicate ids across shards collapse onto the primary key', async () => {
  const { fetcher } = makeFetcher({
    'shard-0001.json': payload(1, 1, puzzles('a', 100)),
    // 50 ids already delivered by shard 1, 50 new ones.
    'shard-0002.json': payload(1, 2, puzzles('a', 50, 50).concat(puzzles('b', 50))),
  });

  const result = await seedTierFromShards(TIER, {
    manifest: manifestFor(1, [100, 100]),
    targetCount: 200,
    fetcher,
    random: () => 0,
    retryDelayMs: 0,
  });

  assert.equal(result.downloaded.length, 2);
  assert.equal(await tierCount(), 150);
  assert.equal(await db.puzzles.count(), 150);
});

test('a failing shard is retried, marked failed and the next one is used', async () => {
  let failures = 0;
  const { fetcher, calls } = makeFetcher({
    'shard-0001.json': () => {
      failures += 1;
      return new Response('server error', { status: 500 });
    },
    'shard-0002.json': payload(1, 2, puzzles('b', 100)),
  });

  const result = await seedTierFromShards(TIER, {
    manifest: manifestFor(1, [100, 100]),
    targetCount: 100,
    fetcher,
    random: () => 0,
    retryDelayMs: 0,
  });

  assert.equal(failures, 2, 'shard 1 should be attempted twice');
  assert.deepEqual(result.downloaded, [2]);
  assert.deepEqual(result.failed, [1]);
  assert.match(result.error ?? '', /HTTP 500/);
  assert.equal(result.count, 100);
  assert.ok(calls.length >= 3);

  const [failed] = (await listTierShardStates('intermediate')).filter(
    (state) => state.status === 'failed',
  );
  assert.equal(failed.shard_index, 1);
  assert.equal(failed.attempts, 2);
  assert.match(failed.last_error ?? '', /HTTP 500/);
});

test('a stale shard payload is rejected instead of mixed into the pool', async () => {
  const { fetcher } = makeFetcher({
    'shard-0001.json': payload(99, 1, puzzles('stale', 100)),
  });

  const result = await seedTierFromShards(TIER, {
    manifest: manifestFor(1, [100]),
    targetCount: 100,
    fetcher,
    retryDelayMs: 0,
  });

  assert.equal(result.count, 0);
  assert.deepEqual(result.failed, [1]);
  assert.match(result.error ?? '', /version 99/);
  assert.equal(await db.puzzles.count(), 0);
});

test('a new manifest version adds shards without deleting old rows', async () => {
  const v1 = manifestFor(1, [100]);
  const v2 = manifestFor(2, [100]);

  const first = makeFetcher({ 'shard-0001.json': payload(1, 1, puzzles('v1', 100)) });
  await seedTierFromShards(TIER, {
    manifest: v1,
    targetCount: 100,
    fetcher: first.fetcher,
    random: () => 0,
    retryDelayMs: 0,
  });

  const second = makeFetcher({ 'shard-0001.json': payload(2, 1, puzzles('v2', 100)) });
  const result = await seedTierFromShards(TIER, {
    manifest: v2,
    targetCount: 200,
    fetcher: second.fetcher,
    random: () => 0,
    retryDelayMs: 0,
  });

  assert.equal(result.source, 'shard');
  assert.equal(await tierCount(), 200);
  assert.ok(await db.puzzles.get('v1-0'), 'old version rows must survive');
  assert.ok(await db.puzzles.get('v2-0'));

  const states = await listTierShardStates('intermediate');
  assert.deepEqual(
    states.map((state) => state.manifest_version).sort(),
    [1, 2],
  );
});

test('an exhausted pool stops cleanly instead of looping', async () => {
  const manifest = manifestFor(1, [50, 50]);
  const { fetcher, calls } = makeFetcher({
    'shard-0001.json': payload(1, 1, puzzles('a', 50)),
    'shard-0002.json': payload(1, 2, puzzles('b', 50)),
  });

  await seedTierFromShards(TIER, {
    manifest,
    targetCount: 500,
    fetcher,
    random: () => 0,
    retryDelayMs: 0,
  });
  assert.equal(calls.length, 2);
  assert.equal(await tierCount(), 100);

  const again = await seedTierFromShards(TIER, {
    manifest,
    targetCount: 500,
    fetcher,
    random: () => 0,
    retryDelayMs: 0,
  });
  assert.equal(again.source, 'cache');
  assert.equal(again.count, 100);
  assert.deepEqual(again.downloaded, []);
  assert.equal(calls.length, 2);
});

/* -------------------------------------------------------------------------- */
/*                              Manifest loading                              */
/* -------------------------------------------------------------------------- */

test('a missing, malformed or mismatched manifest returns null (legacy path)', async () => {
  assert.equal(await loadTierManifest(TIER, { fetcher: makeFetcher({}).fetcher }), null);

  const malformed = makeFetcher({ 'manifest.json': { tier: 'intermediate' } });
  assert.equal(await loadTierManifest(TIER, { fetcher: malformed.fetcher }), null);

  const otherTier = makeFetcher({ 'manifest.json': manifestFor(1, [10]) });
  const foreign = { ...manifestFor(1, [10]), tier: 'novice' };
  const wrong = makeFetcher({ 'manifest.json': foreign });
  assert.equal(await loadTierManifest(TIER, { fetcher: wrong.fetcher }), null);
  assert.ok(otherTier.fetcher);
});

/* -------------------------------------------------------------------------- */
/*                                  Pruning                                   */
/* -------------------------------------------------------------------------- */

test('pruning never removes a shard referenced by a saved training set', async () => {
  const { fetcher } = makeFetcher({
    'shard-0001.json': payload(1, 1, puzzles('a', 100)),
    'shard-0002.json': payload(1, 2, puzzles('b', 100)),
  });
  await seedTierFromShards(TIER, {
    manifest: manifestFor(1, [100, 100]),
    targetCount: 200,
    fetcher,
    random: () => 0,
    retryDelayMs: 0,
  });

  const now = Date.now();
  await db.puzzle_sets.put({
    set_id: 'set-protected',
    name: 'Protected',
    tier_slug: 'intermediate',
    tier_name: 'Intermediate',
    selection_method: 'random',
    puzzle_count: 2,
    cycle_target: 7,
    quality_filters: {},
    seed: 1,
    puzzle_ids: ['a-7', 'b-7'],
    created_at: now,
  });
  await db.woodpecker_sets.put({
    set_id: 'wp-protected',
    tier_name: 'Intermediate',
    puzzle_ids: ['a-9'],
    current_cycle: 1,
    history: [],
    created_at: now,
  });
  // A review puzzle that never came from a shard.
  await db.puzzles.put({
    puzzle_id: 'user-review',
    fen: '8/8/8/8/8/8/8/K6k w - - 0 1',
    moves: 'a1a2',
    rating: 1650,
    themes: [],
    source: 'review',
  });

  const kept = await pruneShardPuzzles();
  assert.equal(kept.removedShards, 0);
  assert.equal(kept.keptShards, 2);
  // 200 shard rows + the review row, which lives in the same rating band.
  assert.equal(await tierCount(), 201);
  assert.ok(await db.puzzles.get('a-7'));
  assert.ok(await db.puzzles.get('b-7'));

  await db.puzzle_sets.clear();
  await db.woodpecker_sets.clear();

  const removed = await pruneShardPuzzles();
  assert.equal(removed.removedShards, 2);
  assert.equal(removed.removedPuzzles, 200);
  // Only the non-shard review row (same rating band) is left.
  assert.equal(await tierCount(), 1);
  assert.equal(await db.puzzles.filter((puzzle) => Boolean(puzzle.shard_id)).count(), 0);
  assert.equal(await db.puzzle_shards.count(), 0);
  assert.ok(await db.puzzles.get('user-review'), 'non-shard rows are never pruned');
});

/* -------------------------------------------------------------------------- */
/*                     Frozen membership across seven cycles                  */
/* -------------------------------------------------------------------------- */

test('seven cycles keep exactly the shard-loaded membership', async () => {
  const { fetcher } = makeFetcher({
    'shard-0001.json': payload(1, 1, puzzles('a', 100)),
    'shard-0002.json': payload(1, 2, puzzles('b', 100)),
  });
  await seedTierFromShards(TIER, {
    manifest: manifestFor(1, [100, 100]),
    targetCount: 200,
    fetcher,
    random: () => 0,
    retryDelayMs: 0,
  });

  const ids = (await db.puzzles.where('rating').between(1501, 1800, true, true).toArray())
    .map((puzzle) => puzzle.puzzle_id)
    .sort();

  const set: PuzzleTrainingSet = {
    set_id: 'set-seven',
    name: 'Seven',
    tier_slug: 'intermediate',
    tier_name: 'Intermediate',
    selection_method: 'random',
    puzzle_count: ids.length,
    cycle_target: 7,
    quality_filters: {},
    seed: 7,
    puzzle_ids: ids,
    created_at: Date.now(),
  };

  await db.puzzle_sets.put(set);
  await db.puzzle_cycles.bulkPut(
    Array.from({ length: 7 }, (_, index) => buildCycleProgress(set, index + 1, [])),
  );

  for (let cycle = 1; cycle <= 7; cycle += 1) {
    assert.deepEqual(cycleMembership(set, cycle), ids, `cycle ${cycle} membership drifted`);
  }

  // Pruning must keep every shard the set references.
  const pruned = await pruneShardPuzzles();
  assert.equal(pruned.removedShards, 0);
  assert.equal(pruned.keptShards, 2);

  const rows = await db.puzzles.bulkGet(ids);
  assert.equal(rows.filter(Boolean).length, ids.length);
  assert.equal((await db.puzzle_cycles.toArray()).length, 7);
});
