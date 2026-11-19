/**
 * Builds `public/openings.json` from the Lichess `chess-openings` TSVs.
 *
 * The output maps a normalised FEN — `[board] [turn] [castling]` — to the ECO
 * code and opening name for that position, so the review pipeline can label
 * book moves through transpositions without any engine work.
 *
 * Usage: node scripts/build-openings.mjs
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Chess } from 'chess.js';

const FILES = ['a', 'b', 'c', 'd', 'e'];
const SOURCE = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master';
const CACHE_DIR = '.tmp-openings';
/** Positions deeper than this are irrelevant: review stops tagging at ply 24. */
const MAX_PLIES = 24;
const OUT = join('public', 'openings.json');

function keyFor(fen) {
  const [board, turn, castling] = fen.split(' ');
  return `${board} ${turn} ${castling}`;
}

async function readTsv(file) {
  const cached = join(CACHE_DIR, `${file}.tsv`);
  if (existsSync(cached)) return readFileSync(cached, 'utf8');
  const response = await fetch(`${SOURCE}/${file}.tsv`);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${file}.tsv`);
  const text = await response.text();
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cached, text);
  return text;
}

const positions = new Map(); // key -> { eco, name, distance }
let lines = 0;
let skipped = 0;

for (const file of FILES) {
  const text = await readTsv(file);
  const [header, ...rows] = text.trim().split('\n');
  if (!header.startsWith('eco')) throw new Error(`Unexpected header in ${file}.tsv`);

  for (const row of rows) {
    const [eco, name, pgn] = row.split('\t');
    if (!eco || !name || !pgn) continue;
    lines += 1;

    const game = new Chess();
    const moves = pgn
      .replace(/\{[^}]*\}/g, ' ')
      .replace(/\d+\.(\.\.)?/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    for (const [index, san] of moves.entries()) {
      try {
        game.move(san, { strict: false });
      } catch {
        skipped += 1;
        break;
      }
      const ply = index + 1;
      if (ply > MAX_PLIES) break;

      const key = keyFor(game.fen());
      const existing = positions.get(key);
      // Shortest line to a position wins: it is the most specific name for it.
      if (!existing || ply < existing.distance) {
        positions.set(key, { eco, name, distance: ply });
      }
    }
  }
}

const output = {};
for (const [key, entry] of positions) {
  output[key] = { eco: entry.eco, name: entry.name };
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(output));

const bytes = readFileSync(OUT).byteLength;
console.log(
  `Wrote ${Object.keys(output).length} positions from ${lines} lines ` +
    `(${Math.round(bytes / 1024)} KB, ${skipped} unreadable lines) -> ${OUT}`,
);
