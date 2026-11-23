/**
 * Monkey — the Hippopotamus, apex card.
 *
 * Covers the profile's identity (its own `???` category, portrait and
 * 999,999,999 card rating), the apex strength configuration that makes it the
 * strongest opponent rather than a reskinned Expert, the two supplied Hippo
 * chapters as a working book for both colours, the extended book window, and
 * the engine-first selection that `perfect` switches on.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { Chess } from 'chess.js';
import {
  ALL_OPPONENTS,
  OPPONENT_CATEGORIES,
  getOpponent,
  opponentFullName,
  opponentMeta,
} from '../../src/play/opponents.ts';
import { accuracyForElo, styleFor, type PersonalityStyle } from '../../src/play/personality/styles.ts';
import {
  PERSONALITY_REPERTOIRES,
  personalityBookFor,
  repertoireIssues,
} from '../../src/play/personality/repertoires/index.ts';
import { MONKEY_REPERTOIRE } from '../../src/play/personality/repertoires/monkey.ts';
import { hippoPlan } from '../../src/play/personality/repertoires/hippo.ts';
import { legalBookMoves } from '../../src/play/personality/repertoires/book.ts';
import { theoryOpen } from '../../src/play/theory.ts';
import { chooseBotMove } from '../../src/play/personality/chooseMove.ts';
import { choosePersonalityMove } from '../../src/play/personality/engine.ts';
import type { StockfishController } from '../../src/engine/useStockfish.ts';

const MONKEY = getOpponent('monkey');
const STYLE = styleFor('monkey', 999999999) as PersonalityStyle;

function assertMonkey() {
  assert.ok(MONKEY, 'monkey is on the roster');
  return MONKEY!;
}

const noEngine: StockfishController = {
  status: 'ready',
  error: null,
  evaluatePosition: () => {
    throw new Error('a book move should not search');
  },
  evaluateWithin: () => {
    throw new Error('a book move should not search');
  },
  stop: () => {},
  terminate: () => {},
};

/** A full-strength search stub that records the width and depth it was given. */
function engineSpy(candidates: Array<{ uci: string; scoreCp: number }>) {
  const seen = { calls: 0, depth: 0, multiPv: 0 };
  const engine: StockfishController = {
    ...noEngine,
    evaluateWithin: async (fen, depth, multiPv) => {
      seen.calls += 1;
      seen.depth = depth;
      seen.multiPv = multiPv;
      const lines = candidates.map((candidate, index) => ({
        rank: index + 1,
        uci: candidate.uci,
        scoreCp: candidate.scoreCp,
        mate: null,
        pv: [candidate.uci],
      }));
      return {
        fen,
        depth,
        bestMove: lines[0]?.uci ?? null,
        secondBestMove: lines[1]?.uci ?? null,
        ponder: null,
        pv: lines[0]?.pv ?? [],
        scoreCp: lines[0]?.scoreCp ?? 0,
        mate: null,
        secondScoreCp: lines[1]?.scoreCp ?? 0,
        secondMate: null,
        shallowScoreCp: lines[0]?.scoreCp ?? 0,
        shallowMate: null,
        candidates: lines,
      };
    },
  };
  return { engine, seen };
}

/** The supplied White study move order, plus ...Bd7 and ...a6 to leave it. */
const COMPLETED_SETUP = [
  'g3', 'c5',
  'Bg2', 'Nc6',
  'd3', 'd5',
  'Nd2', 'e5',
  'b3', 'Be6',
  'Bb2', 'Nf6',
  'a3', 'Qc7',
  'e3', 'Rd8',
  'Ne2', 'Bd7',
  'O-O', 'a6',
] as const;

test('Monkey is its own ??? category at 999,999,999 Elo with its own portrait', () => {
  const monkey = assertMonkey();
  assert.equal(monkey.id, 'monkey');
  assert.equal(monkey.name, 'Monkey');
  assert.equal(monkey.elo, 999999999);
  assert.equal(monkey.category, 'apex');
  assert.equal(monkey.title, '???');
  assert.equal(opponentFullName(monkey), 'Monkey (???)');
  assert.equal(opponentMeta(monkey), '??? · 999999999 Elo');
  assert.equal(monkey.portraitPath, 'opponents/monkey.webp');
  assert.equal(fs.existsSync('public/opponents/monkey.webp'), true);

  const apex = OPPONENT_CATEGORIES.find((category) => category.id === 'apex');
  assert.ok(apex);
  assert.equal(apex!.label, '???');
  assert.deepEqual(
    ALL_OPPONENTS.filter((opponent) => opponent.category === 'apex').map((opponent) => opponent.id),
    ['monkey'],
    'the category belongs to Monkey alone',
  );
});

test('its strength is the apex configuration, not another 2800 card', () => {
  assert.equal(STYLE.planElo, 2800, 'the rating clamps to the ladder ceiling');
  assert.equal(STYLE.accuracy, accuracyForElo(2800));
  assert.equal(STYLE.perfect, true, 'it plays the engine first line');
  assert.equal(STYLE.depthFloor, 20, 'the floor no time control can shorten');
  assert.equal(STYLE.bookPlies, 40, 'the full Hippo study stays in the book');
  assert.equal(STYLE.mistakeChance, 0, 'the shared slip roll never fires');
  assert.equal(STYLE.depthCap, undefined, 'nothing caps the apex search');
});

