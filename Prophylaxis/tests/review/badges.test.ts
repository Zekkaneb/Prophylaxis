/**
 * Special-badge pipeline, end to end.
 *
 * `classifyMove` is exercised on its own above; this file runs a whole review
 * through `analyzeGame` with a scripted evaluator so the *counters* are proven
 * to increment — a badge that classifies correctly but never reaches the
 * scorecard would look identical to one that is switched off.
 *
 * The scripted game is a real (legal) miniature with an invented evaluation
 * story: a bishop sacrifice on f7, a dead-lost position rescued by the only
 * move, and a winning game thrown away with a quiet pawn move.
 */

import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Chess } from 'chess.js';
import { MOVE_CLASSIFICATION_ORDER } from '../../src/config/moveClassifications.ts';
import type { EngineEvaluation } from '../../src/engine/useStockfish.ts';
import {
  analyzeGame,
  classifyMove,
  cpToWinPercent,
  parsePgn,
  summarizeReview,
} from '../../src/review/gameReviewService.ts';

const SAN = [
  'e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'Bxf7+', 'Kxf7',
  'Nxe5+', 'Nxe5', 'd4', 'Bb6', 'dxe5', 'Qe7', 'O-O', 'Qxe5',
  'Re1', 'Qd4', 'Qxd4', 'Bxd4', 'Nd2', 'Nf6', 'c3', 'Bb6',
];

const PGN = `[Event "Badge harness"]
[Site "local"]
[White "Harness White"]
[Black "Harness Black"]
[Result "*"]

${SAN.map((san, index) => {
  const number = Math.floor(index / 2) + 1;
  return index % 2 === 0 ? `${number}. ${san}` : san;
}).join(' ')}
*`;

/**
 * White-POV scores for every position: index 0 is the start, index i is the
 * position after i plies. The story they tell:
 *
 *   ply 6  4.Bxf7+ — a sound sacrifice worth 1.0 points of win probability
 *   ply 16 9.Re1   — dead lost (13.8%), the only move recovers (61.9%)
 *   ply 22 12.c3   — a won game (97%) thrown to 2.9% with a quiet move
 */
const SCORES = [
  20, 25, 20, 30, 25, 30,
  220, 240, 200, 210, 150, 160,
  140, 130, 120, 110, -700, 180,
  170, 160, 150, 140, 900, -900,
  -880,
];

/** Runner-up score, White POV, at selected positions. */
const SECOND = new Map<number, number>([
  [6, 200], // 1.9 points behind: not a unique move, so the sacrifice must be Brilliant
  [16, -250], // 17.4% for the alternative: the save really was the only resource
  [22, -880], // nothing better was missed, so this cannot be rescued as Great
]);

function scriptedEvaluations(): Map<string, EngineEvaluation> {
  const board = new Chess();
  const fens = [board.fen()];
  const played: string[] = [];
  for (const san of SAN) {
    const move = board.move(san);
    played.push(`${move.from}${move.to}${move.promotion ?? ''}`);
    fens.push(board.fen());
  }
  assert.equal(fens.length, SCORES.length);

  const byFen = new Map<string, EngineEvaluation>();
  fens.forEach((fen, index) => {
    const scoreCp = SCORES[index];
    const second = SECOND.get(index) ?? scoreCp;
    const uci = played[index] ?? played[played.length - 1];
    byFen.set(fen, {
      fen,
      depth: 16,
      bestMove: uci,
      /* Non-null: `classifyMove` only reads `secondScoreCp` when a runner-up
         line exists, so a null here silently zeroes every uniqueness gap. */
      secondBestMove: 'a7a6',
      ponder: null,
      pv: [uci],
      scoreCp,
      mate: null,
      secondScoreCp: second,
      secondMate: null,
      shallowScoreCp: scoreCp,
      shallowMate: null,
      candidates: [{ rank: 1, uci, scoreCp, mate: null, pv: [uci] }],
    });
  });
  return byFen;
}

async function runHarness() {
  const parsed = parsePgn(PGN);
  const byFen = scriptedEvaluations();
  const evaluated: string[] = [];
  const result = await analyzeGame(parsed, async (fen) => {
    evaluated.push(fen);
    const evaluation = byFen.get(fen);
    if (!evaluation) throw new Error(`no scripted evaluation for ${fen}`);
    return evaluation;
  });
  return { parsed, result, evaluated };
}

test('the review pipeline produces Clutch and Throw counters, not zeros', async () => {
  const { parsed, result } = await runHarness();
  const { summary } = result;

  assert.equal(parsed.moves.length, 24);

  /* White sacrificed on f7, saved a lost game and then threw a won one.
     Both 4.Bxf7+ and 5.Nxe5+ are sound sacrifices in this scripted line (a
     bishop for a pawn, a knight for a pawn), so the Brilliant counter is 2. */
  assert.equal(summary.whiteCounts.brilliant, 2, 'both sound sacrifices count');
  assert.equal(summary.whiteCounts.clutch, 1, 'the only saving move is Clutch');
  assert.equal(summary.whiteCounts.throw, 1, 'the quiet pawn move is a Throw');

  const labels = result.review.evaluations.map((entry) => entry.classification);
  assert.equal(labels[6], 'brilliant', '4.Bxf7+');
  assert.equal(labels[8], 'brilliant', '5.Nxe5+');
  assert.equal(labels[16], 'clutch', '9.Re1');
  assert.equal(labels[22], 'throw', '12.c3');

  /* The stored data carries the badges, not just the summary. */
  const clutchPly = result.review.evaluations[16];
  assert.equal(clutchPly.san, 'Re1');
  assert.ok(clutchPly.accuracy === 100, 'Clutch is a 100% move in the accuracy model');
  const throwPly = result.review.evaluations[22];
  assert.equal(throwPly.accuracy, 0, 'Throw is a 0% move in the accuracy model');
});

