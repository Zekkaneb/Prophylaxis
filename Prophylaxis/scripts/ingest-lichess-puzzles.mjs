#!/usr/bin/env node
/**
 * Ingests the Lichess Open Puzzle Database into the app's tier chunks.
 *
 * Source: https://database.lichess.org/#puzzles — `lichess_db_puzzle.csv.zst`
 * (a few gigabytes decompressed). This script streams the file, so memory stays
 * flat no matter how many rows it reads. `.zst` and `.gz` are decompressed on
 * the fly with Node's own zlib (Node 22.15+/23.8+ for zstd); a plain `.csv`
 * works too. `--input -` reads stdin:
 *
 *   node scripts/ingest-lichess-puzzles.mjs --input lichess_db_puzzle.csv.zst
 *   node scripts/ingest-lichess-puzzles.mjs --input lichess_db_puzzle.csv \
 *     --out public/puzzles --per-tier 1000 --min-popularity 80 --max-rd 100
 *
 * Two output modes:
 *
 * `--mode chunk` (default) writes one file per tier to `public/puzzles/{slug}.json`
 *
 *   { tier, name, min_rating, max_rating, target, count, generated_at, puzzles: [...] }
 *
 * which is exactly what the legacy `loadTierFile` reads at runtime. Rows are the
 * best `--per-tier` by quality score.
 *
 * `--mode pool` writes the published shard pool instead:
 *
 *   public/puzzles/{slug}/manifest.json   { version, seed, pool_size, shards: [...] }
 *   public/puzzles/{slug}/shard-0001.json { tier, version, shard, count, puzzles }
 *
 * Rows are a **uniform reservoir sample** (`--per-tier`, default 1,000) of every
 * valid, quality-passing puzzle in the tier, shuffled with `--seed` and split
 * into `--shard-size` (default 1,000) shards. Deterministic: same file + same
 * seed ⇒ byte-identical pools. The runtime downloads one shard at a time, so a
 * 6.2M-row database becomes ~350 KB per user instead of gigabytes.
 *
 * Recommended full build (≈45 min, ~0.7 GB peak RSS):
 *
 *   node scripts/ingest-lichess-puzzles.mjs --mode pool \
 *     --input lichess_db_puzzle.csv/lichess_db_puzzle.csv \
 *     --per-tier 5000 --shard-size 1000 --seed 20261118
 *
 * With `--tier`, rows outside that tier are skipped before move validation, so
 * each tier can be built in its own (much shorter) run. Output is identical to
 * a single all-tier pass.
 *
 * Row pipeline (pool): parse → tier filter → quality gate → dedupe → validate
 * (chess.js replay) → reservoir. In chunk mode validation comes first, so the
 * `valid` counter differs between modes; pool mode deliberately avoids replaying
 * chess.js for rows it will discard.
 *
 * Ratings: Lichess publishes Glicko-2 puzzle ratings, the trainer shows chess.com
 * ones (≈200 points higher). Tiers are classified on the chess.com value and
 * every written `rating` is converted by `toStoredPuzzle()`, so the published
 * pools match the band table in `src/puzzles/tiers.ts`.
 *
 * Harder pools: each tier is filled from the top of its band
 * (`bandRatingFloor`, half the band by default) and one-move puzzles are left
 * out, so a tier's label is a floor rather than a midpoint. Elite keeps its
 * whole 2701–3700 band because the database has almost nothing above 3200.
 * Every band in `PUZZLE_TIER_BANDS` is built, Elite included.
 *
 * No credentials, no API keys, no network calls: download the file yourself.
 */

