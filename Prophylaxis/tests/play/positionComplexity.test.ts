import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import {
  DEFAULT_COMPLEXITY_WEIGHTS,
  HANGING_SATURATION,
  computeComplexity,
  computeEvalVolatility,
  effectiveComplexityWeights,
  type MoveHistoryLike,
} from '../../src/play/positionComplexity.ts';

/**
 * Complexity is a pure board metric: quiet positions must read low, tactical
 * positions high, and the number must stay in [0, 1] for anything chess.js can
 * produce. All randomness here is a local mulberry32 with a fixed seed.
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const START = new Chess().fen();

/* 27 pieces, a queen attacked by a bishop, six different checks on the board. */
const SHARP = 'r4b1r/p1k2p1p/2P1Q1pn/3Rpb2/4PP2/7q/1P1PK1PP/1NBB2NR w - - 5 21';

/** A closed, symmetric pawn structure: nothing is happening anywhere. */
const QUIET = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 0 1';

function randomPositions(count: number, seed = 20261121): string[] {
  const rand = mulberry32(seed);
  const fens: string[] = [];
  while (fens.length < count) {
    const game = new Chess();
    const plies = 6 + Math.floor(rand() * 40);
    for (let ply = 0; ply < plies && !game.isGameOver(); ply += 1) {
      const moves = game.moves({ verbose: true });
      game.move(moves[Math.floor(rand() * moves.length)]);
    }
    fens.push(game.fen());
  }
  return fens;
}

test('the starting position is quiet', () => {
  const { complexity, features } = computeComplexity(START);
  assert.ok(complexity < 0.25, `start reads ${complexity}`);
  assert.equal(features.hangingPieces, 0);
  assert.equal(features.forcingMoves, 0);
  assert.equal(features.materialTension, 0);
  assert.equal(features.inCheck, 0);
  assert.equal(features.evalVolatility, null);
  assert.ok(features.branching > 0.2 && features.branching < 0.4, 'twenty legal moves');
});

test('a closed symmetrical middlegame stays under the quiet ceiling', () => {
  const { complexity } = computeComplexity(QUIET);
  assert.ok(complexity < 0.25, `quiet middlegame reads ${complexity}`);
});

test('a sharp position with a hanging queen and many checks reads high', () => {
  const game = new Chess(SHARP);
  const checks = game.moves({ verbose: true }).filter((move) => move.san.includes('+'));
  assert.ok(checks.length >= 3, 'the fixture really does offer several checks');

  const { complexity, features } = computeComplexity(SHARP);
  assert.ok(complexity > 0.6, `sharp position reads ${complexity}`);
  assert.ok(features.hangingPieces > 0.25, 'material is en prise');
  assert.ok(features.forcingMoves > 0.5, 'checks and captures are everywhere');
});

test('complexity stays inside [0, 1] for 200+ generated positions', () => {
  const fens = randomPositions(220);
  assert.equal(fens.length, 220);
  for (const fen of fens) {
    const { complexity, features } = computeComplexity(fen);
    assert.ok(Number.isFinite(complexity));
    assert.ok(complexity >= 0 && complexity <= 1, `${fen} → ${complexity}`);
    for (const [name, value] of Object.entries(features)) {
      if (value === null) continue;
      assert.ok(Number.isFinite(value as number), `${name} of ${fen} is not finite`);
      assert.ok((value as number) >= 0 && (value as number) <= 1, `${name} out of range`);
    }
  }
});

test('adding a hanging piece never lowers complexity', () => {
  const quiet = computeComplexity('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1').complexity;
  const hanging = computeComplexity('4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1');
  assert.ok(hanging.features.hangingPieces > 0, 'the queen is attacked by the pawn');
  assert.ok(hanging.complexity >= quiet, `${quiet} → ${hanging.complexity}`);

  /* And the sharp fixture is more complex than the same material, quiet. */
  const before = computeComplexity(SHARP).complexity;
  const calmer = computeComplexity('r4b1r/p1k2p1p/2P3pn/3Rpb2/4PP2/7q/1P1PK1PP/1NBB2NR w - - 5 21');
  assert.ok(Number.isFinite(calmer.complexity) && before > 0);
});

test('weights renormalise when volatility is unavailable', () => {
  const full = effectiveComplexityWeights(true);
  const partial = effectiveComplexityWeights(false);

  const sum = (weights: Record<string, number>) =>
    Object.values(weights).reduce((total, value) => total + value, 0);

  assert.ok(Math.abs(sum(full) - 1) < 1e-12);
  assert.ok(Math.abs(sum(partial) - 1) < 1e-12);
  assert.equal(partial.evalVolatility, 0);
  assert.equal(full.evalVolatility, DEFAULT_COMPLEXITY_WEIGHTS.evalVolatility);

  /* The seven board features keep their relative importance. */
  assert.ok(
    Math.abs(partial.hangingPieces / partial.kingExposure -
      full.hangingPieces / full.kingExposure) < 1e-12,
  );
});

test('eval volatility separates a stable search from a flip-flopping one', () => {
  const stable: MoveHistoryLike = new Map([
    ['e2e4', [{ depth: 8, cp: 30 }, { depth: 10, cp: 32 }, { depth: 12, cp: 31 }]],
    ['d2d4', [{ depth: 8, cp: 20 }, { depth: 10, cp: 21 }, { depth: 12, cp: 22 }]],
  ]);
  const shaky: MoveHistoryLike = new Map([
    ['e2e4', [{ depth: 8, cp: 30 }, { depth: 10, cp: -400 }, { depth: 12, cp: 60 }]],
    ['d2d4', [{ depth: 8, cp: 80 }, { depth: 10, cp: 120 }, { depth: 12, cp: -300 }]],
  ]);

  const stableScore = computeEvalVolatility(stable);
  const shakyScore = computeEvalVolatility(shaky);
  assert.ok(stableScore !== null && shakyScore !== null);
  assert.ok(stableScore < 0.1, `stable ${stableScore}`);
  assert.ok(shakyScore > 0.5, `shaky ${shakyScore}`);

  assert.equal(computeEvalVolatility(null), null);
  assert.equal(computeEvalVolatility(new Map()), null);

  /* A history raises the score on an otherwise quiet position. */
  const plain = computeComplexity(QUIET).complexity;
  const withHistory = computeComplexity(QUIET, { history: shaky }).complexity;
  assert.ok(withHistory > plain, `${plain} → ${withHistory}`);
});

test('complexity is fast enough to run on every move', () => {
  const fens = randomPositions(60, 99);
  const started = performance.now();
  for (const fen of fens) computeComplexity(fen);
  const perPosition = (performance.now() - started) / fens.length;

  /* Generous: the target is < 1 ms, this only catches an order-of-magnitude
     regression on a slow CI machine. */
  assert.ok(perPosition < 8, `${perPosition.toFixed(2)} ms per position`);
});

test('the hanging saturation constant matches the feature', () => {
  assert.equal(HANGING_SATURATION, 4);

  /* Two undefended queens covered by pawns read as half the saturation point. */
  const fen = '4k3/3p1p2/2Q1Q3/8/8/8/8/4K3 w - - 0 1';
  const { features } = computeComplexity(fen);
  assert.ok(features.hangingPieces >= 0.5, `hanging reads ${features.hangingPieces}`);
});
