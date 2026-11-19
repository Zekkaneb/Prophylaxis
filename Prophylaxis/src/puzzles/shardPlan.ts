import type { StoredPuzzle } from './types.ts';

/**
 * Pure shard-planning helpers.
 *
 * Shared by the ingestion script (which builds the pools), the runtime seeding
 * service (which downloads them) and the tests. Nothing here touches Dexie,
 * `fetch` or the DOM, so every function is deterministic given its inputs and
 * can run in Node.
 *
 * ## Why shards at all
 *
 * The published puzzle data is a *bounded uniform sample* of a tier: the full
 * Lichess database (6.2M rows) is far too large to ship to a browser, so the
 * build keeps `pool_size` uniformly sampled puzzles per tier and splits them
 * into fixed-size shards. A shard is itself a uniform random sample of the
 * tier's population, so a training set drawn from one shard is unbiased and
 * the user only downloads ~350 KB instead of gigabytes.
 */

/** One shard entry inside a tier manifest. */
export interface PuzzleShardDescriptor {
  /** 1-based shard number, stable for a given manifest version. */
  index: number;
  /** File name inside the tier directory, e.g. `shard-0001.json`. */
  file: string;
  count: number;
  first_id?: string;
  last_id?: string;
}

/** `public/puzzles/{tier}/manifest.json` */
export interface PuzzleShardManifest {
  tier: string;
  name: string;
  min_rating: number;
  max_rating: number;
  /** Bumped whenever the pool is regenerated; keys downloaded-shard state. */
  version: number;
  generated_at: string;
  source: string;
  /** Seed used for reservoir sampling + shuffling (reproducible builds). */
  seed: number;
  pool_size: number;
  shard_size: number;
  count: number;
  shards: PuzzleShardDescriptor[];
}

/** `public/puzzles/{tier}/shard-000N.json` */
export interface PuzzleShardPayload {
  tier: string;
  version: number;
  shard: number;
  count: number;
  puzzles: StoredPuzzle[];
}

/* -------------------------------------------------------------------------- */
/*                              Deterministic PRNG                            */
/* -------------------------------------------------------------------------- */

/** FNV-1a, 32-bit. Turns a readable seed (`"20261118:novice:reservoir"`) into a number. */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Small, fast, deterministic PRNG. Same seed ⇒ same sequence, in Node and browsers. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/* -------------------------------------------------------------------------- */
/*                             Reservoir sampling                             */
/* -------------------------------------------------------------------------- */

/**
 * Uniform reservoir sample of a stream (Algorithm R).
 *
 * The generator feeds *every* valid, quality-passing puzzle in a tier exactly
 * once and keeps a bounded, uniformly distributed subset — no popularity bias
 * and flat memory over 6.2M rows.
 *
 * Determinism: for a fixed `capacity`, PRNG and offer order the retained set is
 * identical on every run, which is what makes the published manifest
 * reproducible from `--seed`.
 */
export class ReservoirSampler<T> {
  readonly capacity: number;
  private readonly random: () => number;
  private readonly retained: T[] = [];
  private seen = 0;

  constructor(capacity: number, random: () => number) {
    this.capacity = Math.max(0, Math.floor(capacity));
    this.random = random;
  }

  /** Candidates offered so far (including rejected ones). */
  get seenCount(): number {
    return this.seen;
  }

  get items(): readonly T[] {
    return this.retained;
  }

  offer(item: T): void {
    const index = this.seen;
    this.seen += 1;

    if (this.capacity === 0) return;
    if (this.retained.length < this.capacity) {
      this.retained.push(item);
      return;
    }

    // Pick a position in [0, index] and swap the newcomer in when it lands in
    // the reservoir. `index + 1` is the number of candidates seen so far.
    const slot = Math.floor(this.random() * (index + 1));
    if (slot < this.capacity) this.retained[slot] = item;
  }
}

/** Fisher–Yates with an injected PRNG, so the shard order is reproducible. */
export function shuffleWith<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const swap = copy[index];
    copy[index] = copy[swapIndex];
    copy[swapIndex] = swap;
  }
  return copy;
}

/** Splits a pool into fixed-size shards (the last one may be smaller). */
export function chunkIntoShards<T>(items: readonly T[], shardSize: number): T[][] {
  const size = Math.max(1, Math.floor(shardSize));
  const shards: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    shards.push(items.slice(start, start + size));
  }
  return shards;
}

