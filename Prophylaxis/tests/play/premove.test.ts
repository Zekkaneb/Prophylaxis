/**
 * Premove rules: selection, promotion, re-validation against the real position
 * and the clock/increment behaviour of the normal commit path it executes in.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { Chess } from 'chess.js';
import {
  DEFAULT_PROMOTION,
  MAX_PREMOVES,
  describePremoveQueue,
  enqueuePremove,
  isPremovable,
  needsPromotion,
  premoveQueueFen,
  premoveTargets,
  resolvePremove,
  resolvePremoveQueue,
  samePremove,
} from '../../src/play/premove.ts';
import { ChessClock } from '../../src/play/clock.ts';

const START = new Chess().fen();

/** Position after the listed SAN moves, plus whose turn it is. */
function position(sans: string[]): { fen: string; turn: 'w' | 'b' } {
  const game = new Chess();
  for (const san of sans) game.move(san);
  return { fen: game.fen(), turn: game.turn() as 'w' | 'b' };
}

test('a piece can only premove to squares it could reach', () => {
  assert.ok(isPremovable(START, 'e2', 'e4', 'w'));
  assert.ok(isPremovable(START, 'g1', 'f3', 'w'));
  assert.equal(isPremovable(START, 'e2', 'e5', 'w'), false);
  assert.equal(isPremovable(START, 'e2', 'e4', 'b'), false);
  assert.equal(isPremovable(START, 'e7', 'e5', 'w'), false);
});

test('targets stop at pieces and include castling', () => {
  const targets = premoveTargets(START, 'b1', 'w');
  assert.deepEqual(targets.sort(), ['a3', 'c3']);

  const castlingFen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  assert.ok(premoveTargets(castlingFen, 'e1', 'w').includes('g1'));
  assert.ok(premoveTargets(castlingFen, 'e1', 'w').includes('c1'));
});

test('premove targets depend on the piece, not on the enemy pieces', () => {
  /* A pawn may premove a capture onto an empty square: this is how a recapture
     is queued before the opponent has taken. */
  assert.ok(premoveTargets(START, 'e2', 'w').includes('d3'));
  assert.ok(premoveTargets(START, 'e2', 'w').includes('f3'));
  assert.ok(isPremovable(START, 'e2', 'd3', 'w'));

  /* A pinned piece can be premoved: the pin is checked when it executes, not
     when the intention is queued. */
  const pinned = '4r2k/8/8/8/8/8/4N3/4K3 w - - 0 1';
  assert.equal(isPremovable(pinned, 'e2', 'c3', 'w'), true);
  assert.equal(
    resolvePremove({ fen: pinned, premove: { from: 'e2', to: 'c3' }, playerColor: 'w', turn: 'w', status: 'playing' }),
    null,
  );

  /* Our own pieces still block, and the enemy king is never a target. */
  const blocked = '4k3/8/8/8/8/8/P7/R3K3 w - - 0 1';
  assert.equal(premoveTargets(blocked, 'a1', 'w').includes('a2'), false);
  assert.ok(premoveTargets(blocked, 'a1', 'w').includes('b1'));
  assert.equal(premoveTargets(START, 'e2', 'w').includes('e8'), false);
});

test('pawn moves to the last rank need a promotion choice', () => {
  const fen = '8/4P3/8/8/8/8/8/K6k w - - 0 1';
  assert.equal(needsPromotion(fen, 'e7', 'e8', 'w'), true);
  assert.equal(needsPromotion(START, 'e2', 'e4', 'w'), false);
  assert.equal(needsPromotion(fen, 'e7', 'e8', 'b'), false);
});

test('a legal premove resolves once the opponent has moved', () => {
  const { fen, turn } = position(['e4', 'e5']);
  const resolved = resolvePremove({
    fen,
    premove: { from: 'g1', to: 'f3' },
    playerColor: 'w',
    turn,
    status: 'playing',
  });
  assert.deepEqual(resolved, { from: 'g1', to: 'f3' });
});

test('capturing premoves resolve when the target is still there', () => {
  const rookFen = 'r3k3/8/8/8/8/8/8/R3K3 w - - 0 1';
  const kingCapture = resolvePremove({
    fen: rookFen,
    premove: { from: 'a1', to: 'a7' },
    playerColor: 'w',
    turn: 'w',
    status: 'playing',
  });
  assert.deepEqual(kingCapture, { from: 'a1', to: 'a7' });
});

