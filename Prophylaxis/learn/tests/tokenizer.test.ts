/**
 * Lesson 1 tests — the lexer.
 *
 * These tests are deliberately written against the *token stream*, not against
 * parsed games: if a token is wrong, every later stage is built on sand, and
 * debugging is much easier when the failure names the stage.
 *
 * Run with:  npm run test:pgn
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePgnText, tokenizeAll } from '../../src/pgn/index.ts';

test('normalises BOM and CRLF before lexing', () => {
  assert.equal(normalizePgnText('\uFEFF1. e4\r\n1... e5\r'), '1. e4\n1... e5\n');
});

test('reads tag pairs, including escaped quotes and backslashes', () => {
  const { tokens } = tokenizeAll('[Event "Club \\"A\\""]\n[Site "C:\\\\games"]');

  assert.deepEqual(
    tokens.map((token) => token.kind),
    ['tag', 'tag'],
  );
  assert.equal(tokens[0].kind === 'tag' && tokens[0].value, 'Club "A"');
  assert.equal(tokens[1].kind === 'tag' && tokens[1].value, 'C:\\games');
});

test('classifies move numbers, results and bare SAN words', () => {
  const { tokens } = tokenizeAll('1. e4 e5 2. Nf3 1-0');

  assert.deepEqual(
    tokens.map((token) => token.kind),
    ['number', 'word', 'word', 'number', 'word', 'result'],
  );
});

test('reads both comment syntaxes as comments', () => {
  const { tokens } = tokenizeAll('e4 { a brace comment } e5 ; a line comment\nNf3');

  const comments = tokens.filter((token) => token.kind === 'comment');
  assert.equal(comments.length, 2);
  assert.equal(comments[0].kind === 'comment' && comments[0].text, ' a brace comment ');
  assert.equal(comments[1].kind === 'comment' && comments[1].text, ' a line comment');
});

test('keeps parentheses inside comments from becoming variation tokens', () => {
  const { tokens } = tokenizeAll('e4 { (not a variation) } e5');

  assert.equal(tokens.filter((token) => token.kind === 'variation-start').length, 0);
});

test('emits variation delimiters and NAGs as their own tokens', () => {
  const { tokens } = tokenizeAll('1. e4 (1. d4 $14) $1');

  assert.deepEqual(
    tokens.map((token) => token.kind),
    ['number', 'word', 'variation-start', 'number', 'word', 'nag', 'variation-end', 'nag'],
  );
});

test('a percent line at the start of a line is a producer escape', () => {
  const { tokens } = tokenizeAll('% this is not chess\n1. e4');

  assert.deepEqual(
    tokens.map((token) => token.kind),
    ['number', 'word'],
  );
});

test('malformed tags and unterminated comments warn instead of throwing', () => {
  const { warnings } = tokenizeAll('[Event "unclosed]\n1. e4 { never closed');

  assert.ok(warnings.some((warning) => warning.includes('Malformed tag pair')));
  assert.ok(warnings.some((warning) => warning.includes('Unterminated')));
});
