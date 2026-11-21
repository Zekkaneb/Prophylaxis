import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { Chess } from 'chess.js';
import type { StockfishController } from '../../src/engine/useStockfish.ts';
import {
  NINA_BOOK,
  NINA_BOOK_STATS,
  PERSONALITY_REPERTOIRES,
  personalityBookFor,
  repertoireIssues,
} from '../../src/play/personality/repertoires/index.ts';
import { bookKey, legalBookMoves } from '../../src/play/personality/repertoires/book.ts';
import {
  chooseNinaBookMove,
  chooseNinaPlanMove,
  createOpeningMemory,
  ninaForgetChance,
  ninaPlan,
} from '../../src/play/personality/nina.ts';
import {
  NINA_CAUTION_GAP,
  ninaAmbition,
  ninaPrefersCautious,
} from '../../src/play/personality/ninaTraits.ts';
import {
  choosePersonalityMove,
  describeMove,
} from '../../src/play/personality/engine.ts';
import { chooseBotMove } from '../../src/play/personality/chooseMove.ts';
import { accuracyForElo, styleFor } from '../../src/play/personality/styles.ts';
import { candidateGapForElo } from '../../src/play/personality/engine.ts';
import { SEARCH_DEPTH, blunderChance, depthForElo } from '../../src/play/strength.ts';
import { getOpponent, opponentFullName } from '../../src/play/opponents.ts';
import { DIALOGUE_BANKS, createDialogueState, maybeReact } from '../../src/play/personality/dialogue.ts';
import { computeThinkingPlan } from '../../src/play/personality/thinking.ts';
import type { BookMove } from '../../src/play/personality/repertoires/book.ts';

const NINA = styleFor('nina', 1550)!;

const noEngine: StockfishController = {
  status: 'ready',
  error: null,
  evaluatePosition: () => {
    throw new Error('a book/principle test must not search');
  },
  evaluateWithin: () => {
    throw new Error('a book/principle test must not search');
  },
  stop: () => {},
  terminate: () => {},
};

function bookMoves(sans: string[], color: 'w' | 'b') {
  const game = new Chess();
  for (const san of sans) game.move(san);
  return legalBookMoves(personalityBookFor('nina', color), game);
}

function fakeBookMove(san: string, weight: number, lineIds = ['line']): BookMove {
  return { uci: 'd2d4', san, tags: ['initiative'], weight, lineIds };
}

test('Nina is the sixth personality at 1550, now labelled Sophomore', () => {
  const nina = getOpponent('nina');
  assert.ok(nina);
  assert.equal(nina.name, 'Nina Yang');
  assert.equal(nina.elo, 1550);
  assert.equal(nina.kind, 'personality');
  assert.equal(nina.usesRepertoire, false);
  assert.equal(nina.title, 'Sophomore');
  assert.equal(nina.id, 'nina', 'the id is unchanged, so saved games still resolve');
  assert.equal(opponentFullName(nina), 'Nina Yang (Sophomore)');
  assert.equal(nina.initials, 'NY');
  assert.ok(fs.existsSync('public/opponents/nina.webp'), 'the supplied portrait is installed');
});

