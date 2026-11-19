#!/usr/bin/env node
/**
 * Audits the *real* Lichess Open Puzzle Database against the ingestion pipeline.
 *
 *   node scripts/audit-lichess-ingest.mjs \
 *     --file lichess_db_puzzle.csv/lichess_db_puzzle.csv \
 *     --chunks 6 --chunk-mb 8 --max-rows-per-chunk 60000
 *
 * Sampling is stratified: one contiguous block is read at evenly spaced offsets
 * across the file, aligned to whole lines, so the sample spans the whole rating
 * and theme range instead of only the first tier. Every block goes through the
 * same `parseCsv` / `parseLichessPuzzleRow` / `validateLichessPuzzle` /
 * `classifyPuzzleRating` code the ingest script uses — this measures the
 * implementation, not a re-implementation of it.
 *
 * Nothing is written to the puzzle library and nothing is ingested: the script
 * only reads, counts and reports. `--json <path>` saves the report.
 */

import { open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isLichessHeader, parseCsv, parseLichessCsv, parseLichessPuzzleRow } from '../src/puzzles/lichessCsv.ts';
import { validateLichessPuzzle } from '../src/puzzles/puzzleValidation.ts';
import {
  PUZZLE_TIER_BANDS,
  classifyPuzzleRating,
  getTierBand,
  isAuthoritativeTier,
  toChessComRating,
} from '../src/puzzles/tiers.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const options = {
    file: 'lichess_db_puzzle.csv/lichess_db_puzzle.csv',
    fixture: 'scripts/fixtures/lichess-puzzles.sample.csv',
    chunks: 6,
    chunkMb: 8,
    maxRowsPerChunk: 60_000,
    json: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case '--file':
        options.file = value;
        index += 1;
        break;
      case '--fixture':
        options.fixture = value;
        index += 1;
        break;
      case '--chunks':
        options.chunks = Number(value);
        index += 1;
        break;
      case '--chunk-mb':
        options.chunkMb = Number(value);
        index += 1;
        break;
      case '--max-rows-per-chunk':
        options.maxRowsPerChunk = Number(value);
        index += 1;
        break;
      case '--json':
        options.json = value;
        index += 1;
        break;
      default:
        if (flag.startsWith('--')) throw new Error(`Unknown option ${flag}`);
    }
  }
  return options;
}

function bump(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(fraction * (sorted.length - 1))));
  return sorted[index];
}

function createCollector() {
  return {
    rows: 0,
    parsed: 0,
    structurallyRejected: 0,
    invalid: 0,
    valid: 0,
    duplicates: 0,
    columnCounts: new Map(),
    rejectReasons: new Map(),
    rejectSamples: [],
    tiers: new Map(),
    belowFloor: 0,
    aboveCeiling: 0,
    outsideAuthoritative: 0,
    tierMismatches: 0,
    qualityPass: new Map(),
    idLengths: new Map(),
    ratings: [],
    deviations: [],
    popularity: [],
    plays: [],
    themesEmpty: 0,
    themeCounts: new Map(),
    openingTagRows: 0,
    openingTagCounts: new Map(),
    dailyDateRows: 0,
    gameUrlEmpty: 0,
    gameUrlGamePath: 0,
    gameUrlAnchor: 0,
    movesMin: Infinity,
    movesMax: 0,
    oddMoves: 0,
    evenMoves: 0,
    conventionChecked: 0,
    conventionMismatches: 0,
    solutionParity: 0,
    firstMoveByTurnSide: 0,
    promotionMoves: 0,
    castlingMoves: 0,
  };
}

const PROMOTION_RE = /^[a-h][1-8][a-h][1-8][qrbn]$/;