/* -------------------------------------------------------------------------- */
/*                            Manifest validation                             */
/* -------------------------------------------------------------------------- */

function invalid(message: string): never {
  throw new Error(`Invalid puzzle shard manifest: ${message}`);
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

const SHARD_FILE_RE = /^[a-z0-9][a-z0-9._-]*\.json$/i;

/**
 * Validates a manifest before anything is stored. A malformed manifest must
 * never leave the app in a half-seeded state, so every field the runtime relies
 * on is checked here instead of at use time.
 */
export function parseShardManifest(payload: unknown): PuzzleShardManifest {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    invalid('expected a JSON object');
  }
  const raw = payload as Record<string, unknown>;

  if (typeof raw.tier !== 'string' || raw.tier.trim() === '') invalid('missing tier');
  if (!isFiniteInteger(raw.version) || raw.version < 1) invalid('version must be a positive integer');
  if (!isFiniteInteger(raw.shard_size) || raw.shard_size < 1) invalid('shard_size must be positive');
  if (!isFiniteInteger(raw.count) || raw.count < 1) invalid('count must be positive');
  if (!isNonNegativeNumber(raw.min_rating) || !isNonNegativeNumber(raw.max_rating)) {
    invalid('missing rating bounds');
  }
  if (raw.max_rating < raw.min_rating) invalid('max_rating is below min_rating');
  if (!Array.isArray(raw.shards) || raw.shards.length === 0) invalid('shards must be a non-empty array');

  const shards: PuzzleShardDescriptor[] = [];
  let total = 0;
  let previousIndex = 0;

  for (const [position, entry] of raw.shards.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      invalid(`shard #${position + 1} is not an object`);
    }
    const shard = entry as Record<string, unknown>;

    if (!isFiniteInteger(shard.index) || shard.index < 1) {
      invalid(`shard #${position + 1} has an invalid index`);
    }
    if (shard.index <= previousIndex) invalid('shard indices must be unique and ascending');
    previousIndex = shard.index;

    if (typeof shard.file !== 'string' || !SHARD_FILE_RE.test(shard.file)) {
      invalid(`shard #${position + 1} has an invalid file name`);
    }
    if (!isFiniteInteger(shard.count) || shard.count < 1) {
      invalid(`shard #${position + 1} has an invalid count`);
    }
    if (shard.count > raw.shard_size) {
      invalid(`shard #${position + 1} is larger than shard_size`);
    }

    total += shard.count;
    shards.push({
      index: shard.index,
      file: shard.file,
      count: shard.count,
      first_id: typeof shard.first_id === 'string' ? shard.first_id : undefined,
      last_id: typeof shard.last_id === 'string' ? shard.last_id : undefined,
    });
  }

  if (total !== raw.count) invalid(`shard counts sum to ${total}, expected ${raw.count}`);

  return {
    tier: raw.tier,
    name: typeof raw.name === 'string' ? raw.name : raw.tier,
    min_rating: raw.min_rating,
    max_rating: raw.max_rating,
    version: raw.version,
    generated_at: typeof raw.generated_at === 'string' ? raw.generated_at : '',
    source: typeof raw.source === 'string' ? raw.source : 'unknown',
    seed: isFiniteInteger(raw.seed) ? raw.seed : 0,
    pool_size: isFiniteInteger(raw.pool_size) ? raw.pool_size : total,
    shard_size: raw.shard_size,
    count: raw.count,
    shards,
  };
}

/** The URL a tier's manifest is served from (GitHub Pages, dev server, …). */
export function tierManifestFile(slug: string): string {
  return `/puzzles/${slug}/manifest.json`;
}

/** The URL one shard of a tier is served from. */
export function tierShardFile(slug: string, file: string): string {
  return `/puzzles/${slug}/${file}`;
}

/* -------------------------------------------------------------------------- */
/*                              Payload validation                            */
/* -------------------------------------------------------------------------- */

