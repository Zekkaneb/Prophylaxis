import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import {
  DEFAULT_PRIOR_WEIGHTS,
  PRIOR_TOTAL_CLAMP,
  explainPrior,
  makePrior,
  priorStrength,
  type PriorContext,
} from '../../src/play/humanPrior.ts';

/**
 * The prior's job is to make the *plausible* move list human: grabs, take-backs,
 * development and centre pawns first; pointless rook pawns, early queens and
 * hanging pieces last. All randomness is a seeded local mulberry32.
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

function position(...sans: string[]): Chess {
  const game = new Chess();
  for (const san of sans) game.move(san);
  return game;
}

const OPENING: PriorContext = { elo: 1200, moveNumber: 1 };

function explainSum(entries: Record<string, number>): number {
  return Object.values(entries).reduce((total, value) => total + value, 0);
}

test('development and centre pawns outrank rook pawns', () => {
  const start = new Chess();
  const prior = makePrior(start, OPENING);

  const good = [prior('e2e4'), prior('d2d4'), prior('g1f3')];
  const poor = [prior('a2a3'), prior('h2h3')];

  for (const value of good) assert.ok(value > 0, 'a developing move is a positive pull');
  for (const value of poor) assert.ok(value < 0, 'a rook-pawn push is a negative pull');
  assert.ok(Math.min(...good) > Math.max(...poor));

  /* An early queen sortie is negative too: after 1.e4 e5 White can play Qh5. */
  const afterE4 = position('e4', 'e5');
  assert.ok(afterE4.moves().includes('Qh5'), 'the fixture allows the sortie');
  const queenPrior = makePrior(afterE4, { elo: 1200, moveNumber: 2 });
  assert.ok(queenPrior('d1h5') < 0, 'early queen');
  assert.ok(queenPrior('d1h5') < queenPrior('g1f3'));
});

test('a recapture outranks an unrelated developing move', () => {
  /* Black's queen just took on d5 and the c3 knight can take it back. */
  const game = new Chess('rnb1kbnr/ppp1pppp/8/3q4/8/2N5/PPPP1PPP/R1BQKBNR w KQkq - 0 3');
  const prior = makePrior(game, { elo: 1200, lastMove: 'd8d5', moveNumber: 3 });

  const recapture = prior('c3d5');
  const develop = prior('g1f3');
  assert.ok(recapture > develop, `${recapture} vs ${develop}`);

  const detail = explainPrior(game, { elo: 1200, lastMove: 'd8d5', moveNumber: 3 }, 'c3d5');
  assert.equal(detail.recapture, DEFAULT_PRIOR_WEIGHTS.recapture);
  assert.ok(detail.capture > 0);
  assert.ok(detail.captureGain > 0, 'a queen taken by a knight wins material');
});

test('hanging a knight to a pawn is penalised versus a safe developing move', () => {
  /* White knight on c3 can jump to d5, which the c6 pawn covers, undefended. */
  const fen = 'rnbqkbnr/pp1ppppp/2p5/8/8/2N5/PPPPPPPP/R1BQKBNR w KQkq - 0 3';
  const game = new Chess(fen);
  const ctx: PriorContext = { elo: 1200, moveNumber: 3 };
  const prior = makePrior(game, ctx);

  const hanging = prior('c3d5');
  const safe = prior('g1f3');
  assert.ok(hanging < safe, `${hanging} vs ${safe}`);
  assert.ok((explainPrior(game, ctx, 'c3d5').looksHanging ?? 0) < 0);
});

test('escaping an attack is a positive contribution', () => {
  /* Knight on c3 attacked by the b4 pawn; every knight move that leaves is an
     escape, and the prior says so explicitly. */
  const fen = 'rnbqkbnr/2pppppp/p7/8/1p6/2N5/PPPPPPPP/R1BQKBNR w KQkq - 0 4';
  const game = new Chess(fen);
  const ctx: PriorContext = { elo: 1200, moveNumber: 4 };
  const detail = explainPrior(game, ctx, 'c3d5');
  assert.ok((detail.escape ?? 0) > 0, 'the knight is stepping out of a pawn attack');
  assert.equal(detail.escape, DEFAULT_PRIOR_WEIGHTS.escape);
});

test('priorStrength is monotone, bounded and leans hardest on beginners', () => {
  let previous = Infinity;
  for (let elo = 100; elo <= 2800; elo += 50) {
    const value = priorStrength(elo);
    assert.ok(value >= 0.4 && value <= 1.4, `${elo} → ${value}`);
    assert.ok(value <= previous + 1e-12, `not monotone at ${elo}`);
    previous = value;
  }
  assert.ok(priorStrength(400) > 1.3, 'beginners lean on habits');
  assert.ok(priorStrength(2200) < 0.55, 'strong players do not');
  assert.ok(priorStrength(400) > priorStrength(1200));
  assert.ok(priorStrength(2800) >= 0.4);
  /* Non-finite input must not leak NaN into the selector. */
  assert.ok(Number.isFinite(priorStrength(Number.NaN)));
});