test('every classification reaches the scorecard and the sums add up', async () => {
  const { parsed, result } = await runHarness();
  const { summary } = result;

  for (const counts of [summary.whiteCounts, summary.blackCounts]) {
    assert.deepEqual(
      Object.keys(counts).sort(),
      [...MOVE_CLASSIFICATION_ORDER].sort(),
      'the counter object carries exactly the 13 vocabulary keys',
    );
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    assert.equal(total, parsed.moves.length / 2, 'every ply is counted once per colour');
  }

  /* A stored review re-summarises to the same numbers — the dashboard path. */
  const recomputed = summarizeReview(result.review);
  assert.deepEqual(recomputed.whiteCounts, summary.whiteCounts);
  assert.deepEqual(recomputed.blackCounts, summary.blackCounts);
  assert.equal(recomputed.whiteAccuracy, summary.whiteAccuracy);
  assert.equal(recomputed.blackAccuracy, summary.blackAccuracy);
});

test('the stored labels survive the saved-review round trip', async () => {
  const { result } = await runHarness();
  const stored = await (await import('../../src/db.ts')).db.saved_reviews.get(result.review.game_id);
  assert.ok(stored, 'the review was persisted');
  assert.equal(stored.evaluations.length, result.review.evaluations.length);
  assert.ok(stored.evaluations.some((entry) => entry.classification === 'clutch'));
  assert.ok(stored.evaluations.some((entry) => entry.classification === 'throw'));
});

/* ------------------------- thresholds, stated directly -------------------- */

function evaluation(fen: string, scoreCp: number, best: string, second: number): EngineEvaluation {
  return {
    fen,
    depth: 16,
    bestMove: best,
    secondBestMove: 'a7a6',
    ponder: null,
    pv: [best],
    scoreCp,
    mate: null,
    secondScoreCp: second,
    secondMate: null,
    shallowScoreCp: scoreCp,
    shallowMate: null,
    candidates: [{ rank: 1, uci: best, scoreCp, mate: null, pv: [best] }],
  };
}

test('Clutch needs a lost position, the top move, and no alternative', () => {
  const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const after = 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1';

  const clutch = classifyMove({
    color: 'w',
    uci: 'd2d4',
    fenBefore: fen,
    fenAfter: after,
    before: evaluation(fen, -700, 'd2d4', -250),
    after: evaluation(after, 150, 'g8f6', 0),
    previous: null,
  });
  assert.equal(clutch.classification, 'clutch');
  assert.ok(clutch.winBefore <= 20);
  assert.ok(clutch.winAfter >= 45);
  assert.ok(clutch.secondBestWinGap >= 25);

  /* Same save, but the runner-up is nearly as good: not the only move. */
  const shared = classifyMove({
    color: 'w',
    uci: 'd2d4',
    fenBefore: fen,
    fenAfter: after,
    before: evaluation(fen, -700, 'd2d4', 100),
    after: evaluation(after, 150, 'g8f6', 0),
    previous: null,
  });
  assert.notEqual(shared.classification, 'clutch');

  /* Same shape from a healthy position: a good move, never Clutch. */
  const healthy = classifyMove({
    color: 'w',
    uci: 'd2d4',
    fenBefore: fen,
    fenAfter: after,
    before: evaluation(fen, 200, 'd2d4', -300),
    after: evaluation(after, 400, 'g8f6', 0),
    previous: null,
  });
  assert.notEqual(healthy.classification, 'clutch');

  /* And the inverse: lost position, but the played move is not the top one. */
  const notBest = classifyMove({
    color: 'w',
    uci: 'd2d4',
    fenBefore: fen,
    fenAfter: after,
    before: evaluation(fen, -700, 'e2e4', -250),
    after: evaluation(after, 150, 'g8f6', 0),
    previous: null,
  });
  assert.notEqual(notBest.classification, 'clutch');
});

test('Throw needs a won game, a collapse, and a lost position after it', () => {
  const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const after = 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1';
  const base = {
    color: 'w' as const,
    uci: 'd2d4',
    fenBefore: fen,
    fenAfter: after,
    previous: null,
  };

  const thrown = classifyMove({
    ...base,
    before: evaluation(fen, 900, 'd2d4', 900),
    after: evaluation(after, -900, 'g8f6', -880),
  });
  assert.equal(thrown.classification, 'throw');
  assert.ok(thrown.winBefore >= 60);
  assert.ok(thrown.winDrop >= 45);
  assert.ok(thrown.winAfter <= 15);

  /* The same collapse from an equal game is a Blunder, not a Throw. */
  const fromEqual = classifyMove({
    ...base,
    before: evaluation(fen, 0, 'd2d4', 0),
    after: evaluation(after, -900, 'g8f6', -880),
  });
  assert.equal(fromEqual.classification, 'blunder');

  /* A won game that merely slips is neither: it is graded on the plain band. */
  const slipped = classifyMove({
    ...base,
    before: evaluation(fen, 900, 'd2d4', 900),
    after: evaluation(after, 400, 'g8f6', 380),
  });
  assert.notEqual(slipped.classification, 'throw');
});

test('win probability is monotone, so the badge thresholds mean what they say', () => {
  const values = [-900, -700, -250, 0, 150, 400, 900].map((cp) => cpToWinPercent(cp));
  for (let index = 1; index < values.length; index += 1) {
    assert.ok(values[index] > values[index - 1], 'higher score, higher win probability');
  }
  assert.ok(cpToWinPercent(-700) < 20);
  assert.ok(cpToWinPercent(-900) < 5);
  assert.ok(cpToWinPercent(150) > 45);
  assert.ok(cpToWinPercent(900) > 95);
});
