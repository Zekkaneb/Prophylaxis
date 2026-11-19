/**
 * Opening book from imported courses: FEN-keyed eligibility, side filtering,
 * deduplication and deterministic selection for the General Bot.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRepertoireBook,
  normalizeFen,
  pickRepertoireMove,
} from '../../src/play/repertoire.ts';
import type { CoursePly, PgnCourseRecord } from '../../src/courses/types.ts';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
const AFTER_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2';
const AFTER_NF3 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';

function ply(
  san: string,
  uci: string,
  before: string,
  after: string,
  color: 'w' | 'b',
  moveNumber: number,
): CoursePly {
  return {
    san,
    uci,
    fen_before: before,
    fen_after: after,
    comment: '',
    nags: [],
    move_number: moveNumber,
    color,
  };
}

function course(id: string, plies: CoursePly[]): PgnCourseRecord {
  return {
    course_id: id,
    title: id,
    repertoire_color: 'w',
    source_name: `${id}.pgn`,
    imported_at: 0,
    warnings: [],
    chapters: [
      {
        chapter_id: `${id}-1`,
        title: 'Line',
        result: '*',
        headers: {},
        plies,
        variation_count: 0,
      },
    ],
  };
}

const italian = course('italian', [
  ply('e4', 'e2e4', START, AFTER_E4, 'w', 1),
  ply('e5', 'e7e5', AFTER_E4, AFTER_E5, 'b', 1),
  ply('Nf3', 'g1f3', AFTER_E5, AFTER_NF3, 'w', 2),
]);

test('normalises FEN down to the position and side to move', () => {
  assert.equal(normalizeFen(AFTER_E4), 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3');
  assert.equal(
    normalizeFen(`${AFTER_E4.split(' ').slice(0, 4).join(' ')} 8 12`),
    normalizeFen(AFTER_E4),
  );
});

test('builds one book per colour', () => {
  const white = buildRepertoireBook([italian], 'w');
  const black = buildRepertoireBook([italian], 'b');

  assert.deepEqual(white.get(normalizeFen(START)), ['e2e4']);
  assert.deepEqual(white.get(normalizeFen(AFTER_E5)), ['g1f3']);
  assert.equal(white.has(normalizeFen(AFTER_E4)), false);

  assert.deepEqual(black.get(normalizeFen(AFTER_E4)), ['e7e5']);
  assert.equal(black.has(normalizeFen(START)), false);
});

test('merges courses and deduplicates repeated moves', () => {
  const duplicate = course('duplicate', [
    ply('e4', 'e2e4', START, AFTER_E4, 'w', 1),
    ply('e4', 'e2e4', START, AFTER_E4, 'w', 1),
  ]);
  const book = buildRepertoireBook([italian, duplicate], 'w');

  assert.deepEqual(book.get(normalizeFen(START)), ['e2e4']);
});

test('keeps genuinely different repertoire choices', () => {
  const queenPawn = course('queen-pawn', [ply('d4', 'd2d4', START, START, 'w', 1)]);
  const book = buildRepertoireBook([italian, queenPawn], 'w');
  assert.deepEqual(book.get(normalizeFen(START)), ['e2e4', 'd2d4']);
});

test('picks from the eligible moves or reports out of book', () => {
  const book = buildRepertoireBook([italian], 'w');
  assert.equal(pickRepertoireMove(book, START, () => 0), 'e2e4');
  assert.equal(pickRepertoireMove(book, AFTER_E4, () => 0), null);

  const queenPawn = course('queen-pawn', [ply('d4', 'd2d4', START, START, 'w', 1)]);
  const multi = buildRepertoireBook([italian, queenPawn], 'w');
  assert.equal(pickRepertoireMove(multi, START, () => 0), 'e2e4');
  assert.equal(pickRepertoireMove(multi, START, () => 0.99), 'd2d4');
});
