import assert from 'node:assert/strict';
import test from 'node:test';
import { Chess } from 'chess.js';
import { chooseBotMove } from '../../src/play/personality/chooseMove.ts';
import { styleFor } from '../../src/play/personality/styles.ts';
import { matchDelayMs } from '../../src/play/botMatch.ts';
import type { StockfishController } from '../../src/engine/useStockfish.ts';

/**
 * Engine stub: book-first selection must never need a search, so any call here
 * is a failure. It also proves the bot-vs-bot path uses the same chooser as the
 * human game instead of a second, engine-only implementation.
 */
const noEngine: StockfishController = {
  status: 'ready',
  error: null,
  evaluatePosition: () => {
    throw new Error('book move should not search');
  },
  evaluateWithin: () => {
    throw new Error('book move should not search');
  },
  stop: () => {},
  terminate: () => {},
};

function bookMove(fen: string, history: string[], color: 'w' | 'b') {
  const game = new Chess(fen);
  return chooseBotMove({
    game,
    fen,
    history,
    botColor: color,
    style: styleFor('brandon', 2350)!,
    elo: 2350,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: noEngine,
  });
}

test('viewing pace only changes the pause between moves', () => {
  assert.ok(matchDelayMs('slow') > matchDelayMs('normal'));
  assert.ok(matchDelayMs('normal') > matchDelayMs('fast'));
  assert.equal(new Set([matchDelayMs('slow'), matchDelayMs('normal'), matchDelayMs('fast')]).size, 3);
});

test('Brandon plays his White book without an engine search', async () => {
  const start = new Chess();
  const chosen = await bookMove(start.fen(), [], 'w');
  assert.equal(chosen?.uci, 'e2e4');
  assert.equal(chosen?.bookMove, true);
  assert.equal(chosen?.source, 'repertoire');
});

test('Brandon answers 1.e4 with his French Defence and 1.d4 with the Grünfeld', async () => {
  const e4 = new Chess();
  e4.move('e4');
  const french = await bookMove(e4.fen(), ['e4'], 'b');
  assert.equal(french?.uci, 'e7e6');

  const d4 = new Chess();
  d4.move('d4');
  const gruenfeld = await bookMove(d4.fen(), ['d4'], 'b');
  assert.equal(gruenfeld?.uci, 'g8f6');
});

test('each bot receives its own colour and personality profile', async () => {
  const game = new Chess();
  game.move('e4');
  const senior = await chooseBotMove({
    game,
    fen: game.fen(),
    history: ['e4'],
    botColor: 'b',
    style: styleFor('senior', 2250)!,
    elo: 2250,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: noEngine,
  });
  assert.equal(senior?.uci, 'd7d6', 'Senior’s Pirc, not Brandon’s French');

  const brandon = await bookMove(game.fen(), ['e4'], 'b');
  assert.equal(brandon?.uci, 'e7e6');
  assert.notEqual(senior?.uci, brandon?.uci);
});

test('an aborted search returns nothing instead of a stale move', async () => {
  const game = new Chess();
  game.move('a4');
  let called = 0;
  const engine: StockfishController = {
    ...noEngine,
    evaluateWithin: async () => {
      called += 1;
      return {
        fen: game.fen(),
        depth: 1,
        bestMove: 'e7e5',
        secondBestMove: null,
        ponder: null,
        pv: ['e7e5'],
        scoreCp: 0,
        mate: null,
        secondScoreCp: 0,
        secondMate: null,
        shallowScoreCp: 0,
        shallowMate: null,
        candidates: [{ rank: 1, uci: 'e7e5', scoreCp: 0, mate: null, pv: ['e7e5'] }],
      };
    },
  };
  const chosen = await chooseBotMove({
    game,
    fen: game.fen(),
    history: ['a4'],
    botColor: 'b',
    style: styleFor('freshman', 1250)!,
    elo: 1250,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine,
    random: () => 0.99,
    shouldAbort: () => true,
  });
  assert.equal(called, 1);
  assert.equal(chosen, null);
});