test('the total is clamped and explainPrior sums to it exactly', () => {
  const start = new Chess();
  const prior = makePrior(start, OPENING);
  const total = prior('e2e4') / priorStrength(OPENING.elo);
  const detail = explainPrior(start, OPENING, 'e2e4');
  assert.ok(Math.abs(explainSum(detail) - total) < 1e-9);

  /* Force the clamp: a capture + recapture on one move. */
  const game = new Chess('rnb1kbnr/ppp1pppp/8/3q4/8/2N5/PPPP1PPP/R1BQKBNR w KQkq - 0 3');
  const ctx: PriorContext = { elo: 400, lastMove: 'd8d5', moveNumber: 3 };
  const scaled = makePrior(game, ctx)('c3d5');
  const unscaled = scaled / priorStrength(400);
  assert.ok(Math.abs(unscaled) <= PRIOR_TOTAL_CLAMP + 1e-9);
  assert.ok(Math.abs(explainSum(explainPrior(game, ctx, 'c3d5')) - unscaled) < 1e-9);
});

test('every legal move of 200+ generated positions gets a finite clamped prior', () => {
  const rand = mulberry32(4242);
  let checkedMoves = 0;

  for (let index = 0; index < 210; index += 1) {
    const game = new Chess();
    const plies = 2 + Math.floor(rand() * 50);
    for (let ply = 0; ply < plies && !game.isGameOver(); ply += 1) {
      const moves = game.moves({ verbose: true });
      game.move(moves[Math.floor(rand() * moves.length)]);
    }
    if (game.isGameOver()) continue;

    const moveNumber = Math.floor(game.history().length / 2) + 1;
    const ctx: PriorContext = {
      elo: 100 + Math.floor(rand() * 2700),
      moveNumber,
      ...(game.history().length > 0 ? { lastMove: game.history({ verbose: true }).at(-1)?.lan } : {}),
    };
    const prior = makePrior(game, ctx);
    const strength = priorStrength(ctx.elo);

    for (const move of game.moves({ verbose: true })) {
      const uci = `${move.from}${move.to}${move.promotion ?? ''}`;
      const value = prior(uci);
      assert.ok(Number.isFinite(value), `${uci} at ${game.fen()} is not finite`);
      assert.ok(
        Math.abs(value) <= PRIOR_TOTAL_CLAMP * strength + 1e-9,
        `${uci} → ${value} exceeds the clamp`,
      );

      const entries = explainPrior(game, ctx, uci);
      assert.ok(Math.abs(explainSum(entries) - value / strength) < 1e-9);
      checkedMoves += 1;
    }
  }

  assert.ok(checkedMoves > 1000, `only ${checkedMoves} moves were checked`);
});

test('castling, en passant, promotion and single-move positions never throw', () => {
  /* Castling both ways, with plenty of history behind the clock. */
  const castle = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const castlePrior = makePrior(castle, { elo: 900, moveNumber: 8 });
  assert.ok(Number.isFinite(castlePrior('e1g1')));
  assert.ok(castlePrior('e1g1') > castlePrior('e1e2'), 'castling beats walking the king');

  /* En passant: the capture is on an empty square. */
  const ep = new Chess('rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
  const epPrior = makePrior(ep, { elo: 900, moveNumber: 3 });
  assert.ok(Number.isFinite(epPrior('d4e3')));
  assert.ok(epPrior('d4e3') > 0, 'the en passant capture is a capture');

  /* Promotion, queen and under-promotion. */
  const promo = new Chess('8/P6k/8/8/8/8/6K1/8 w - - 0 1');
  const promoPrior = makePrior(promo, { elo: 900, moveNumber: 1 });
  assert.ok(promoPrior('a7a8q') > promoPrior('a7a8n'), 'queening beats under-promoting');

  /* A single legal move (black king in the corner, one square). */
  const forced = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  const forcedMoves = forced.moves({ verbose: true });
  if (forcedMoves.length === 1) {
    const forcedPrior = makePrior(forced, { elo: 900, moveNumber: 1 });
    assert.ok(Number.isFinite(forcedPrior(`${forcedMoves[0].from}${forcedMoves[0].to}`)));
  }

  /* Unknown and illegal moves are 0 rather than a throw. */
  assert.equal(makePrior(new Chess(), OPENING)('e2e5'), 0);
  assert.deepEqual(explainPrior(new Chess(), OPENING, 'zzzz'), {});
});

test('the prior is deterministic', () => {
  const game = position('e4', 'e5', 'Nf3');
  const ctx: PriorContext = { elo: 1400, lastMove: 'e7e5', moveNumber: 2 };
  const first = makePrior(game, ctx);
  const second = makePrior(game, ctx);
  for (const move of game.moves({ verbose: true })) {
    const uci = `${move.from}${move.to}${move.promotion ?? ''}`;
    assert.equal(first(uci), second(uci));
  }
});
