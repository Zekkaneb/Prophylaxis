/**
 * Lesson 5 tests — the writer and round-tripping.
 *
 * The strongest assertion available to a PGN library is not "the output looks
 * right" but "writing then re-reading gives the same tree". These tests compare
 * a structural signature (san + comments + nags + children), so a dropped
 * variation or a lost annotation fails loudly.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { gameToPgn, parsePgn, writeMovetext, writeSanLine } from '../../src/pgn/index.ts';
import type { PgnNode } from '../../src/pgn/index.ts';
import { lessonToPgn, parseLessonPgn } from '../../src/lessons/lessonPgn.ts';

/** Structural fingerprint of a tree, used to compare parse results. */
function signature(node: PgnNode): unknown {
  return {
    san: node.san,
    comment: node.comment,
    nags: node.nags,
    children: node.children.map(signature),
  };
}

test('round-trips a game with variations, comments and NAGs', () => {
  const source = `[Event "Round trip"]
[White "Ada"]
[Black "Grace"]

1. e4! { king pawn } e5 (1... c5 2. Nf3 { Sicilian } (2. Nc3)) 2. Nf3 Nc6 $14 *`;

  const first = parsePgn(source).games[0];
  const written = gameToPgn(first);
  const second = parsePgn(written).games[0];

  assert.deepEqual(signature(second.root), signature(first.root));
  assert.equal(second.headers.White, 'Ada');
});

test('numbers a line that starts with Black to move', () => {
  const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 5';
  const { games } = parsePgn(`[SetUp "1"]\n[FEN "${fen}"]\n\n5... e5 6. Nf3 *`);

  const movetext = writeMovetext(games[0].root, fen);
  assert.ok(movetext.startsWith('5... e5'), `got: ${movetext}`);
});

test('escapes quotes and backslashes in tag values', () => {
  const { games } = parsePgn('[Event "A \\"quoted\\" event"]\n\n1. e4 *');
  const written = gameToPgn(games[0]);

  assert.ok(written.includes('[Event "A \\"quoted\\" event"]'));
});

test('can write annotations as symbols for human-facing exports', () => {
  const { games } = parsePgn('1. e4!? e5');
  const written = gameToPgn(games[0], { annotations: 'symbol' });

  assert.ok(written.includes('e4!?'));
});

test('emits SetUp and FEN tags for custom starting positions', () => {
  const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
  const written = gameToPgn(
    { index: 0, headers: { Event: 'From a position' }, root: { san: '', comment: '', nags: [], children: [] }, result: '*', warnings: [] },
    { startFen: fen },
  );

  assert.ok(written.includes('[SetUp "1"]'));
  assert.ok(written.includes(`[FEN "${fen}"]`));
});

test('lessons survive a PGN round trip', () => {
  const lesson = {
    id: 'test',
    title: 'Italian Game',
    repertoireColor: 'white' as const,
    moves: [
      { uci: 'e2e4', san: 'e4', explanation: 'Claim the centre.' },
      { uci: 'e7e5', san: 'e5', explanation: 'Symmetry.' },
      { uci: 'g1f3', san: 'Nf3', explanation: 'Develop.' },
    ],
  };

  const pgn = lessonToPgn(lesson);
  assert.ok(pgn.includes('[ChapterName "Italian Game"]'));

  const parsed = parseLessonPgn(pgn);
  assert.deepEqual(
    parsed.moves.map((move) => [move.san, move.explanation]),
    [
      ['e4', 'Claim the centre.'],
      ['e5', 'Symmetry.'],
      ['Nf3', 'Develop.'],
    ],
  );
});

test('writeSanLine flattens the main line only', () => {
  const { games } = parsePgn('1. e4 e5 (1... c5) 2. Nf3');

  assert.equal(writeSanLine(games[0].root), 'e4 e5 Nf3');
});
