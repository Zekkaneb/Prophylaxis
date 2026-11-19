#!/usr/bin/env node
/**
 * Generates CSV fixtures in the official Lichess puzzle layout.
 *
 * The files are *format-accurate* but not Lichess exports: positions come from
 * legal random games replayed with chess.js and the metadata is synthesized.
 * They are shaped to match what the real `lichess_db_puzzle.csv` contains, as
 * measured by `scripts/audit-lichess-ingest.mjs`:
 *
 *   - 11 columns, the last one `DailyDate` (empty except for daily puzzles);
 *   - `Moves` always even length: setup move, solution, …, opponent reply;
 *   - `GameUrl` like `https://lichess.org/game/<8 chars>[/black]#<ply>`;
 *   - ratings below 600 and above 2500 exist (covered by the edge fixture).
 *
 *   node scripts/make-lichess-fixture.mjs [--out scripts/fixtures/lichess-puzzles.sample.csv]
 *
 * Layout (see https://database.lichess.org/#puzzles):
 *
 *   PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags,DailyDate
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';
import { LICHESS_HEADER_LINE } from '../src/puzzles/lichessCsv.ts';
import { hashSeed, mulberry32 } from '../src/puzzles/selection.ts';
import { AUTHORITATIVE_PUZZLE_TIERS, LICHESS_TO_CHESSCOM_SHIFT } from '../src/puzzles/tiers.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? path.resolve(root, args[index + 1]) : fallback;
}

const outPath = argValue('--out', path.join(root, 'scripts', 'fixtures', 'lichess-puzzles.sample.csv'));
const edgePath = argValue('--edge-out', path.join(root, 'scripts', 'fixtures', 'lichess-puzzles.edge.csv'));

/** 210 intermediate rows so a 200-puzzle set can be frozen from the fixture. */
const TIER_PLAN = [
  { slug: 'new-to-chess', count: 10 },
  { slug: 'novice', count: 10 },
  { slug: 'intermediate', count: 210 },
  { slug: 'advanced', count: 10 },
  { slug: 'expert', count: 10 },
  { slug: 'master', count: 10 },
];

const THEMES = [
  'fork',
  'pin',
  'skewer',
  'discoveredAttack',
  'sacrifice',
  'mateIn1',
  'mateIn2',
  'backRankMate',
  'hangingPiece',
  'trappedPiece',
  'doubleCheck',
  'promotion',
  'endgame',
  'middlegame',
  'opening',
  'deflection',
  'attraction',
  'kingsideAttack',
  'exposedKing',
  'interference',
];

const OPENINGS = [
  'Italian_Game',
  'Sicilian_Defense',
  'French_Defense',
  'Queens_Gambit',
  "King's_Indian_Defense",
  'Ruy_Lopez',
  'Caro-Kann_Defense',
];

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function makeId(random, used) {
  for (;;) {
    let id = '';
    for (let index = 0; index < 5; index += 1) {
      id += ID_ALPHABET[Math.floor(random() * ID_ALPHABET.length)];
    }
    if (!used.has(id)) {
      used.add(id);
      return id;
    }
  }
}

function gameUrl(random, used) {
  const side = random() < 0.3 ? '/black' : '';
  const ply = 4 + Math.floor(random() * 90);
  return `https://lichess.org/game/${makeId(random, used)}${side}#${ply}`;
}

/**
 * Plays a legal random continuation and cuts a puzzle out of its tail.
 *
 * The kept length is even, matching Lichess: the sequence is
 * [opponent setup, solution, opponent reply, …, opponent reply], so it always
 * ends on the defender's move.
 */
function makePosition(random) {
  /* A random game can end early, truncating the tail to an odd number of moves.
     Real Lichess sequences are always even, so such a position is replayed. */
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const chess = new Chess();
    const prefixPlies = 2 + Math.floor(random() * 10);
    const keptPlies = 4 + Math.floor(random() * 11) * 2; // 4…24, even
    const uci = [];
    let fen = chess.fen();

    for (let ply = 0; ply < prefixPlies + keptPlies; ply += 1) {
      const moves = chess.moves({ verbose: true });
      if (moves.length === 0) break;
      if (ply === prefixPlies) fen = chess.fen();
      const move = moves[Math.floor(random() * moves.length)];
      uci.push(`${move.from}${move.to}${move.promotion ?? ''}`);
      chess.move(move);
    }

    const tail = uci.slice(prefixPlies);
    if (tail.length >= 4 && tail.length % 2 === 0) return { fen, moves: tail };
  }
  throw new Error('Could not generate an even-length puzzle sequence.');
}

function pickTags(random, count) {
  const chosen = new Set();
  while (chosen.size < count) chosen.add(THEMES[Math.floor(random() * THEMES.length)]);
  return [...chosen];
}

/** One CSV line: 11 columns, exactly like the real export. */
function csvLine({
  id,
  fen,
  moves,
  rating,
  deviation,
  popularity,
  plays,
  themes,
  url,
  openingTags = '',
  dailyDate = '',
}) {
  return [
    id,
    fen,
    moves.join(' '),
    rating,
    deviation,
    popularity,
    plays,
    Array.isArray(themes) ? themes.join(' ') : themes,
    url,
    openingTags,
    dailyDate,
  ].join(',');
}

