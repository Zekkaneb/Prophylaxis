/**
 * Puzzle validation: Lichess move convention, chess.js legality, metadata
 * sanity and normalization into the stored shape.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseLichessCsv } from '../../src/puzzles/lichessCsv.ts';
import {
  isLegalUciSequence,
  replayUciSequence,
  solutionMoveCount,
  toStoredPuzzle,
  validateLichessPuzzle,
} from '../../src/puzzles/puzzleValidation.ts';
import { toChessComRating } from '../../src/puzzles/tiers.ts';

const FIXTURE = new URL('../../scripts/fixtures/lichess-puzzles.sample.csv', import.meta.url);

async function fixtureRecords() {
  const text = await readFile(FIXTURE, 'utf8');
  return parseLichessCsv(text).puzzles;
}

test('every fixture puzzle replays legally', async () => {
  const records = await fixtureRecords();
  assert.equal(records.length, 260);

  for (const record of records) {
    const validation = validateLichessPuzzle(record);
    assert.equal(validation.ok, true, `${record.puzzle_id}: ${validation.reason}`);
  }
});

test('preserves the Lichess convention: setup move first, then solution moves', async () => {
  const [record] = await fixtureRecords();
  const validation = validateLichessPuzzle(record);
  assert.equal(validation.ok, true);
  const sequence = validation.sequence;
  assert.ok(sequence);

  // The setup move is the first entry and belongs to the opponent's side.
  assert.equal(sequence.setupMove, record.moves[0]);
  const toMove = record.fen.split(' ')[1];
  assert.notEqual(sequence.solverColor, toMove);

  // Solution moves are the odd indices, replies the even ones after the setup.
  assert.deepEqual(
    sequence.solutionMoves,
    record.moves.filter((_, index) => index % 2 === 1),
  );
  assert.deepEqual(
    sequence.replyMoves,
    record.moves.filter((_, index) => index % 2 === 0).slice(1),
  );
  assert.equal(sequence.fens.length, record.moves.length + 1);
  assert.equal(sequence.finalFen, sequence.fens.at(-1));
});

test('counts the solver moves in a raw Lichess sequence', () => {
  assert.equal(solutionMoveCount([]), 0);
  assert.equal(solutionMoveCount(['e2e4']), 0);
  /* setup + one solution move = a oneMove puzzle */
  assert.equal(solutionMoveCount(['b7b6', 'a1a8']), 1);
  assert.equal(solutionMoveCount(['b7b6', 'a1a8', 'g8g7', 'h1h8']), 2);
  assert.equal(solutionMoveCount(['b7b6', 'a1a8', 'g8g7', 'h1h8', 'g7g6', 'a8a7']), 3);
  /* Odd-length sequences (fixtures only) round up like replayUciSequence. */
  assert.equal(solutionMoveCount(['e2e4', 'e7e5', 'g1f3']), 1);
  assert.equal(solutionMoveCount(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5']), 2);
});

test('a known position replays to a known FEN', () => {
  const sequence = replayUciSequence('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [
    'e2e4',
    'e7e5',
  ]);
  assert.equal(sequence.solverColor, 'b');
  assert.equal(sequence.finalFen, 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2');
  assert.equal(isLegalUciSequence('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ['e2e4', 'e7e5']), true);
});

test('derives the solver colour from the FEN turn, as the real database does', async () => {
  const records = await fixtureRecords();

  for (const record of records) {
    const validation = validateLichessPuzzle(record);
    assert.equal(validation.ok, true);
    const fenTurn = record.fen.split(' ')[1] === 'b' ? 'b' : 'w';
    assert.equal(validation.sequence.solverColor, fenTurn === 'w' ? 'b' : 'w');
    /* Real Lichess sequences always end on the defender's reply. */
    assert.equal(record.moves.length % 2, 0, `${record.puzzle_id} has an odd move count`);
  }
});

test('an odd-length sequence still replays and yields ceil((n-1)/2) solutions', () => {
  const sequence = replayUciSequence(
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    ['e2e4', 'e7e5', 'g1f3'],
  );
  assert.equal(sequence.solverColor, 'b');
  assert.deepEqual(sequence.solutionMoves, ['e7e5']);
  assert.deepEqual(sequence.replyMoves, ['g1f3']);
});

test('maps DailyDate provenance into the stored row', async () => {
  const records = await fixtureRecords();
  const withDate = records.find((record) => record.daily_date);
  assert.ok(withDate);

  const stored = toStoredPuzzle(withDate);
  assert.equal(stored.daily_date, withDate.daily_date);
  assert.equal(toStoredPuzzle(records[0]).daily_date, undefined);
});

test('rejects an illegal solution move', async () => {
  const [record] = await fixtureRecords();
  const broken = { ...record, moves: [record.moves[0], 'a1a8'] };
  const validation = validateLichessPuzzle(broken);

  assert.equal(validation.ok, false);
  assert.match(validation.reason ?? '', /illegal|UCI/);
});

test('rejects a malformed FEN and a non-legal move list', async () => {
  const [record] = await fixtureRecords();
  assert.match(validateLichessPuzzle({ ...record, fen: 'not-a-fen' }).reason ?? '', /illegal FEN/);
  assert.throws(
    () =>
      replayUciSequence('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [
        'e2e4',
        'e7e5!!',
      ]),
    /not UCI/,
  );
  assert.match(validateLichessPuzzle({ ...record, moves: ['e2e4'] }).reason ?? '', /setup move/);
});

test('rejects out-of-range metadata and bad identifiers', async () => {
  const [record] = await fixtureRecords();

  assert.match(validateLichessPuzzle({ ...record, puzzle_id: 'toolongid' }).reason ?? '', /five alphanumerics/);
  assert.match(validateLichessPuzzle({ ...record, rating: 0 }).reason ?? '', /outside/);
  assert.match(validateLichessPuzzle({ ...record, rating_deviation: -1 }).reason ?? '', /rating deviation/);
  assert.match(validateLichessPuzzle({ ...record, popularity: 101 }).reason ?? '', /popularity/);
  assert.match(validateLichessPuzzle({ ...record, plays: -5 }).reason ?? '', /plays/);
  assert.match(validateLichessPuzzle({ ...record, themes: [] }).reason ?? '', /themes/);
  assert.match(validateLichessPuzzle({ ...record, game_url: 'lichess.org/x' }).reason ?? '', /URL/);
});

test('normalizes a record into the stored puzzle row', async () => {
  const [record] = await fixtureRecords();
  const stored = toStoredPuzzle(record);

  assert.equal(stored.puzzle_id, record.puzzle_id);
  assert.equal(stored.moves, record.moves.join(' '));
  /* Stored rows use the chess.com scale, so the Lichess figure is shifted once. */
  assert.equal(stored.rating, Math.round(toChessComRating(record.rating)));
  assert.equal(stored.rating_deviation, record.rating_deviation);
  assert.equal(stored.popularity, record.popularity);
  assert.equal(stored.plays, record.plays);
  assert.equal(stored.game_url, record.game_url);
  assert.equal(stored.source, 'lichess');
  assert.deepEqual(stored.themes, record.themes);
  assert.equal(typeof stored.imported_at, 'number');
});