test('the book is both supplied Hippo chapters, verbatim', () => {
  assert.equal(PERSONALITY_REPERTOIRES.monkey, MONKEY_REPERTOIRE);

  assert.deepEqual(MONKEY_REPERTOIRE.asWhite[0].san, [
    'g3', 'c5',
    'Bg2', 'Nc6',
    'd3', 'd5',
    'Nd2', 'e5',
    'b3', 'Be6',
    'Bb2', 'Nf6',
    'a3', 'Qc7',
    'e3', 'Rd8',
    'Ne2',
  ]);
  assert.deepEqual(MONKEY_REPERTOIRE.asBlack[0].san, [
    'e4', 'g6',
    'd4', 'Bg7',
    'Nc3', 'd6',
    'Be3', 'Nd7',
    'Qd2', 'e6',
    'h4', 'h5',
    'Nf3', 'a6',
    'Bd3', 'b5',
    'Bg5', 'Ne7',
    'e5', 'Bb7',
  ]);

  assert.deepEqual(
    repertoireIssues().filter((entry) => entry.issues.length > 0),
    [],
    'every declared ply replays legally',
  );

  const start = legalBookMoves(personalityBookFor('monkey', 'w'), new Chess());
  assert.deepEqual(start.map((move) => move.san), ['g3']);

  const afterE4 = new Chess();
  afterE4.move('e4');
  const black = legalBookMoves(personalityBookFor('monkey', 'b'), afterE4);
  assert.deepEqual(black.map((move) => move.san), ['g6']);
});

test('the Hippo window outlasts the Expert+ fourteen plies, for Monkey only', () => {
  assert.equal(theoryOpen(999999999, 19, STYLE.bookPlies), true);
  assert.equal(theoryOpen(999999999, 39, STYLE.bookPlies), true);
  assert.equal(theoryOpen(999999999, 40, STYLE.bookPlies), false);
  assert.equal(theoryOpen(2000, 19), false, 'a normal Expert still stops at 14');
});

test('it opens 1.g3 as White and 1...g6 against 1.e4 without searching', async () => {
  const white = new Chess();
  const first = await chooseBotMove({
    game: white,
    fen: white.fen(),
    history: [],
    botColor: 'w',
    style: STYLE,
    elo: 999999999,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: noEngine,
    random: () => 0.99,
  });
  assert.equal(first?.uci, 'g2g3');
  assert.equal(first?.bookMove, true);
  assert.equal(first?.source, 'repertoire');

  const blackGame = new Chess();
  blackGame.move('e4');
  const reply = await chooseBotMove({
    game: blackGame,
    fen: blackGame.fen(),
    history: ['e4'],
    botColor: 'b',
    style: STYLE,
    elo: 999999999,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: noEngine,
    random: () => 0.99,
  });
  assert.equal(reply?.uci, 'g7g6');
  assert.equal(reply?.bookMove, true);
});

test('the Hippo plan covers both colours when the book no longer applies', () => {
  assert.equal(hippoPlan(new Chess().fen(), 'w', STYLE)?.moves[0].uci, 'g2g3');

  const afterE5 = new Chess();
  afterE5.move('g3');
  afterE5.move('e5');
  assert.equal(hippoPlan(afterE5.fen(), 'w', STYLE)?.moves[0].uci, 'f1g2');

  const afterD4 = new Chess();
  afterD4.move('d4');
  assert.equal(hippoPlan(afterD4.fen(), 'b', STYLE)?.moves[0].uci, 'g7g6');

  assert.equal(
    hippoPlan(new Chess().fen(), 'w', styleFor('brandon', 2350) as PersonalityStyle),
    null,
    'only Monkey owns the plan',
  );
});

test('after a deviation it plays the plan without searching', async () => {
  const whiteGame = new Chess();
  whiteGame.move('g3');
  whiteGame.move('e5');
  const white = await chooseBotMove({
    game: whiteGame,
    fen: whiteGame.fen(),
    history: ['g3', 'e5'],
    botColor: 'w',
    style: STYLE,
    elo: 999999999,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: noEngine,
    random: () => 0.99,
  });
  assert.equal(white?.uci, 'f1g2');
  assert.equal(white?.source, 'hippo-system');
  assert.equal(white?.bookMove, false);

  const blackGame = new Chess();
  blackGame.move('d4');
  const black = await chooseBotMove({
    game: blackGame,
    fen: blackGame.fen(),
    history: ['d4'],
    botColor: 'b',
    style: STYLE,
    elo: 999999999,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: noEngine,
    random: () => 0.99,
  });
  assert.equal(black?.uci, 'g7g6');
  assert.equal(black?.source, 'hippo-system');
});

test('once the setup is complete it searches one PV at full depth and takes it', async () => {
  const game = new Chess();
  for (const san of COMPLETED_SETUP) game.move(san);

  assert.equal(hippoPlan(game.fen(), 'w', STYLE), null, 'the setup has nothing left to play');

  const { engine, seen } = engineSpy([
    { uci: 'c2c3', scoreCp: 22 },
    { uci: 'h2h3', scoreCp: 0 },
  ]);
  const chosen = await chooseBotMove({
    game,
    fen: game.fen(),
    history: [...COMPLETED_SETUP],
    botColor: 'w',
    style: STYLE,
    elo: 999999999,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine,
    random: () => 0.5,
  });

  assert.equal(seen.calls, 1);
  assert.equal(seen.multiPv, 1, 'no human MultiPV list and no candidate allowance');
  assert.equal(seen.depth, 20, 'the apex depth floor');
  assert.equal(chosen?.uci, 'c2c3', 'the engine first line');
  assert.equal(chosen?.source, 'engine');
});

test('`perfect` takes the first line even when taste would prefer another move', () => {
  const choice = choosePersonalityMove({
    fen: new Chess().fen(),
    candidates: [
      { uci: 'g1f3', scoreCp: 0, mate: null },
      { uci: 'e2e4', scoreCp: 30, mate: null },
    ],
    style: STYLE,
    elo: 2800,
    random: () => 0.5,
  });
  assert.equal(choice?.uci, 'e2e4');
});
