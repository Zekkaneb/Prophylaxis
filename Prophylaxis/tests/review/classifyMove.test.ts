/**
 * Move classification: the #1-engine-move gate.
 *
 * `Best` is an identity claim — the played move has to be the engine's own
 * first line — not a proximity claim. These tests pin that gate and the bands
 * under it: a second-line move that gives up a fifth of a percent of win
 * probability is still an Excellent, only the first line can be Best, Great or
 * Brilliant, and Forced still wins over everything.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyMove,
  cpToWinPercent,
  type ClassificationInput,
} from '../../src/review/gameReviewService.ts';

/** The evaluation shape `classifyMove` reads, without importing the React hook. */
type Evaluation = ClassificationInput['before'];

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_D4 = 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

function evaluation(overrides: Partial<Evaluation> & Pick<Evaluation, 'fen'>): Evaluation {
  return {
    fen: overrides.fen,
    depth: 18,
    bestMove: null,
    secondBestMove: null,
    ponder: null,
    pv: [],
    scoreCp: 0,
    mate: null,
    secondScoreCp: 0,
    secondMate: null,
    shallowScoreCp: overrides.scoreCp ?? 0,
    shallowMate: null,
    candidates: [],
    ...overrides,
  };
}

function line(rank: number, uci: string, scoreCp: number) {
  return { rank, uci, scoreCp, mate: null, pv: [uci] };
}

function classify(
  uci: string,
  fenBefore: string,
  fenAfter: string,
  before: Evaluation,
  after: Evaluation,
) {
  return classifyMove({
    color: 'w',
    uci,
    fenBefore,
    fenAfter,
    before,
    after,
    previous: null,
  });
}

test('the engine’s first choice is Best', () => {
  const before = evaluation({
    fen: START,
    scoreCp: 100,
    bestMove: 'd2d4',
    candidates: [line(1, 'd2d4', 100)],
  });
  const after = evaluation({ fen: AFTER_D4, scoreCp: 98, bestMove: 'e7e5' });

  const result = classify('d2d4', START, AFTER_D4, before, after);
  assert.equal(result.classification, 'best');
});

test('a 0.2% drop that is not the top move is Excellent, never Best', () => {
  // d4 is PV1; e4 gives up a fifth of a percent of win probability.
  const before = evaluation({
    fen: START,
    scoreCp: 100,
    bestMove: 'd2d4',
    candidates: [line(1, 'd2d4', 100), line(2, 'e2e4', 99)],
  });
  const after = evaluation({ fen: AFTER_E4, scoreCp: 98, bestMove: 'e7e5' });

  const result = classify('e2e4', START, AFTER_E4, before, after);
  assert.ok(
    result.winDrop > 0.1 && result.winDrop < 0.3,
    `expected a ~0.2% win drop, got ${result.winDrop}`,
  );
  assert.equal(result.classification, 'excellent');
});

test('the same idea at 3% is Good', () => {
  const before = evaluation({
    fen: START,
    scoreCp: 100,
    bestMove: 'd2d4',
    candidates: [line(1, 'd2d4', 100)],
  });
  const after = evaluation({ fen: AFTER_E4, scoreCp: 60 });

  const result = classify('e2e4', START, AFTER_E4, before, after);
  assert.ok(result.winDrop >= 2 && result.winDrop < 5, `winDrop ${result.winDrop}`);
  assert.equal(result.classification, 'good');
});

test('a top move the runner-up cannot match is Great', () => {
  const before = evaluation({
    fen: START,
    scoreCp: 100,
    bestMove: 'd2d4',
    secondBestMove: 'c7c5',
    secondScoreCp: -100,
    candidates: [line(1, 'd2d4', 100), line(2, 'c7c5', -100)],
  });
  const after = evaluation({ fen: AFTER_D4, scoreCp: 98 });

  const result = classify('d2d4', START, AFTER_D4, before, after);
  assert.ok(result.secondBestWinGap >= 10, `gap ${result.secondBestWinGap}`);
  assert.equal(result.classification, 'great');
});

test('a #2 move is never Great, however far behind the runner-up is', () => {
  const before = evaluation({
    fen: START,
    scoreCp: 100,
    bestMove: 'd2d4',
    secondBestMove: 'c7c5',
    secondScoreCp: -100,
    candidates: [line(1, 'd2d4', 100), line(2, 'c7c5', -100)],
  });
  const after = evaluation({ fen: AFTER_E4, scoreCp: 98 });

  const result = classify('e2e4', START, AFTER_E4, before, after);
  assert.equal(result.classification, 'excellent');
});

test('a sound top-move sacrifice is still Brilliant', () => {
  // Qxd5 walks into cxd5: the engine's first choice, and still fine for White.
  const beforeFen = '4k3/8/2p5/3p4/8/8/8/3QK3 w - - 0 1';
  const afterFen = '4k3/8/2p5/3Q4/8/8/8/4K3 b - - 0 1';
  const before = evaluation({
    fen: beforeFen,
    scoreCp: 60,
    bestMove: 'd1d5',
    candidates: [line(1, 'd1d5', 60)],
  });
  const after = evaluation({ fen: afterFen, scoreCp: 60 });

  const result = classify('d1d5', beforeFen, afterFen, before, after);
  assert.equal(result.classification, 'brilliant');
});

test('a single legal move is Forced whatever the engine thinks', () => {
  const beforeFen = '7k/8/8/8/8/8/6R1/6K1 b - - 0 1';
  const afterFen = '8/7k/8/8/8/8/6R1/6K1 w - - 1 2';
  const before = evaluation({
    fen: beforeFen,
    scoreCp: -400,
    bestMove: 'h8h7',
    candidates: [line(1, 'h8h7', -400)],
  });
  const after = evaluation({ fen: afterFen, scoreCp: -420 });

  const result = classifyMove({
    color: 'b',
    uci: 'h8h7',
    fenBefore: beforeFen,
    fenAfter: afterFen,
    before,
    after,
    previous: null,
  });
  assert.equal(result.classification, 'forced');
});

test('the win-percent curve still separates the bands', () => {
  // Guards the numbers the gate sits on: 2 points of win probability is the
  // Excellent/Good boundary.
  assert.ok(cpToWinPercent(100) - cpToWinPercent(98) < 2);
  assert.ok(cpToWinPercent(100) - cpToWinPercent(0) > 5);
});
