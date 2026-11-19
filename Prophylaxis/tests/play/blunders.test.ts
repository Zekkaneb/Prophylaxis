import assert from 'node:assert/strict';
import test from 'node:test';
import { Chess } from 'chess.js';
import {
  chooseRandomLegalMove,
  guardsAgainstPieceBlunders,
  isBlatantMaterialBlunder,
} from '../../src/play/blunders.ts';
import { chooseCandidate } from '../../src/play/strength.ts';

/* White queen on d1 faces a Black rook on d8 with the file open. Qd3?? simply
   loses the queen to Rxd3; Qd8+ wins the rook instead. */
const QUEEN_FEN = '3r2k1/8/8/8/8/8/8/3QK3 w - - 0 1';

test('recognises a free piece but not a real capture', () => {
  assert.equal(isBlatantMaterialBlunder(QUEEN_FEN, 'd1d3'), true);
  assert.equal(isBlatantMaterialBlunder(QUEEN_FEN, 'd1d8'), false);
  assert.equal(isBlatantMaterialBlunder(QUEEN_FEN, 'not-a-move'), false);
});

test('the guard covers the developing bots, not the top boards', () => {
  assert.equal(guardsAgainstPieceBlunders(1250), true);
  assert.equal(guardsAgainstPieceBlunders(1550), true);
  assert.equal(guardsAgainstPieceBlunders(1799), true);
  assert.equal(guardsAgainstPieceBlunders(1800), false);
  assert.equal(guardsAgainstPieceBlunders(2350), false);
});

test('random legal moves stop hanging a piece for lower-rated bots', () => {
  const game = new Chess(QUEEN_FEN);
  for (let index = 0; index < 40; index += 1) {
    const uci = chooseRandomLegalMove(game, 1550, () => 0);
    assert.ok(uci);
    assert.equal(isBlatantMaterialBlunder(QUEEN_FEN, uci), false);
    assert.doesNotThrow(() => new Chess(QUEEN_FEN).move(uci));
  }

  /* A strong bot keeps the original random weakness. */
  const strongPick = chooseRandomLegalMove(game, 2350, () => 0);
  assert.ok(strongPick);
  assert.doesNotThrow(() => new Chess(QUEEN_FEN).move(strongPick));
});

test('candidate selection drops a free-piece runner-up at low Elo', () => {
  const candidates = ['d1d3', 'd1d8'];
  assert.equal(chooseCandidate(candidates, 1250, () => 0, QUEEN_FEN), 'd1d8');
  assert.equal(chooseCandidate(candidates, 800, () => 0.99, QUEEN_FEN), 'd1d8');
  assert.equal(chooseCandidate(candidates, 2200, () => 0.99, QUEEN_FEN), 'd1d3');
});
