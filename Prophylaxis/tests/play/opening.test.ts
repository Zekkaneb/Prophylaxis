/**
 * Opening priority: prepared theory, then the principle-based system, then the
 * engine. The blunder roll must never preempt either.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { Chess } from 'chess.js';
import {
  hasPreparedOpening,
  openingSource,
  shouldTakeBlunder,
} from '../../src/play/personality/opening.ts';
import { chooseBookMove } from '../../src/play/personality/engine.ts';
import { legalBookMoves } from '../../src/play/personality/repertoires/book.ts';
import {
  PERSONALITY_REPERTOIRES,
  personalityBookFor,
} from '../../src/play/personality/repertoires/index.ts';
import { kidPlan } from '../../src/play/personality/repertoires/kid.ts';
import { PERSONALITY_STYLES } from '../../src/play/personality/styles.ts';
import { STANDARD_START_FEN } from '../../src/play/pgn.ts';

const IDS = ['freshman', 'sophomore', 'junior', 'senior'] as const;

test('a prepared move outranks every other source', () => {
  assert.equal(openingSource({ bookMove: true, kidPlan: true }), 'repertoire');
  assert.equal(openingSource({ bookMove: true, kidPlan: false }), 'repertoire');
  assert.equal(openingSource({ bookMove: false, kidPlan: true }), 'kids-indian');
  assert.equal(openingSource({ bookMove: false, kidPlan: false }), 'engine');

  assert.equal(hasPreparedOpening('repertoire'), true);
  assert.equal(hasPreparedOpening('kids-indian'), true);
  assert.equal(hasPreparedOpening('engine'), false);
});

test('the blunder roll never fires while theory is available', () => {
  /* A roll of 0 would always blunder at 1250 if theory were ignored. */
  assert.equal(shouldTakeBlunder(1250, () => 0, true), false);
  assert.equal(shouldTakeBlunder(600, () => 0, true), false);
  assert.equal(shouldTakeBlunder(2250, () => 0, true), false);

  /* Out of theory the curve decides, and it is still wider for beginners. */
  assert.equal(shouldTakeBlunder(1250, () => 0, false), true);
  assert.equal(shouldTakeBlunder(1250, () => 0.99, false), false);
  assert.equal(shouldTakeBlunder(2250, () => 0.005, false), true);
});

test('every declared theory move is available to the bot in its position', () => {
  for (const id of IDS) {
    const style = PERSONALITY_STYLES[id];
    const repertoire = PERSONALITY_REPERTOIRES[id];

    for (const color of ['w', 'b'] as const) {
      const book = personalityBookFor(id, color);
      for (const line of repertoire[color === 'w' ? 'asWhite' : 'asBlack']) {
        const game = new Chess();
        let ownMoves = 0;

        for (const san of line.san) {
          if (game.turn() === color) {
            const moves = legalBookMoves(book, game);
            assert.ok(
              moves.length > 0,
              `${id}/${line.id}: ${san} at ply ${ownMoves} is not a prepared move`,
            );
            /* The policy picks a prepared move here; never the engine. */
            assert.ok(chooseBookMove(moves, style, () => 0));
            assert.equal(
              openingSource({ bookMove: true, kidPlan: false }),
              'repertoire',
            );
            ownMoves += 1;
          }
          game.move(san);
        }

        assert.ok(ownMoves >= 4, `${id}/${line.id} has too few prepared moves`);
      }
    }
  }
});

test('the book covers the first move and then hands over to the engine', () => {
  for (const id of IDS) {
    const whiteMoves = legalBookMoves(personalityBookFor(id, 'w'), new Chess());
    assert.ok(whiteMoves.length > 0, `${id} has no prepared White move`);

    /* Follow the bot's own book to its deepest reply: once no prepared move
       remains, openingSource is 'engine' and Stockfish plays. */
    const game = new Chess();
    let deepest = 0;
    while (deepest < 30) {
      const moves = legalBookMoves(personalityBookFor(id, game.turn()), game);
      if (moves.length === 0) break;
      game.move(chooseBookMove(moves, PERSONALITY_STYLES[id], () => 0)?.san ?? '');
      deepest += 1;
    }
    assert.equal(
      openingSource({
        bookMove: legalBookMoves(personalityBookFor(id, game.turn()), game).length > 0,
        kidPlan: false,
      }),
      'engine',
      `${id} still reports theory after its book ended`,
    );
  }
});

test('the King’s Indian is prepared play, not a random or engine choice', () => {
  const game = new Chess();
  game.move('d4');

  for (const id of ['sophomore', 'junior'] as const) {
    const plan = kidPlan(game.fen(), ['d4'], PERSONALITY_STYLES[id], 'b');
    assert.ok(plan);
    assert.equal(
      openingSource({
        bookMove: legalBookMoves(personalityBookFor(id, 'b'), game).length > 0,
        kidPlan: Boolean(plan),
      }),
      'kids-indian',
    );
    /* A would-always-lapse roll must be ignored: the plan is prepared theory. */
    assert.equal(shouldTakeBlunder(1450, () => 0, true), false);
  }

  /* The standard start has no KID plan, so White still searches. */
  assert.equal(kidPlan(STANDARD_START_FEN, [], PERSONALITY_STYLES.junior, 'b'), null);
});