/** Feeds one CSV text block through the pipeline and records everything. */
function auditText(text, collector, seen, rowLimit) {
  const rows = parseCsv(text);
  let dataRows = 0;

  for (const row of rows) {
    if (isLichessHeader(row)) continue;
    dataRows += 1;
    collector.rows += 1;
    if (rowLimit && dataRows > rowLimit) {
      collector.rows -= 1;
      break;
    }

    collector.columnCounts.set(row.length, (collector.columnCounts.get(row.length) ?? 0) + 1);

    let record;
    try {
      record = parseLichessPuzzleRow(row);
      collector.parsed += 1;
    } catch (cause) {
      collector.structurallyRejected += 1;
      bump(collector.rejectReasons, cause.message);
      if (collector.rejectSamples.length < 8) {
        collector.rejectSamples.push({ reason: cause.message, snippet: row.join(',').slice(0, 140) });
      }
      continue;
    }

    if (seen.has(record.puzzle_id)) {
      collector.duplicates += 1;
      continue;
    }
    seen.add(record.puzzle_id);

    const validation = validateLichessPuzzle(record);
    if (!validation.ok) {
      collector.invalid += 1;
      bump(collector.rejectReasons, validation.reason ?? 'invalid');
      if (collector.rejectSamples.length < 8) {
        collector.rejectSamples.push({ reason: validation.reason, id: record.puzzle_id });
      }
      continue;
    }
    collector.valid += 1;

    /* ---- rating classification (bands are on the chess.com scale) ---- */
    const chessComRating = toChessComRating(record.rating);
    const slug = classifyPuzzleRating(chessComRating);
    bump(collector.tiers, slug ?? 'unclassified');
    bump(collector.idLengths, record.puzzle_id.length);
    /* The ingest script's default quality gates. */
    if (
      record.popularity >= 80 &&
      record.rating_deviation <= 100 &&
      record.plays >= 50 &&
      slug !== null
    ) {
      bump(collector.qualityPass, slug);
    }
    if (slug === null) collector.belowFloor += 1;
    else if (!isAuthoritativeTier(slug)) collector.aboveCeiling += 1;
    else collector.outsideAuthoritative += 0;

    /* Cross-check the classifier against the band table itself. */
    const expected = PUZZLE_TIER_BANDS.find(
      (band) => chessComRating >= band.minRating && chessComRating <= band.maxRating,
    );
    const expectedSlug = expected ? expected.slug : null;
    if (expectedSlug !== slug) collector.tierMismatches += 1;

    /* ---- metadata ranges ---- */
    collector.ratings.push(record.rating);
    collector.deviations.push(record.rating_deviation);
    collector.popularity.push(record.popularity);
    collector.plays.push(record.plays);
    if (record.themes.length === 0) collector.themesEmpty += 1;
    for (const theme of record.themes) bump(collector.themeCounts, theme);
    if (record.opening_tags.length > 0) {
      collector.openingTagRows += 1;
      for (const tag of record.opening_tags) bump(collector.openingTagCounts, tag);
    }
    if (row[10] && row[10].trim() !== '') collector.dailyDateRows += 1;
    if (!record.game_url) collector.gameUrlEmpty += 1;
    else {
      if (/lichess\.org\/game\//.test(record.game_url)) collector.gameUrlGamePath += 1;
      if (record.game_url.includes('#')) collector.gameUrlAnchor += 1;
    }

    /* ---- move convention ---- */
    const moves = record.moves;
    collector.movesMin = Math.min(collector.movesMin, moves.length);
    collector.movesMax = Math.max(collector.movesMax, moves.length);
    if (moves.length % 2 === 1) collector.oddMoves += 1;
    else collector.evenMoves += 1;

    for (const move of moves) {
      if (PROMOTION_RE.test(move)) collector.promotionMoves += 1;
      if (/^e1[gc]1$|^e8[gc]8$/.test(move)) collector.castlingMoves += 1;
    }

    const sequence = validation.sequence;
    if (sequence) {
      collector.conventionChecked += 1;

      /* The trainer's rule: the solver is the side NOT to move in the FEN. */
      const fenTurn = record.fen.split(' ')[1] === 'b' ? 'b' : 'w';
      const trainerSolver = fenTurn === 'w' ? 'b' : 'w';
      if (trainerSolver !== sequence.solverColor) collector.conventionMismatches += 1;

      /* moves[0] must be the setup move played by the side to move in the FEN. */
      if (sequence.setupMove === moves[0]) collector.firstMoveByTurnSide += 1;

      /* Solutions are the odd indices: ceil((n-1)/2) of them. */
      const expectedSolutions = Math.ceil((moves.length - 1) / 2);
      if (sequence.solutionMoves.length !== expectedSolutions) collector.solutionParity += 1;
    }
  }

  return dataRows;
}

function summarise(collector, extra) {
  const sortedRatings = [...collector.ratings].sort((a, b) => a - b);
  const sortedDeviations = [...collector.deviations].sort((a, b) => a - b);
  const sortedPopularity = [...collector.popularity].sort((a, b) => a - b);
  const sortedPlays = [...collector.plays].sort((a, b) => a - b);
  const topThemes = [...collector.themeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([theme, count]) => ({ theme, count }));

  return {
    ...extra,
    rowCounts: {
      rows: collector.rows,
      parsed: collector.parsed,
      structurallyRejected: collector.structurallyRejected,
      invalid: collector.invalid,
      valid: collector.valid,
      duplicates: collector.duplicates,
    },
    columnCounts: [...collector.columnCounts.entries()].sort((a, b) => a[0] - b[0]),
    tiers: Object.fromEntries(collector.tiers),
    qualityPass: Object.fromEntries(collector.qualityPass),
    idLengths: [...collector.idLengths.entries()].sort((a, b) => a[0] - b[0]),
    rejectReasons: [...collector.rejectReasons.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([reason, count]) => ({ reason, count })),
    rejectSamples: collector.rejectSamples,
    classification: {
      below600: collector.belowFloor,
      above2500: collector.aboveCeiling,
      tierMismatches: collector.tierMismatches,
    },
    metadata: {
      rating: {
        min: sortedRatings[0] ?? null,
        median: percentile(sortedRatings, 0.5),
        max: sortedRatings.at(-1) ?? null,
      },
      ratingDeviation: {
        min: sortedDeviations[0] ?? null,
        median: percentile(sortedDeviations, 0.5),
        max: sortedDeviations.at(-1) ?? null,
        above100: collector.deviations.filter((value) => value > 100).length,
      },
      popularity: {
        min: sortedPopularity[0] ?? null,
        median: percentile(sortedPopularity, 0.5),
        max: sortedPopularity.at(-1) ?? null,
        below80: collector.popularity.filter((value) => value < 80).length,
      },
      plays: {
        min: sortedPlays[0] ?? null,
        median: percentile(sortedPlays, 0.5),
        max: sortedPlays.at(-1) ?? null,
        below50: collector.plays.filter((value) => value < 50).length,
      },
      themes: {
        empty: collector.themesEmpty,
        unique: collector.themeCounts.size,
        top: topThemes,
      },
      openingTags: {
        rowsWithTags: collector.openingTagRows,
        unique: collector.openingTagCounts.size,
      },
      dailyDateRows: collector.dailyDateRows,
      gameUrl: {
        empty: collector.gameUrlEmpty,
        lichessGamePath: collector.gameUrlGamePath,
        withPlyAnchor: collector.gameUrlAnchor,
      },
    },
    convention: {
      checked: collector.conventionChecked,
      solverMismatches: collector.conventionMismatches,
      setupMoveMismatches: collector.conventionChecked - collector.firstMoveByTurnSide,
      solutionParityMismatches: collector.solutionParity,
      moves: {
        min: collector.movesMin === Infinity ? null : collector.movesMin,
        max: collector.movesMax,
        oddLength: collector.oddMoves,
        evenLength: collector.evenMoves,
      },
      promotionMoves: collector.promotionMoves,
      castlingMoves: collector.castlingMoves,
    },
  };
}

async function auditFileChunks(file, options) {
  const handle = await open(file, 'r');
  const { size } = await handle.stat();
  const chunkBytes = options.chunkMb * 1024 * 1024;
  const collector = createCollector();
  const seen = new Set();
  const chunks = [];
  const memorySamples = [];

  const started = performance.now();

  for (let index = 0; index < options.chunks; index += 1) {
    const offset = Math.floor((size / options.chunks) * index);
    const buffer = Buffer.allocUnsafe(Math.min(chunkBytes, size - offset));
    const chunkStart = performance.now();
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);

    let text = buffer.subarray(0, bytesRead).toString('utf8');
    if (index > 0) {
      const firstNewline = text.indexOf('\n');
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : '';
    }
    const lastNewline = text.lastIndexOf('\n');
    if (lastNewline >= 0) text = text.slice(0, lastNewline + 1);

    const rows = auditText(text, collector, seen, options.maxRowsPerChunk);
    const usage = process.memoryUsage();
    memorySamples.push({ chunk: index, offset, rows, rssMb: Math.round(usage.rss / 1e6), heapUsedMb: Math.round(usage.heapUsed / 1e6) });
    chunks.push({
      index,
      offset,
      bytesRead,
      rows,
      ms: Math.round(performance.now() - chunkStart),
    });
  }

  await handle.close();
  const elapsedMs = performance.now() - started;
  const usageEnd = process.memoryUsage();

  return {
    summary: summarise(collector, {
      file: path.relative(root, file),
      sizeBytes: size,
      chunks,
    }),
    timing: {
      elapsedMs: Math.round(elapsedMs),
      rowsPerSecond: Math.round((collector.rows / elapsedMs) * 1000),
    },
    memory: {
      peakRssMb: Math.max(...memorySamples.map((sample) => sample.rssMb)),
      peakHeapUsedMb: Math.max(...memorySamples.map((sample) => sample.heapUsedMb)),
      endRssMb: Math.round(usageEnd.rss / 1e6),
      samples: memorySamples,
      dedupeSetSize: seen.size,
    },
  };
}

