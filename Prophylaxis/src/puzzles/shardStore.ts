import { db } from '../db.ts';
import type { PuzzleShardState, StoredPuzzle } from './types.ts';
import {
  parseShardManifest,
  parseShardPayload,
  planShardFetch,
  tierManifestFile,
  tierShardFile,
  type PuzzleShardManifest,
} from './shardPlan.ts';

/**
 * Runtime access to the published puzzle pools (manifests + shards).
 *
 * The trainer's contract is unchanged: it asks for a tier, gets puzzles in
 * IndexedDB, then samples. What changed underneath is *where* those rows come
 * from — instead of one 1,000-row tier file, each manifest describes several
 * 1,000-row shards drawn uniformly from the full Lichess database. This module
 * fetches one shard at a time, records what it has in Dexie, and never deletes
 * rows that a saved training set references.
 *
 * Design constraints (deliberate):
 * - One puzzle table, one database. Shard state is a new table beside it.
 * - Downloads are additive: `bulkPut` refreshes matching ids and leaves every
 *   other row alone, so user imports, mock data and reviews survive.
 * - Every failure is contained per shard: a 404/offline shard is retried, then
 *   recorded as `failed` and skipped; the caller falls back to whatever is
 *   already local (and eventually to the legacy tier file / mock pool).
 */

/** Local puzzles a tier needs before sample quality stops improving. */
export const MIN_TIER_POOL = 1000;
/** Upper bound on shard downloads per call, so one click cannot fetch 5 MB. */
export const MAX_SHARDS_PER_CALL = 4;
/** Attempts per shard (first try + retries). */
export const SHARD_ATTEMPTS = 2;
/** Base backoff between attempts. */
export const SHARD_RETRY_DELAY_MS = 200;


export interface TierRange {
  slug: string;
  minRating: number;
  maxRating: number;
}

export interface ShardSeedOptions {
  manifest: PuzzleShardManifest;
  /** Local puzzles to reach before stopping. Defaults to `MIN_TIER_POOL`. */
  targetCount?: number;
  maxShards?: number;
  attempts?: number;
  retryDelayMs?: number;
  random?: () => number;
  fetcher?: typeof fetch;
  /**
   * Maps an asset path to a URL. The app passes `assetUrl` (BASE_URL-aware and
   * inline-aware); tests pass the identity. Default: identity.
   */
  resolveUrl?: (path: string) => string;
  now?: () => number;
}

export interface ShardSeedResult {
  /** `shard` = new rows arrived; `cache` = target already satisfied; `empty` = nothing usable. */
  source: 'cache' | 'shard' | 'empty';
  /** Total puzzles in the tier band after the call (includes legacy/mock rows). */
  count: number;
  downloaded: number[];
  failed: number[];
  /** Human-readable reason when something went wrong; never thrown at the UI. */
  error?: string;
}

export interface PruneResult {
  removedShards: number;
  removedPuzzles: number;
  keptShards: number;
}