function buildSample() {
  const random = mulberry32(hashSeed('opening-lab/lichess-fixture/v2'));
  const used = new Set();
  const urlIds = new Set();
  const rows = [LICHESS_HEADER_LINE];
  let row = 0;

  for (const plan of TIER_PLAN) {
    const tier = AUTHORITATIVE_PUZZLE_TIERS.find((entry) => entry.slug === plan.slug);
    if (!tier) throw new Error(`Unknown tier in the fixture plan: ${plan.slug}`);

    for (let index = 0; index < plan.count; index += 1) {
      const { fen, moves } = makePosition(random);
      /* The CSV carries Lichess ratings; the bands are chess.com-scaled. */
      const minRating = tier.minRating - LICHESS_TO_CHESSCOM_SHIFT;
      const maxRating = tier.maxRating - LICHESS_TO_CHESSCOM_SHIFT;
      const rating = minRating + Math.floor(random() * (maxRating - minRating + 1));
      const deviation = 55 + Math.floor(random() * 46);
      const popularity = 85 + Math.floor(random() * 16);
      const plays = 200 + Math.floor(random() * 50_000);
      const themes = pickTags(random, 2 + Math.floor(random() * 2));
      const opening = random() < 0.8 ? OPENINGS[Math.floor(random() * OPENINGS.length)] : '';
      /* One daily puzzle every 25 rows, like the real column. */
      const dailyDate = row % 25 === 12 ? `2024-${String(1 + (row % 12)).padStart(2, '0')}-15` : '';

      rows.push(
        csvLine({
          id: makeId(random, used),
          fen,
          moves,
          rating,
          deviation,
          popularity,
          plays,
          themes,
          url: gameUrl(random, urlIds),
          openingTags: opening,
          dailyDate,
        }),
      );
      row += 1;
    }
  }

  return `${rows.join('\n')}\n`;
}

/**
 * Edge-case fixture: real-shaped rows at the extremes of the real database.
 *
 * 1. rating 399 (below the 600 floor), no popularity/plays/URL
 * 2. rating 3128 (above Master), qualifies for the legacy Elite band
 * 3. duplicate of row 1's id (must be collapsed by dedupe)
 * 4. empty Themes (must fail validation)
 * 5. empty-board FEN (must fail validation)
 * 6. illegal solution move from the starting position (must fail validation)
 * 7. quoted Themes field (must parse)
 */
function buildEdge() {
  const random = mulberry32(hashSeed('opening-lab/lichess-fixture/edge/v2'));
  const used = new Set();
  const urlIds = new Set();
  const first = makePosition(random);
  const second = makePosition(random);
  const third = makePosition(random);
  const rows = [LICHESS_HEADER_LINE];

  const line = (record) => rows.push(csvLine(record));

  line({
    id: makeId(random, used),
    ...first,
    rating: 399,
    deviation: 500,
    popularity: 0,
    plays: 0,
    themes: ['mateIn2', 'endgame'],
    url: '',
    dailyDate: '2024-05-01',
  });
  const belowFloorId = rows[rows.length - 1].split(',')[0];

  line({
    id: makeId(random, used),
    ...second,
    rating: 3128,
    deviation: 60,
    popularity: 100,
    plays: 150_000,
    themes: ['mateIn3', 'veryLong'],
    url: gameUrl(random, urlIds),
    openingTags: 'Sicilian_Defense Najdorf_Variation',
  });

  line({
    id: belowFloorId,
    ...third,
    rating: 1500,
    deviation: 70,
    popularity: 90,
    plays: 500,
    themes: ['fork'],
    url: gameUrl(random, urlIds),
  });

  line({
    id: makeId(random, used),
    ...makePosition(random),
    rating: 1500,
    deviation: 70,
    popularity: 90,
    plays: 500,
    themes: [],
    url: gameUrl(random, urlIds),
  });

  line({
    id: makeId(random, used),
    fen: '8/8/8/8/8/8/8/8 w - - 0 1',
    moves: ['e2e4', 'e7e5'],
    rating: 1500,
    deviation: 70,
    popularity: 90,
    plays: 500,
    themes: ['fork'],
    url: gameUrl(random, urlIds),
  });

  line({
    id: makeId(random, used),
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    moves: ['e2e4', 'a7a8q'],
    rating: 1500,
    deviation: 70,
    popularity: 90,
    plays: 500,
    themes: ['fork'],
    url: gameUrl(random, urlIds),
  });

  line({
    id: makeId(random, used),
    ...makePosition(random),
    rating: 1500,
    deviation: 70,
    popularity: 90,
    plays: 500,
    themes: '"fork mateIn2"',
    url: gameUrl(random, urlIds),
  });

  return `${rows.join('\n')}\n`;
}

const sample = buildSample();
const edge = buildEdge();

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, sample, 'utf8');
await writeFile(edgePath, edge, 'utf8');

console.log(
  `Wrote ${sample.split('\n').length - 2} puzzles to ${path.relative(root, outPath)}`,
);
console.log(
  `Wrote ${edge.split('\n').length - 2} edge rows to ${path.relative(root, edgePath)}`,
);