test('both supplied studies imported with their chapter boundaries', () => {
  const jobava = fs.readFileSync('repertoires/nina/jobava-london.pgn', 'utf8');
  const caro = fs.readFileSync('repertoires/nina/caro-kann.pgn', 'utf8');
  assert.equal((jobava.match(/^\[Event /gm) ?? []).length, 10);
  assert.equal((caro.match(/^\[Event /gm) ?? []).length, 43);

  assert.equal(NINA_BOOK_STATS.sources.length, 2);
  assert.deepEqual(NINA_BOOK_STATS.issues, []);
  assert.equal(NINA_BOOK_STATS.chapters, 52, '10 Jobava entries minus one empty intro, plus 43 Caro chapters');
  assert.ok(NINA_BOOK_STATS.variations > 6_000);
  assert.ok(NINA_BOOK_STATS.positions > 3_000);

  const lineIds = new Set(NINA_BOOK.flatMap((entry) => entry.lineIds));
  assert.equal([...lineIds].filter((id) => id.startsWith('nina-jobava')).length, 9);
  assert.equal([...lineIds].filter((id) => id.startsWith('nina-caro')).length, 43);
  assert.deepEqual(repertoireIssues().filter((entry) => entry.issues.length > 0), []);
});

test('starting FENs and variations survive the import', () => {
  assert.ok(
    NINA_BOOK.some(
      (entry) =>
        entry.key.startsWith('rn1qk2r/ppp2ppp/3bpn2') &&
        entry.lineIds.some((id) => id.includes('typical-ideas')),
    ),
    'a chapter that starts from a FEN contributed moves',
  );
  assert.ok(NINA_BOOK.some((entry) => entry.lineIds.length > 1), 'transposing branches merge');
});

test('Nina has independent Jobava and Caro-Kann books', () => {
  assert.equal(legalBookMoves(personalityBookFor('nina', 'w'), new Chess())[0]?.san, 'd4');

  const afterE4 = new Chess();
  afterE4.move('e4');
  assert.ok(bookMoves(['e4'], 'b').some((move) => move.san === 'c6'));

  const jobava = new Chess();
  for (const san of ['d4', 'Nf6', 'Nc3', 'd5', 'Bf4', 'c6']) jobava.move(san);
  assert.ok(
    legalBookMoves(personalityBookFor('nina', 'w'), jobava).some((move) => move.san === 'e3'),
    'the 3...c6 chapter is available by position',
  );

  const caro = new Chess();
  for (const san of ['e4', 'c6', 'd4', 'd5', 'Nc3']) caro.move(san);
  assert.ok(
    legalBookMoves(personalityBookFor('nina', 'b'), caro).some((move) => move.san === 'dxe4'),
    'the Caro-Kann main line is available by position',
  );

  assert.ok(!('nina' in PERSONALITY_REPERTOIRES));
  assert.equal(personalityBookFor('general', 'w').size, 0);
  assert.ok(personalityBookFor('nina', 'w').size > 0);
  assert.ok(personalityBookFor('nina', 'b').size > 0);
});

test('the 1...d5 and Jobava first moves are principles, not fabricated lines', () => {
  const start = new Chess();
  const white = ninaPlan(start.fen(), [], NINA, 'w');
  assert.deepEqual(white?.moves.map((move) => move.uci), ['d2d4']);

  const afterD4 = new Chess();
  afterD4.move('d4');
  assert.deepEqual(
    ninaPlan(afterD4.fen(), ['d4'], NINA, 'b')?.moves.map((move) => move.uci),
    ['d7d5'],
  );
  assert.equal(
    chooseNinaPlanMove({
      fen: afterD4.fen(),
      history: ['d4'],
      style: NINA,
      color: 'b',
      elo: 1550,
      candidates: [],
    })?.uci,
    'd7d5',
    'the intuitive answer does not need a PGN',
  );

  const afterE4 = new Chess();
  afterE4.move('e4');
  assert.equal(ninaPlan(afterE4.fen(), ['e4'], NINA, 'b'), null, '1.e4 is the Caro-Kann book');
});

test('opening recall is occasional, branch-sensitive and ends the book for the game', () => {
  const mainline = fakeBookMove('d4', 3);
  const branch = fakeBookMove('Nc3', 1, ['line-a', 'line-b']);
  assert.ok(ninaForgetChance(mainline, 4) < ninaForgetChance(branch, 4));
  assert.ok(ninaForgetChance(mainline, 4) < ninaForgetChance(mainline, 28));
  assert.ok(ninaForgetChance(branch, 60) <= 0.12);

  let remembered = 0;
  for (let index = 0; index < 200; index += 1) {
    const choice = chooseNinaBookMove({
      moves: [mainline],
      style: NINA,
      history: ['d4'],
      memory: createOpeningMemory(),
      random: () => 0.5,
    });
    if (choice.move) remembered += 1;
  }
  assert.equal(remembered, 200, 'familiar positions are usually remembered');

  const memory = createOpeningMemory();
  const forgotten = chooseNinaBookMove({
    moves: [mainline],
    style: NINA,
    history: ['d4'],
    memory,
    random: () => 0,
  });
  assert.equal(forgotten.forgotten, true);
  assert.equal(forgotten.move, null);
  assert.equal(memory.forgotten, true);

  const later = chooseNinaBookMove({
    moves: [mainline],
    style: NINA,
    history: ['d4', 'd5', 'c4'],
    memory,
    random: () => 0,
  });
  assert.equal(later.move, null, 'she does not re-enter the line this game');

  const senior = styleFor('senior', 2250)!;
  const seniorMemory = createOpeningMemory();
  const seniorChoice = chooseNinaBookMove({
    moves: [mainline],
    style: senior,
    history: ['d4'],
    memory: seniorMemory,
    random: () => 0,
  });
  assert.equal(seniorChoice.move?.san, 'd4');
  assert.equal(seniorMemory.forgotten, false, 'forgetfulness never touches another bot');
});

test('Nina leaves both book and principles after forgetting and plays a legal engine move', async () => {
  const memory = createOpeningMemory();
  memory.forgotten = true;
  const start = new Chess();

  assert.equal(
    chooseNinaPlanMove({
      fen: start.fen(),
      history: [],
      style: NINA,
      color: 'w',
      elo: 1550,
      candidates: [],
      forgotten: true,
    }),
    null,
    'a forgotten line does not rebuild itself from the principle skeleton',
  );

  const engine: StockfishController = {
    ...noEngine,
    evaluateWithin: async () => ({
      fen: start.fen(),
      depth: 5,
      bestMove: 'e2e4',
      secondBestMove: 'd2d4',
      ponder: null,
      pv: ['e2e4'],
      scoreCp: 20,
      mate: null,
      secondScoreCp: 15,
      secondMate: null,
      shallowScoreCp: 20,
      shallowMate: null,
      candidates: [
        { rank: 1, uci: 'e2e4', scoreCp: 20, mate: null, pv: ['e2e4'] },
        { rank: 2, uci: 'd2d4', scoreCp: 15, mate: null, pv: ['d2d4'] },
      ],
    }),
  };

  const chosen = await chooseBotMove({
    game: start,
    fen: start.fen(),
    history: [],
    botColor: 'w',
    style: NINA,
    elo: 1550,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine,
    openingMemory: memory,
    random: () => 0.9,
  });

  assert.ok(chosen);
  assert.equal(chosen.source, 'engine');
  assert.equal(chosen.bookMove, false);
  assert.equal(chosen.forgotten, false);
  const legalMove = new Chess();
  assert.doesNotThrow(() => legalMove.move(chosen.uci));
});

test('the Jobava/Caro book is used before the engine in both modes', async () => {
  const start = new Chess();
  const white = await chooseBotMove({
    game: start,
    fen: start.fen(),
    history: [],
    botColor: 'w',
    style: NINA,
    elo: 1550,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: noEngine,
    openingMemory: createOpeningMemory(),
    random: () => 0.9,
  });
  assert.equal(white?.uci, 'd2d4');
  assert.equal(white?.source, 'repertoire');
  assert.equal(white?.forgotten, false);

  const afterE4 = new Chess();
  afterE4.move('e4');
  const black = await chooseBotMove({
    game: afterE4,
    fen: afterE4.fen(),
    history: ['e4'],
    botColor: 'b',
    style: NINA,
    elo: 1550,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: noEngine,
    openingMemory: createOpeningMemory(),
    random: () => 0.9,
  });
  assert.equal(black?.uci, 'c7c6');
  assert.equal(black?.source, 'repertoire');
});

test('Nina prefers a comfortable continuation over an ambitious one', () => {
  const fen = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 6';
  const candidates = [
    { uci: 'c4f7', scoreCp: 20, mate: null },
    { uci: 'e1g1', scoreCp: 15, mate: null },
  ];

  const cautious = choosePersonalityMove({
    fen,
    candidates,
    style: NINA,
    elo: 1550,
    random: () => 0.1,
  });
  assert.equal(cautious?.uci, 'e1g1');

  const ambitious = styleFor('brandon', 2350)!;
  const brandon = choosePersonalityMove({
    fen,
    candidates,
    style: ambitious,
    elo: 2350,
    random: () => 0.1,
  });
  assert.equal(brandon?.uci, 'c4f7');

  const sacrifice = describeMove(fen, 'c4f7');
  const castle = describeMove(fen, 'e1g1');
  assert.ok(sacrifice && castle);
  assert.ok(ninaAmbition(sacrifice) > ninaAmbition(castle));
  assert.equal(
    ninaPrefersCautious({ ambition: ninaAmbition(sacrifice), botPov: -200, random: () => 0 }),
    false,
    'she still defends when she is in trouble',
  );
  assert.ok(NINA_CAUTION_GAP > 0);
});

test('her strength dial is applied without inventing an Elo guarantee', () => {
  assert.equal(depthForElo(1550), SEARCH_DEPTH);
  assert.ok(Math.abs(blunderChance(1550) - 0.069) < 0.003);
  assert.equal(candidateGapForElo(1550), 100);
  assert.equal(accuracyForElo(1550), 1.45);
  assert.equal(styleFor('nina', 1550)?.accuracy, accuracyForElo(1550));

  const plan = computeThinkingPlan({
    fen: new Chess().fen(),
    style: NINA,
    clockMs: 300_000,
    incrementMs: 0,
    initialMs: 300_000,
    ply: 0,
    bookMove: true,
  });
  assert.equal(plan.searchMs, 0);
  assert.ok(plan.deliberationMs > 0 && plan.deliberationMs <= plan.budgetMs);
});

test('Nina sounds outgoing and her opening slips respect cooldowns', () => {
  const bank = DIALOGUE_BANKS.nina;
  assert.match(bank.book.join(' '), /Hiii/);
  assert.match(bank.deviation.join(' '), /supposed to play/);
  assert.match(bank.attack.join(' '), /pressure/);
  assert.match(bank.win.join(' '), /Yay/);

  const state = createDialogueState();
  const first = maybeReact('nina', 'deviation', { ply: 10, state, random: () => 0 });
  assert.ok(first);
  const second = maybeReact('nina', 'deviation', { ply: 12, state, random: () => 0 });
  assert.equal(second, null, 'the repeat gap stops dialogue spam');

  const bookNote = maybeReact('nina', 'book', { ply: 20, state, random: () => 0 });
  assert.ok(bookNote);
});

test('transposition matching ignores move-order-only differences', () => {
  const a = new Chess();
  for (const san of ['d4', 'd5', 'c4']) a.move(san);
  const b = new Chess();
  for (const san of ['c4', 'd5', 'd4']) b.move(san);
  assert.equal(bookKey(a.fen()), bookKey(b.fen()));
});