import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import {
  CsvRecordSplitter,
  isLichessHeader,
  parseLichessPuzzleRow,
} from '../src/puzzles/lichessCsv.ts';
import {
  ReservoirSampler,
  chunkIntoShards,
  hashSeed,
  mulberry32,
  shuffleWith,
} from '../src/puzzles/shardPlan.ts';
import {
  solutionMoveCount,
  toStoredPuzzle,
  validateLichessPuzzle,
} from '../src/puzzles/puzzleValidation.ts';
import {
  PUZZLE_TIER_BANDS,
  TARGET_PUZZLES_PER_TIER,
  bandRatingFloor,
  classifyPuzzleRating,
  getTierBand,
  toChessComRating,
} from '../src/puzzles/tiers.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Solver moves a pool puzzle needs; 1 is a `oneMove` puzzle, which is too easy. */
const MIN_SOLUTION_MOVES = 2;

function parseArgs(argv) {
  const options = {
    input: '',
    out: 'public/puzzles',
    perTier: TARGET_PUZZLES_PER_TIER,
    minPopularity: 80,
    maxDeviation: 100,
    minPlays: 50,
    tiers: [],
    maxRows: Infinity,
    dryRun: false,
    report: '',
    mode: 'chunk',
    shardSize: 1000,
    seed: 20261118,
    version: 0,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case '--input':
      case '-i':
        options.input = value ?? '';
        index += 1;
        break;
      case '--out':
        options.out = value ?? options.out;
        index += 1;
        break;
      case '--per-tier':
        options.perTier = Number(value);
        index += 1;
        break;
      case '--min-popularity':
        options.minPopularity = Number(value);
        index += 1;
        break;
      case '--max-rd':
        options.maxDeviation = Number(value);
        index += 1;
        break;
      case '--min-plays':
        options.minPlays = Number(value);
        index += 1;
        break;
      case '--tier':
        if (value) options.tiers.push(value);
        index += 1;
        break;
      case '--max-rows':
        options.maxRows = Number(value);
        index += 1;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--report':
        options.report = value ?? '';
        index += 1;
        break;
      case '--mode':
        options.mode = value ?? options.mode;
        index += 1;
        break;
      case '--shard-size':
        options.shardSize = Number(value);
        index += 1;
        break;
      case '--seed':
        options.seed = Number(value);
        index += 1;
        break;
      case '--version':
        options.version = Number(value);
        index += 1;
        break;
      case '--help':
      case '-h':
        console.log(
          'Usage: node scripts/ingest-lichess-puzzles.mjs --input <file.csv[.zst|.gz]|-> [options]',
        );
        process.exit(0);
        break;
      default:
        if (flag.startsWith('--')) throw new Error(`Unknown option ${flag}`);
    }
  }

  if (!Number.isFinite(options.perTier) || options.perTier < 0) {
    throw new Error('--per-tier must be a non-negative number (0 = keep every eligible puzzle).');
  }
  for (const tier of options.tiers) {
    if (!getTierBand(tier)) throw new Error(`--tier "${tier}" is not a known tier.`);
  }
  if (options.mode !== 'chunk' && options.mode !== 'pool') {
    throw new Error('--mode must be "chunk" (legacy tier files) or "pool" (manifests + shards).');
  }
  if (!Number.isInteger(options.shardSize) || options.shardSize < 1) {
    throw new Error('--shard-size must be a positive integer.');
  }
  if (!Number.isInteger(options.seed)) throw new Error('--seed must be an integer.');
  if (!Number.isInteger(options.version) || options.version < 0) {
    throw new Error('--version must be a non-negative integer (0 = build timestamp).');
  }
  return options;
}

/** Quality score: popularity first, then how many players have seen it. */
function qualityScore(puzzle) {
  const popularity = Number.isFinite(puzzle.popularity) ? puzzle.popularity : 0;
  const plays = Number.isFinite(puzzle.plays) ? puzzle.plays : 0;
  return popularity * 1_000_000 + Math.min(plays, 1_000_000);
}

/** Keeps the best `limit` puzzles per tier without ever holding the file. */
function offer(bucket, puzzle, limit) {
  if (limit === 0) {
    bucket.push(puzzle);
    return;
  }
  if (bucket.length < limit) {
    bucket.push(puzzle);
    return;
  }
  let worstIndex = 0;
  let worstScore = qualityScore(bucket[0]);
  for (let index = 1; index < bucket.length; index += 1) {
    const score = qualityScore(bucket[index]);
    if (score < worstScore) {
      worstScore = score;
      worstIndex = index;
    }
  }
  if (qualityScore(puzzle) > worstScore) bucket[worstIndex] = puzzle;
}