function normalizeRawPuzzle(raw: unknown): StoredPuzzle | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  const id = entry.puzzle_id ?? entry.PuzzleId ?? entry.id;
  if (
    typeof id !== 'string' ||
    typeof entry.fen !== 'string' ||
    typeof entry.moves !== 'string' ||
    !isNonNegativeNumber(entry.rating)
  ) {
    return null;
  }
  return {
    puzzle_id: id,
    fen: entry.fen,
    moves: entry.moves.trim(),
    rating: entry.rating,
    themes: Array.isArray(entry.themes)
      ? entry.themes.filter((theme): theme is string => typeof theme === 'string')
      : [],
  };
}

/** Accepts Lichess-style records (`PuzzleId`) and our own `puzzle_id` shape. */
export function normalizePuzzle(raw: unknown): StoredPuzzle | null {
  return normalizeRawPuzzle(raw);
}

export interface ParsedShard {
  tier: string;
  version: number;
  shard: number;
  puzzles: StoredPuzzle[];
  skipped: number;
}

/**
 * Validates a downloaded shard against its manifest before any row is written.
 * Individual malformed puzzles are dropped (and counted) rather than failing
 * the whole shard; a shard whose declared tier/version disagrees with the
 * manifest is rejected outright — that is how a stale CDN or an outdated
 * manifest is detected instead of silently mixing pools.
 */
export function parseShardPayload(
  payload: unknown,
  manifest: PuzzleShardManifest,
  descriptor: PuzzleShardDescriptor,
): ParsedShard {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`Shard ${descriptor.file} is not a JSON object.`);
  }
  const raw = payload as Record<string, unknown>;

  if (raw.tier !== manifest.tier) {
    throw new Error(`Shard ${descriptor.file} belongs to "${String(raw.tier)}", expected "${manifest.tier}".`);
  }
  if (isFiniteInteger(raw.version) && raw.version !== manifest.version) {
    throw new Error(
      `Shard ${descriptor.file} is version ${raw.version}, expected ${manifest.version}.`,
    );
  }
  if (isFiniteInteger(raw.shard) && raw.shard !== descriptor.index) {
    throw new Error(`Shard ${descriptor.file} says it is #${raw.shard}, expected #${descriptor.index}.`);
  }
  if (!Array.isArray(raw.puzzles)) {
    throw new Error(`Shard ${descriptor.file} has no puzzles array.`);
  }

  const puzzles: StoredPuzzle[] = [];
  let skipped = 0;
  for (const entry of raw.puzzles) {
    const puzzle = normalizeRawPuzzle(entry);
    if (puzzle) puzzles.push(puzzle);
    else skipped += 1;
  }

  if (puzzles.length === 0) throw new Error(`Shard ${descriptor.file} contained no usable puzzles.`);

  return {
    tier: manifest.tier,
    version: manifest.version,
    shard: descriptor.index,
    puzzles,
    skipped,
  };
}

/* -------------------------------------------------------------------------- */
/*                                Fetch planning                              */
/* -------------------------------------------------------------------------- */

export interface ShardFetchPlanOptions {
  /** Shard indices already stored for this manifest version. */
  seeded?: ReadonlySet<number> | readonly number[];
  /** Where to start in the (wrapped) shard list; defaults to shard #1. */
  startIndex?: number;
  /** Upper bound on shards downloaded in one call. */
  maxShards?: number;
}

/**
 * Chooses which shards to download next.
 *
 * Starts at a caller-supplied (usually random) offset and wraps around, so two
 * users seeding the same tier generally download different shards — together
 * with reservoir sampling this makes each local pool an unbiased sample.
 * Shards already stored for the current manifest version are skipped; failed
 * shards are not "seeded", so a later call retries them.
 */
export function planShardFetch(
  manifest: PuzzleShardManifest,
  options: ShardFetchPlanOptions = {},
): number[] {
  const seeded =
    options.seeded instanceof Set
      ? options.seeded
      : new Set<number>(Array.isArray(options.seeded) ? options.seeded : []);
  const maxShards = Math.max(0, Math.floor(options.maxShards ?? manifest.shards.length));
  if (maxShards === 0) return [];

  const available = manifest.shards
    .map((shard) => shard.index)
    .filter((index) => !seeded.has(index));
  if (available.length === 0) return [];

  const offset = Math.abs(Math.floor(options.startIndex ?? 0)) % available.length;
  const ordered = [...available.slice(offset), ...available.slice(0, offset)];
  return ordered.slice(0, maxShards);
}