async function auditFixture(file) {
  const text = await readFile(file, 'utf8');
  const collector = createCollector();
  const seen = new Set();
  const started = performance.now();
  auditText(text, collector, seen, 0);
  const elapsedMs = performance.now() - started;

  /* Cross-check the public parse entry point agrees with the row-by-row audit. */
  const viaPublicApi = parseLichessCsv(text);

  return {
    summary: summarise(collector, { file: path.relative(root, file), sizeBytes: text.length }),
    crossCheck: {
      publicApiPuzzles: viaPublicApi.puzzles.length,
      publicApiRejected: viaPublicApi.rejected.length,
      publicApiDuplicates: viaPublicApi.duplicates,
      auditValid: collector.valid,
      auditDuplicates: collector.duplicates,
      agrees:
        viaPublicApi.puzzles.length === collector.valid + collector.duplicates &&
        viaPublicApi.rejected.length === collector.structurallyRejected,
    },
    timing: { elapsedMs: Math.round(elapsedMs) },
  };
}

const options = parseArgs(process.argv.slice(2));
const real = await auditFileChunks(path.resolve(root, options.file), options);
const fixture = await auditFixture(path.resolve(root, options.fixture));

const report = {
  generated_at: new Date().toISOString(),
  real: real.summary.rowCounts,
  realDetail: real.summary,
  fixture: fixture.summary,
  fixtureCrossCheck: fixture.crossCheck,
  timing: { real: real.timing, fixture: fixture.timing },
  memory: real.memory,
};

console.log(JSON.stringify(report, null, 2));
if (options.json) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.resolve(root, options.json), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
