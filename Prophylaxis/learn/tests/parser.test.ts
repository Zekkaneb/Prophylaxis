/**
 * Lesson 3 + 4 tests — the parser and the move tree.
 *
 * The assertions read like sentences about the tree: "e4's first child is e5,
 * its second child is the c5 variation". That is the mental model students
 * should keep: `children[0]` is the line, `children[1..]` are the alternatives.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mainline, parsePgn } from '../../src/pgn/index.ts';

test('builds a tree where children[0] is the main line and children[1] is a variation', () => {
  const { games } = parsePgn('1. e4 e5 (1... c5 2. Nf3) 2. Nf3 Nc6');
  const [game] = games;

  const e4 = game.root.children[0];
  assert.equal(e4.san, 'e4');

  // Two replies to e4: e5 (main) and c5 (the Sicilian, written second).
  assert.deepEqual(
    e4.children.map((child) => child.san),
    ['e5', 'c5'],
  );

  // Both continuations live under their own parent, at the same ply.
  assert.equal(e4.children[0].children[0].san, 'Nf3');
  assert.equal(e4.children[1].children[0].san, 'Nf3');

  assert.deepEqual(
    mainline(game).map((node) => node.san),
    ['e4', 'e5', 'Nf3', 'Nc6'],
  );
});

test('a comment belongs to the move before it', () => {
  const { games } = parsePgn('1. e4 { king pawn } e5 ; open game\n2. Nf3');

  const e4 = games[0].root.children[0];
  const e5 = e4.children[0];

  assert.equal(e4.comment, 'king pawn');
  assert.equal(e5.comment, 'open game');
});

test('a comment before the first move belongs to the root', () => {
  const { games } = parsePgn('{ A study of the Italian } 1. e4 e5');

  assert.equal(games[0].root.comment, 'A study of the Italian');
  assert.equal(games[0].root.children[0].comment, '');
});

test('converts !? suffixes and $n annotations to numeric NAGs', () => {
  const { games } = parsePgn('1. e4!? e5 $14 2. Nf3?!');

  const e4 = games[0].root.children[0];
  const e5 = e4.children[0];
  const nf3 = e5.children[0];

  assert.deepEqual(e4.nags, [5]);
  assert.deepEqual(e5.nags, [14]);
  assert.deepEqual(nf3.nags, [6]);
  assert.equal(nf3.san, 'Nf3');
});

test('strips Lichess clock commands out of comments', () => {
  const { games } = parsePgn('1. e4 { [%clk 0:03:00] Played instantly } e5');

  assert.equal(games[0].root.children[0].comment, 'Played instantly');
});

test('handles multiple games in one file', () => {
  const { games } = parsePgn(
    '[Event "A"]\n\n1. e4 e5 1-0\n\n[Event "B"]\n\n1. d4 d5 0-1\n',
  );

  assert.equal(games.length, 2);
  assert.equal(games[0].headers.Event, 'A');
  assert.equal(games[1].headers.Event, 'B');
  assert.equal(games[1].root.children[0].san, 'd4');
  assert.equal(games[1].result, '0-1');
});

test('normalises zero-style castling', () => {
  const { games } = parsePgn('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. 0-0');

  assert.equal(mainline(games[0]).at(-1)?.san, 'O-O');
});

test('never throws on junk; reports it as warnings', () => {
  const { games } = parsePgn('1. e4 & e5 (unclosed');

  assert.ok(games[0].warnings.some((warning) => warning.includes('Unrecognised token')));
  assert.ok(games[0].warnings.some((warning) => warning.includes('unclosed variation')));
});