/** Stable primary key for a downloaded shard. */
export function shardStateId(tierSlug: string, version: number, shardIndex: number): string {
  return `${tierSlug}:${version}:${shardIndex}`;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function countTierPuzzles(tier: TierRange): Promise<number> {
  return db.puzzles
    .where('rating')
    .between(tier.minRating, tier.maxRating, true, true)
    .count();
}

/**
 * Deletes the placeholder rows `buildFallbackPuzzles()` writes for a tier that
 * has no published pool (`mock-{slug}-01`, …).
 *
 * Without this a tier that once fell back to mocks counts as "already seeded"
 * (13 trivial positions beat a 10-puzzle target) and never downloads the real
 * shards — which is exactly how Elite stayed broken after its pool appeared.
 *
 * A mock row frozen into a saved set is kept: deleting it would leave the set
 * unable to resolve its membership.
 */
async function dropPlaceholderPuzzles(tierSlug: string): Promise<number> {
  const ids = (await db.puzzles
    .where('puzzle_id')
    .startsWith(`mock-${tierSlug}-`)
    .primaryKeys()) as string[];
  if (ids.length === 0) return 0;

  const referenced = new Set<string>();
  const [sets, legacySets] = await Promise.all([
    db.puzzle_sets.toArray(),
    db.woodpecker_sets.toArray(),
  ]);
  for (const set of sets) for (const id of set.puzzle_ids) referenced.add(id);
  for (const set of legacySets) for (const id of set.puzzle_ids) referenced.add(id);

  const removable = ids.filter((id) => !referenced.has(id));
  if (removable.length > 0) await db.puzzles.bulkDelete(removable);
  return removable.length;
}

/**
 * Fetches and validates `{tier}/manifest.json`.
 *
 * Returns `null` for a missing, unreadable or mismatched manifest — the caller
 * then keeps the legacy single-file path, which is exactly what a deployment
 * that has not generated shards yet needs.
 */
export async function loadTierManifest(
  tier: TierRange,
  deps: { fetcher?: typeof fetch; resolveUrl?: (path: string) => string } = {},
): Promise<PuzzleShardManifest | null> {
  const fetcher = deps.fetcher ?? fetch;
  const resolveUrl = deps.resolveUrl ?? ((path: string) => path);

  try {
    const response = await fetcher(resolveUrl(tierManifestFile(tier.slug)), { cache: 'no-cache' });
    if (!response.ok) return null;

    const manifest = parseShardManifest(await response.json());
    if (manifest.tier !== tier.slug) {
      console.warn(`Ignoring manifest for "${manifest.tier}" while seeding "${tier.slug}".`);
      return null;
    }
    return manifest;
  } catch (cause) {
    console.warn(`No usable shard manifest for ${tier.slug}:`, cause);
    return null;
  }
}

/**
 * Writes one shard's puzzles.
 *
 * Duplicate ids (within the payload or already in the database) collapse onto
 * the primary key, so replaying a shard — or a regenerated pool that reuses an
 * id — can never create a second row. Rows are tagged with `shard_id` for
 * pruning and marked `source: 'lichess'`.
 */
async function storeShardPuzzles(
  tierSlug: string,
  version: number,
  shardIndex: number,
  puzzles: readonly StoredPuzzle[],
  importedAt: number,
): Promise<{ total: number; inserted: number; updated: number }> {
  const shardId = shardStateId(tierSlug, version, shardIndex);
  const unique = new Map<string, StoredPuzzle>();

  for (const puzzle of puzzles) {
    unique.set(puzzle.puzzle_id, {
      ...puzzle,
      source: 'lichess',
      imported_at: importedAt,
      shard_id: shardId,
    });
  }

  const rows = [...unique.values()];
  if (rows.length === 0) return { total: 0, inserted: 0, updated: 0 };

  const existing = await db.puzzles.bulkGet(rows.map((row) => row.puzzle_id));
  await db.puzzles.bulkPut(rows);

  const updated = existing.filter((row) => row !== undefined).length;
  return { total: rows.length, inserted: rows.length - updated, updated };
}

/**
 * Ensures one tier has at least `targetCount` local puzzles, downloading shards
 * as needed.
 *
 * Behaviour worth knowing:
 * - Shards already `downloaded` for *this manifest version* are skipped; a new
 *   version therefore adds its shards without deleting the old rows.
 * - `failed` shards stay out of the seeded set, so the next call retries them.
 * - The starting shard is random, so two devices seeding the same tier usually
 *   hold different (equally representative) slices.
 * - When every shard is present and the target still is not met, the call ends
 *   quietly with `source: 'cache'` — there is nothing left to download, and the
 *   UI's existing "not enough eligible puzzles" guard handles the rest.
 */
export async function seedTierFromShards(
  tier: TierRange,
  options: ShardSeedOptions,
): Promise<ShardSeedResult> {
  const { manifest } = options;
  const target = Math.max(1, Math.floor(options.targetCount ?? MIN_TIER_POOL));
  const maxShards = Math.max(0, Math.floor(options.maxShards ?? MAX_SHARDS_PER_CALL));
  const attempts = Math.max(1, Math.floor(options.attempts ?? SHARD_ATTEMPTS));
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? SHARD_RETRY_DELAY_MS);
  const random = options.random ?? Math.random;
  const fetcher = options.fetcher ?? fetch;
  const resolveUrl = options.resolveUrl ?? ((path: string) => path);
  const now = options.now ?? Date.now;

  /* A tier with a real pool must not keep serving the mock stand-ins. */
  await dropPlaceholderPuzzles(tier.slug);

  let count = await countTierPuzzles(tier);
  if (count >= target) return { source: 'cache', count, downloaded: [], failed: [] };

  const states = await db.puzzle_shards
    .where('[tier_slug+manifest_version]')
    .equals([tier.slug, manifest.version])
    .toArray();
  const seeded = new Set(
    states.filter((state) => state.status === 'downloaded').map((state) => state.shard_index),
  );

  const plan = planShardFetch(manifest, {
    seeded,
    startIndex: Math.floor(random() * manifest.shards.length),
    maxShards,
  });

  if (plan.length === 0) {
    return {
      source: 'cache',
      count,
      downloaded: [],
      failed: [],
      error:
        count === 0
          ? `Every ${tier.slug} shard is recorded but no puzzles are stored. Run the pool build again.`
          : undefined,
    };
  }

  const downloaded: number[] = [];
  const failed: number[] = [];
  let lastError: string | undefined;

  for (const shardIndex of plan) {
    if (count >= target) break;

    const descriptor = manifest.shards.find((shard) => shard.index === shardIndex);
    if (!descriptor) continue;

    const stateId = shardStateId(tier.slug, manifest.version, descriptor.index);
    const url = resolveUrl(tierShardFile(tier.slug, descriptor.file));
    let stored = 0;
    let lastAttempt = 0;
    let shardError: string | undefined;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      lastAttempt = attempt;
      try {
        const response = await fetcher(url, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${descriptor.file}`);

        const parsed = parseShardPayload(await response.json(), manifest, descriptor);
        if (parsed.skipped > 0) {
          console.warn(`Skipped ${parsed.skipped} malformed puzzle(s) in ${descriptor.file}.`);
        }

        const written = await storeShardPuzzles(
          tier.slug,
          manifest.version,
          descriptor.index,
          parsed.puzzles,
          now(),
        );
        stored = written.total;
        shardError = undefined;
        break;
      } catch (cause) {
        shardError = errorMessage(cause);
        if (attempt < attempts && retryDelayMs > 0) {
          await defaultDelay(retryDelayMs * attempt);
        }
      }
    }

    if (stored > 0) {
      const state: PuzzleShardState = {
        id: stateId,
        tier_slug: tier.slug,
        manifest_version: manifest.version,
        shard_index: descriptor.index,
        file: descriptor.file,
        status: 'downloaded',
        puzzle_count: stored,
        attempts: lastAttempt,
        downloaded_at: now(),
      };
      await db.puzzle_shards.put(state);
      downloaded.push(descriptor.index);
      count = await countTierPuzzles(tier);
    } else {
      lastError = shardError ?? 'unknown error';
      await db.puzzle_shards.put({
        id: stateId,
        tier_slug: tier.slug,
        manifest_version: manifest.version,
        shard_index: descriptor.index,
        file: descriptor.file,
        status: 'failed',
        puzzle_count: 0,
        attempts: lastAttempt,
        downloaded_at: now(),
        last_error: lastError,
      });
      failed.push(descriptor.index);
    }
  }

  return {
    source: downloaded.length > 0 ? 'shard' : 'cache',
    count,
    downloaded,
    failed,
    error: failed.length > 0 ? lastError : undefined,
  };
}

/**
 * Deletes downloaded shards that no saved training set references.
 *
 * Safety rules:
 * - Only rows carrying a `shard_id` are candidates; imported/practice/review
 *   rows are never touched.
 * - A shard is kept whole when *any* of its puzzles appears in a training set
 *   (`puzzle_sets` or the legacy `woodpecker_sets`), because cycles resolve
 *   puzzles by id and a partial shard would break a frozen set.
 * - Attempts are preserved: they belong to sets, which stay untouched.
 */
export async function pruneShardPuzzles(): Promise<PruneResult> {
  const [sets, legacySets] = await Promise.all([
    db.puzzle_sets.toArray(),
    db.woodpecker_sets.toArray(),
  ]);

  const referenced = new Set<string>();
  for (const set of sets) for (const id of set.puzzle_ids) referenced.add(id);
  for (const set of legacySets) for (const id of set.puzzle_ids) referenced.add(id);

  const states = await db.puzzle_shards.where('status').equals('downloaded').toArray();
  let removedShards = 0;
  let removedPuzzles = 0;
  let keptShards = 0;

  for (const state of states) {
    const ids = (await db.puzzles.where('shard_id').equals(state.id).primaryKeys()) as string[];

    if (ids.length === 0) {
      // Bookkeeping without rows (storage cleared, rows deleted by hand).
      await db.puzzle_shards.delete(state.id);
      removedShards += 1;
      continue;
    }

    if (ids.some((id) => referenced.has(id))) {
      keptShards += 1;
      continue;
    }

    await db.transaction('rw', db.puzzles, db.puzzle_shards, async () => {
      await db.puzzles.bulkDelete(ids);
      await db.puzzle_shards.delete(state.id);
    });
    removedShards += 1;
    removedPuzzles += ids.length;
  }

  return { removedShards, removedPuzzles, keptShards };
}

/** Shard states for one tier, newest version first (diagnostics/tests). */
export async function listTierShardStates(tierSlug: string): Promise<PuzzleShardState[]> {
  const rows = await db.puzzle_shards.where('tier_slug').equals(tierSlug).toArray();
  return rows.sort((a, b) => b.manifest_version - a.manifest_version || a.shard_index - b.shard_index);
}