async function openInput(input) {
  const source = !input || input === '-' ? process.stdin : createReadStream(path.resolve(root, input));
  if (input && input.endsWith('.gz')) return source.pipe(zlib.createGunzip());
  if (input && input.endsWith('.zst')) {
    if (typeof zlib.createZstdDecompress !== 'function') {
      throw new Error(
        'This Node build cannot decompress zstd. Run `zstd -d lichess_db_puzzle.csv.zst` first, then pass the .csv.',
      );
    }
    return source.pipe(zlib.createZstdDecompress());
  }
  return source;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.input) throw new Error('Pass --input <file.csv[.zst|.gz]> (or `-` for stdin).');

  const allowed = new Set(
    options.tiers.length > 0 ? options.tiers : PUZZLE_TIER_BANDS.map((t) => t.slug),
  );
  const buckets = new Map();
  for (const tier of PUZZLE_TIER_BANDS) {
    if (allowed.has(tier.slug)) buckets.set(tier.slug, []);
  }

  // Pool mode: one deterministic reservoir per tier. `--per-tier 0` keeps every
  // eligible puzzle (capacity effectively unbounded).
  const samplers = new Map();
  if (options.mode === 'pool') {
    const capacity = options.perTier === 0 ? Number.MAX_SAFE_INTEGER : options.perTier;
    for (const tier of PUZZLE_TIER_BANDS) {
      if (!allowed.has(tier.slug)) continue;
      samplers.set(
        tier.slug,
        new ReservoirSampler(capacity, mulberry32(hashSeed(`${options.seed}:${tier.slug}:reservoir`))),
      );
    }
  }

  const stats = {
    rows: 0,
    valid: 0,
    rejected: 0,
    duplicates: 0,
    belowQuality: 0,
    belowHardFloor: 0,
    tooFewMoves: 0,
    outsideTiers: 0,
    tierFiltered: 0,
  };
  const rejectReasons = new Map();
  const rejectSamples = [];
  const seen = new Set();

  const splitter = new CsvRecordSplitter();
  const stream = await openInput(options.input);
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const reject = (reason, id) => {
    stats.rejected += 1;
    rejectReasons.set(reason, (rejectReasons.get(reason) ?? 0) + 1);
    if (rejectSamples.length < 5) rejectSamples.push({ line: stats.rows, reason, id });
  };

  const failsQuality = (record) =>
    (Number.isFinite(record.popularity) && record.popularity < options.minPopularity) ||
    (Number.isFinite(record.rating_deviation) && record.rating_deviation > options.maxDeviation) ||
    (Number.isFinite(record.plays) && record.plays < options.minPlays);

  /*
   * "Harder" gates, applied after the quality gates and before the expensive
   * move replay: the puzzle must sit in the top slice of its band and need at
   * least two solver moves. Both thresholds are data (`tiers.ts`), so the UI
   * copy and the published pools cannot disagree.
   */
  const failsDifficulty = (record, tierSlug) => {
    const band = getTierBand(tierSlug);
    if (band && toChessComRating(record.rating) < bandRatingFloor(band)) {
      stats.belowHardFloor += 1;
      return true;
    }
    if (solutionMoveCount(record.moves) < MIN_SOLUTION_MOVES) {
      stats.tooFewMoves += 1;
      return true;
    }
    return false;
  };

  const handleRow = (row) => {
    if (isLichessHeader(row)) return;
    stats.rows += 1;

    let record;
    try {
      record = parseLichessPuzzleRow(row);
    } catch (cause) {
      reject(cause.message);
      return;
    }

    if (options.mode === 'pool') {
      // Pool mode filters cheaply *before* replaying the moves: a per-tier run
      // must not spend chess.js time on rows it will discard.
      const tierSlug = classifyPuzzleRating(toChessComRating(record.rating));
      if (!tierSlug) {
        stats.outsideTiers += 1;
        return;
      }
      if (!allowed.has(tierSlug)) {
        stats.tierFiltered += 1;
        return;
      }
      if (failsQuality(record)) {
        stats.belowQuality += 1;
        return;
      }
      if (failsDifficulty(record, tierSlug)) return;
      if (seen.has(record.puzzle_id)) {
        stats.duplicates += 1;
        return;
      }
      seen.add(record.puzzle_id);

      const validation = validateLichessPuzzle(record);
      if (!validation.ok) {
        reject(validation.reason ?? 'invalid puzzle', record.puzzle_id);
        return;
      }
      stats.valid += 1;

      // Every valid, quality-passing puzzle is offered exactly once, in file
      // order, so the reservoir is uniform over the whole tier.
      samplers.get(tierSlug)?.offer(toStoredPuzzle(record));
      return;
    }

    const validation = validateLichessPuzzle(record);
    if (!validation.ok) {
      reject(validation.reason ?? 'invalid puzzle', record.puzzle_id);
      return;
    }
    stats.valid += 1;

    if (failsQuality(record)) {
      stats.belowQuality += 1;
      return;
    }

    if (seen.has(record.puzzle_id)) {
      stats.duplicates += 1;
      return;
    }
    seen.add(record.puzzle_id);

    const tierSlug = classifyPuzzleRating(toChessComRating(record.rating));
    if (!tierSlug) {
      stats.outsideTiers += 1;
      return;
    }
    if (!allowed.has(tierSlug)) {
      stats.tierFiltered += 1;
      return;
    }
    if (failsDifficulty(record, tierSlug)) return;

    const bucket = buckets.get(tierSlug);
    if (!bucket) return;
    offer(bucket, toStoredPuzzle(record), options.perTier);
  };

  for await (const line of lines) {
    for (const row of splitter.push(`${line}\n`)) handleRow(row);
    if (stats.rows > 0 && stats.rows % 250_000 === 0) {
      console.log(
        `… ${stats.rows.toLocaleString()} rows read, ${stats.valid.toLocaleString()} valid, ` +
          `${stats.rejected.toLocaleString()} rejected`,
      );
    }
    if (stats.rows >= options.maxRows) break;
  }
  for (const row of splitter.flush()) handleRow(row);

  const generatedAt = new Date().toISOString();
  const version = options.version > 0 ? options.version : Date.now();
  const perTier = {};
  const shardsPerTier = {};
  let stored = 0;

  if (options.mode === 'pool') {
    if (!options.dryRun) {
      const outDir = path.resolve(root, options.out);
      await mkdir(outDir, { recursive: true });

      for (const [slug, sampler] of samplers) {
        const band = getTierBand(slug);
        // Shuffle with a separate deterministic stream so shard membership is
        // reproducible but does not correlate with the reservoir order.
        const shuffled = shuffleWith(
          sampler.items,
          mulberry32(hashSeed(`${options.seed}:${slug}:shuffle`)),
        );
        const shards = chunkIntoShards(shuffled, options.shardSize);
        if (shards.length === 0) {
          /* No manifest at all: the trainer then falls back instead of loading
             an empty pool that can never satisfy a set. */
          console.warn(`No ${slug} puzzles passed the gates; nothing written.`);
          perTier[slug] = 0;
          shardsPerTier[slug] = 0;
          continue;
        }
        const tierDir = path.join(outDir, slug);
        await mkdir(tierDir, { recursive: true });

        const descriptors = [];
        for (const [position, puzzles] of shards.entries()) {
          const index = position + 1;
          const file = `shard-${String(index).padStart(4, '0')}.json`;
          await writeFile(
            path.join(tierDir, file),
            `${JSON.stringify({ tier: slug, version, shard: index, count: puzzles.length, puzzles })}\n`,
            'utf8',
          );
          descriptors.push({
            index,
            file,
            count: puzzles.length,
            first_id: puzzles[0]?.puzzle_id,
            last_id: puzzles[puzzles.length - 1]?.puzzle_id,
          });
        }

        const manifest = {
          tier: slug,
          name: band?.name ?? slug,
          /* The served range: the band's hard floor, not its label floor. */
          min_rating: band ? bandRatingFloor(band) : undefined,
          max_rating: band?.maxRating,
          version,
          generated_at: generatedAt,
          source: 'lichess-open-database',
          seed: options.seed,
          pool_size: shuffled.length,
          shard_size: options.shardSize,
          count: shuffled.length,
          shards: descriptors,
        };
        await writeFile(
          path.join(tierDir, 'manifest.json'),
          `${JSON.stringify(manifest, null, 2)}\n`,
          'utf8',
        );

        perTier[slug] = shuffled.length;
        shardsPerTier[slug] = descriptors.length;
        stored += shuffled.length;
      }
    } else {
      for (const [slug, sampler] of samplers) {
        perTier[slug] = sampler.items.length;
        shardsPerTier[slug] = Math.ceil(sampler.items.length / options.shardSize);
      }
      stored = Object.values(perTier).reduce((sum, count) => sum + count, 0);
    }
  } else if (!options.dryRun) {
    const outDir = path.resolve(root, options.out);
    await mkdir(outDir, { recursive: true });
    for (const [slug, puzzles] of buckets) {
      const band = getTierBand(slug);
      const ordered = [...puzzles].sort(
        (a, b) => a.rating - b.rating || a.puzzle_id.localeCompare(b.puzzle_id),
      );
      await writeFile(
        path.join(outDir, `${slug}.json`),
        `${JSON.stringify(
          {
            tier: slug,
            name: band?.name ?? slug,
            min_rating: band ? bandRatingFloor(band) : undefined,
            max_rating: band?.maxRating,
            target: options.perTier,
            count: ordered.length,
            generated_at: generatedAt,
            source: 'lichess-open-database',
            puzzles: ordered,
          },
          null,
          0,
        )}\n`,
        'utf8',
      );
      perTier[slug] = ordered.length;
      stored += ordered.length;
    }
  } else {
    for (const [slug, puzzles] of buckets) perTier[slug] = puzzles.length;
    stored = Object.values(perTier).reduce((sum, count) => sum + count, 0);
  }

  const report = {
    input: options.input,
    mode: options.mode,
    version,
    seed: options.seed,
    shard_size: options.mode === 'pool' ? options.shardSize : undefined,
    generated_at: generatedAt,
    quality: {
      min_popularity: options.minPopularity,
      max_rating_deviation: options.maxDeviation,
      min_plays: options.minPlays,
    },
    difficulty: {
      min_solution_moves: MIN_SOLUTION_MOVES,
      per_tier_floor: Object.fromEntries(
        PUZZLE_TIER_BANDS.map((band) => [band.slug, bandRatingFloor(band)]),
      ),
    },
    per_tier_limit: options.perTier,
    totals: { ...stats, stored },
    per_tier: perTier,
    shards_per_tier: options.mode === 'pool' ? shardsPerTier : undefined,
    reject_reasons: [...rejectReasons.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([reason, count]) => ({ reason, count })),
    reject_samples: rejectSamples,
  };

  const defaultReport =
    options.tiers.length === 1
      ? path.join(options.out, `ingest-report-${options.tiers[0]}.json`)
      : path.join(options.out, 'ingest-report.json');
  const reportPath = path.resolve(root, options.report || defaultReport);
  if (!options.dryRun) {
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  console.log(JSON.stringify(report, null, 2));
  if (options.dryRun) console.log('Dry run — no files written.');
  else console.log(`Wrote ${stored} puzzles across ${Object.keys(perTier).length} tiers → ${options.out}`);
}

await main();