test('a promotion premove defaults to a queen and honours a chosen piece', () => {
  const fen = '8/4P3/8/8/8/8/8/K6k w - - 0 1';

  const queen = resolvePremove({
    fen,
    premove: { from: 'e7', to: 'e8' },
    playerColor: 'w',
    turn: 'w',
    status: 'playing',
  });
  assert.deepEqual(queen, { from: 'e7', to: 'e8', promotion: DEFAULT_PROMOTION });

  const knight = resolvePremove({
    fen,
    premove: { from: 'e7', to: 'e8', promotion: 'n' },
    playerColor: 'w',
    turn: 'w',
    status: 'playing',
  });
  assert.deepEqual(knight, { from: 'e7', to: 'e8', promotion: 'n' });
});

test('a premove that became illegal is cancelled, not executed', () => {
  /* The knight on f3 was captured, so there is nothing to move. */
  const { fen, turn } = position(['e4', 'e5', 'Nf3', 'd6', 'd4', 'Bg4', 'dxe5', 'Bxf3']);
  assert.equal(turn, 'w');
  assert.equal(
    resolvePremove({
      fen,
      premove: { from: 'g1', to: 'f3' },
      playerColor: 'w',
      turn,
      status: 'playing',
    }),
    null,
  );
});

test('a premove that would leave the king in check is cancelled', () => {
  /* White king e1, black rook e8, white knight e2 pinned on the e-file. */
  const fen = '4r2k/8/8/8/8/8/4N3/4K3 w - - 0 1';
  assert.equal(
    resolvePremove({
      fen,
      premove: { from: 'e2', to: 'c3' },
      playerColor: 'w',
      turn: 'w',
      status: 'playing',
    }),
    null,
  );
});

test('the destination changing under the premove is caught', () => {
  /* The c3 knight is pinned by the b4 bishop once the opponent plays ...Bb4,
     so the queued Nc3-d5 must not be played. */
  const fen = 'rnbqk2r/pppp1ppp/5n2/8/1b6/2N5/PPP1PPPP/R1BQKBNR w KQkq - 0 1';
  assert.equal(
    resolvePremove({
      fen,
      premove: { from: 'c3', to: 'd5' },
      playerColor: 'w',
      turn: 'w',
      status: 'playing',
    }),
    null,
  );
});

test('no premove executes when it is not the player turn or the game ended', () => {
  const { fen, turn } = position(['e4', 'e5']);
  const premove = { from: 'g1', to: 'f3' } as const;

  assert.equal(
    resolvePremove({ fen, premove, playerColor: 'b', turn, status: 'playing' }),
    null,
  );
  assert.equal(
    resolvePremove({ fen, premove, playerColor: 'w', turn, status: 'finished' }),
    null,
  );
  assert.equal(
    resolvePremove({ fen, premove: null, playerColor: 'w', turn, status: 'playing' }),
    null,
  );
});

test('a premove is never applied to a stale position', () => {
  const before = position(['e4', 'e5']);
  const after = position(['d4', 'd5']);
  const premove = { from: 'g1', to: 'f3' } as const;

  assert.ok(resolvePremove({ ...before, premove, playerColor: 'w', status: 'playing' }));
  /* Same squares, different game: Nf3 is still legal, but the point is that
     the check always runs against the FEN it is given, not a cached one. */
  assert.ok(resolvePremove({ ...after, premove, playerColor: 'w', status: 'playing' }));
  assert.equal(
    resolvePremove({
      fen: after.fen,
      premove: { from: 'e2', to: 'e5' },
      playerColor: 'w',
      turn: after.turn,
      status: 'playing',
    }),
    null,
  );
});

test('castling premoves resolve through chess.js', () => {
  const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  assert.deepEqual(
    resolvePremove({
      fen,
      premove: { from: 'e1', to: 'g1' },
      playerColor: 'w',
      turn: 'w',
      status: 'playing',
    }),
    { from: 'e1', to: 'g1' },
  );
});

test('premove equality ignores a missing promotion field', () => {
  assert.equal(samePremove({ from: 'e7', to: 'e8' }, { from: 'e7', to: 'e8' }), true);
  assert.equal(samePremove({ from: 'e7', to: 'e8' }, { from: 'e7', to: 'e8', promotion: 'q' }), false);
  assert.equal(samePremove(null, null), true);
  assert.equal(samePremove(null, { from: 'e2', to: 'e4' }), false);
});

