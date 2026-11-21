/**
 * Compiles Nina Yang's supplied repertoire PGNs into a position-keyed book.
 * Run with `node scripts/build-nina-book.mjs`.
 *
 * Every chapter is a game; the parser keeps its full variation tree. This
 * script walks that tree, validates every SAN against chess.js (including
 * chapters that start from a FEN), and records only the moves Nina plays.
 * Positions are keyed by board + side to move + castling rights, so
 * transpositions merge without flattening the source.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Chess } from 'chess.js';
import { parsePgn } from '../src/pgn/parser.ts';
import { bookKey } from '../src/play/personality/repertoires/book.ts';
import { STANDARD_START_FEN } from '../src/play/pgn.ts';

const SOURCES = [
  { file: 'repertoires/nina/jobava-london.pgn', id: 'jobava', color: 'w', tags: ['initiative', 'sharp'] },
  { file: 'repertoires/nina/caro-kann.pgn', id: 'caro-kann', color: 'b', tags: ['solid', 'initiative'] },
];

const book = new Map();
const issues = [];
const chapters = [];
let nodes = 0;
let variations = 0;

function slug(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/**
 * Plies already played in a FEN. A chapter that starts mid-line knows only the
 * positions from that depth on, so its compiled moves carry this as `minPly`.
 */
function pliesBefore(fen) {
  const parts = String(fen).trim().split(/\s+/);
  const fullmove = Number(parts[5]) || 1;
  return Math.max(0, (fullmove - 1) * 2 + (parts[1] === 'b' ? 1 : 0));
}

function addMove(key, move, meta) {
  let list = book.get(key);
  if (!list) {
    list = new Map();
    book.set(key, list);
  }
  const uci = `${move.from}${move.to}${move.promotion ?? ''}`;
  const existing = list.get(uci);
  if (existing) {
    existing.weight = Math.max(existing.weight, meta.weight);
    for (const tag of meta.tags) if (!existing.tags.includes(tag)) existing.tags.push(tag);
    if (!existing.lineIds.includes(meta.lineId)) existing.lineIds.push(meta.lineId);
    /* A move also reachable from a chapter that starts at the top of the game
       stays available from the top of the game. */
    if (meta.minPly !== undefined) {
      existing.minPly =
        existing.minPly === undefined ? meta.minPly : Math.min(existing.minPly, meta.minPly);
    }
    return;
  }
  list.set(uci, {
    uci,
    san: move.san,
    tags: [...meta.tags],
    weight: meta.weight,
    lineIds: [meta.lineId],
    ...(meta.minPly ? { minPly: meta.minPly } : {}),
  });
}

for (const source of SOURCES) {
  const text = fs.readFileSync(source.file, 'utf8');
  const parsed = parsePgn(text);
  for (const game of parsed.games) {
    const startFen = game.headers.FEN?.trim() || STANDARD_START_FEN;
    let board;
    try {
      board = new Chess(startFen);
    } catch {
      issues.push({ source: source.id, chapter: game.headers.ChapterName, message: 'invalid FEN' });
      continue;
    }
    if (game.root.children.length === 0) continue;
    /* Intro/conclusion chapters are prose with sample sidelines (the Vienna
       intro even shows a 1.d4 game), not part of the repertoire. */
    if (/introduction|conclusion/i.test(game.headers.ChapterName ?? '')) continue;

    const chapterId = `nina-${source.id}-${slug(game.headers.ChapterName) || game.index}`;
    chapters.push({
      id: chapterId,
      study: game.headers.StudyName || source.id,
      name: game.headers.ChapterName || `Chapter ${game.index + 1}`,
      startFen,
      moves: 0,
      branches: 0,
    });
    const chapter = chapters[chapters.length - 1];
    /* Chapters opened from a FEN begin mid-line; the depth is kept so a
       fragment can only answer a game that has actually come that far. */
    const startPly = pliesBefore(startFen);

    // Mark mainline nodes so variations can be counted and weighted down.
    const mainline = new Set();
    let cursor = game.root;
    while (cursor.children.length > 0) {
      cursor = cursor.children[0];
      mainline.add(cursor);
    }

    const walk = (node, position, depth) => {
      for (const child of node.children) {
        const local = new Chess(position.fen());
        const before = local.fen();
        let move;
        try {
          move = local.move(child.san);
        } catch {
          issues.push({
            source: source.id,
            chapter: chapter.name,
            ply: depth,
            san: child.san,
            message: 'illegal SAN',
          });
          continue;
        }
        if (!move) {
          issues.push({
            source: source.id,
            chapter: chapter.name,
            ply: depth,
            san: child.san,
            message: 'rejected by chess.js',
          });
          continue;
        }

        nodes += 1;
        chapter.moves += 1;
        const isMain = mainline.has(child);
        if (!isMain) {
          variations += 1;
          chapter.branches += 1;
        }

        if (move.color === source.color) {
          addMove(bookKey(before), move, {
            tags: source.tags,
            weight: isMain ? 3 : 1,
            lineId: chapterId,
            minPly: startPly,
          });
        }
        walk(child, local, depth + 1);
      }
    };
    walk(game.root, board, 0);
  }
}

const entries = [];
for (const [key, list] of book) {
  for (const entry of list.values()) entries.push({ key, ...entry });
}

const output = `/**
 * Nina Yang's opening book — generated by scripts/build-nina-book.mjs.
 *
 * Source: the supplied Lichess studies (Jobava London, Caro-Kann Defence).
 * Each chapter's variation tree was validated with chess.js and collapsed into
 * position → Nina's move, so branches, starting FENs and transpositions work
 * without storing a linear game. Do not edit by hand: rerun the script.
 */
import type { OpeningTag } from '../styles.ts';

export interface NinaBookEntry {
  key: string;
  uci: string;
  san: string;
  tags: OpeningTag[];
  weight: number;
  lineIds: string[];
  /** Plies already played when a FEN-started chapter began. */
  minPly?: number;
}

export const NINA_BOOK_STATS = ${JSON.stringify(
  {
    chapters: chapters.length,
    nodes,
    variations,
    positions: book.size,
    moves: entries.length,
    sources: SOURCES.map((source) => source.file),
    issues,
  },
  null,
  2,
)} as const;

export const NINA_BOOK: readonly NinaBookEntry[] = ${JSON.stringify(entries, null, 2)};
`;

const target = path.join('src', 'play', 'personality', 'repertoires', 'ninaBook.ts');
fs.writeFileSync(target, output);
console.log(
  JSON.stringify(
    {
      chapters: chapters.length,
      nodes,
      variations,
      positions: book.size,
      moves: entries.length,
      issues: issues.length,
      bytes: Buffer.byteLength(output),
      target,
    },
    null,
    2,
  ),
);