test('a premove executes on the clock like any other move, increment included', () => {
  const clock = new ChessClock(60, 2);
  clock.start(0);
  /* White moves at 2s; the bot thinks for 6s and replies at 8s. */
  clock.afterMove('w', 'b', 2_000);
  clock.afterMove('b', 'w', 8_000);
  /* The premove fires 150ms after the bot's move. */
  const afterPremove = clock.afterMove('w', 'b', 8_150);

  /* White's first move earned its 2s increment; the premove only costs 150ms. */
  assert.equal(afterPremove.whiteMs, 60_000 - 150 + 2_000);
  assert.equal(afterPremove.active, 'b');
  assert.equal(afterPremove.running, true);
});

/* ------------------------------- queues ---------------------------------- */

test('premoves accumulate into a chain, without repeats, up to the cap', () => {
  const first = enqueuePremove([], { from: 'g1', to: 'f3' });
  assert.deepEqual(first, [{ from: 'g1', to: 'f3' }]);

  const chained = enqueuePremove(first!, { from: 'f1', to: 'c4' });
  assert.deepEqual(chained, [
    { from: 'g1', to: 'f3' },
    { from: 'f1', to: 'c4' },
  ]);

  /* Repeating the last entry is a no-op, not a second identical premove. */
  assert.equal(enqueuePremove(chained!, { from: 'f1', to: 'c4' }), null);

  const full = [
    { from: 'a2', to: 'a3' },
    { from: 'b2', to: 'b3' },
    { from: 'c2', to: 'c3' },
    { from: 'd2', to: 'd4' },
    { from: 'e2', to: 'e4' },
  ];
  assert.equal(MAX_PREMOVES, full.length);
  assert.equal(enqueuePremove(full, { from: 'f2', to: 'f3' }), null);
});

test('the queue preview applies the chain with the opponent passing', () => {
  const afterE4 = premoveQueueFen(START, [{ from: 'e2', to: 'e4' }], 'w');
  assert.equal(new Chess(afterE4).get('e4')?.type, 'p');
  assert.equal(new Chess(afterE4).turn(), 'w');
  /* The second premove is chosen against the position the first one reaches. */
  assert.ok(premoveTargets(afterE4, 'e4', 'w').includes('e5'));

  const chained = premoveQueueFen(
    START,
    [
      { from: 'e2', to: 'e4' },
      { from: 'g1', to: 'f3' },
    ],
    'w',
  );
  assert.equal(new Chess(chained).get('f3')?.type, 'n');
  assert.equal(new Chess(chained).turn(), 'w');
});

test('queued premoves are described in SAN order', () => {
  assert.deepEqual(
    describePremoveQueue(
      START,
      [
        { from: 'e2', to: 'e4' },
        { from: 'g1', to: 'f3' },
      ],
      'w',
    ),
    ['e4', 'Nf3'],
  );
  assert.deepEqual(describePremoveQueue(START, [], 'w'), []);
});

test('the queue plays one premove per opponent reply and keeps the rest', () => {
  const { fen, turn } = position(['e4', 'e5']);
  const result = resolvePremoveQueue({
    fen,
    queue: [
      { from: 'g1', to: 'f3' },
      { from: 'f1', to: 'c4' },
    ],
    playerColor: 'w',
    turn,
    status: 'playing',
  });

  assert.deepEqual(result.move, { from: 'g1', to: 'f3' });
  assert.deepEqual(result.remaining, [{ from: 'f1', to: 'c4' }]);
  assert.equal(new Chess(result.fen).get('f3')?.type, 'n');
});

test('a head that became illegal cancels the whole chain', () => {
  const { fen, turn } = position(['e4', 'e5', 'Nf3', 'd6', 'd4', 'Bg4', 'dxe5', 'Bxf3']);
  const result = resolvePremoveQueue({
    fen,
    queue: [
      { from: 'g1', to: 'f3' },
      { from: 'f1', to: 'c4' },
    ],
    playerColor: 'w',
    turn,
    status: 'playing',
  });

  assert.equal(result.move, null);
  assert.deepEqual(result.remaining, []);
});

test('nothing resolves when it is not the player turn', () => {
  const { fen } = position(['e4', 'e5']);
  const result = resolvePremoveQueue({
    fen,
    queue: [{ from: 'g1', to: 'f3' }],
    playerColor: 'w',
    turn: 'b',
    status: 'playing',
  });

  assert.equal(result.move, null);
  assert.deepEqual(result.remaining, []);
});
