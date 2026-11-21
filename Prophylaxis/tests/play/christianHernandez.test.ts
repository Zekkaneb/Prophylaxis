/**
 * Christian Hernandez (Senior) — the Natural, 950.
 *
 * Covers the catalogue identity and card fields, his place at the top of the
 * Beginner band, the tendency table and the 950 strength dials, the London
 * System as his only prepared opening, the deliberately empty Black book, legal
 * fallback in both colours, his voice and cadence, a complete game played
 * through the shared selection, saved-game/PGN identity, and the regressions
 * that keep every other opponent unchanged.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { Chess } from 'chess.js';
import {
  ALL_OPPONENTS,
  GENERAL_BOT,
  PERSONALITY_OPPONENTS,
  getOpponent,
  opponentFullName,
  opponentMeta,
  opponentStage,
  profileFromRecord,
} from '../../src/play/opponents.ts';
import {
  DIALOGUE_BANKS,
  createDialogueState,
  maybeReact,
} from '../../src/play/personality/dialogue.ts';
import {
  PERSONALITY_STYLES,
  accuracyForElo,
  styleFor,
  type PersonalityStyle,
} from '../../src/play/personality/styles.ts';
import {
  PERSONALITY_REPERTOIRES,
  isRepertoireId,
  personalityBookFor,
  personalityBooks,
  repertoireIssues,
} from '../../src/play/personality/repertoires/index.ts';
import { legalBookMoves } from '../../src/play/personality/repertoires/book.ts';
import { CHRISTIAN_HERNANDEZ_REPERTOIRE } from '../../src/play/personality/repertoires/christianHernandez.ts';
import { kidPlan } from '../../src/play/personality/repertoires/kid.ts';
import { chooseBotMove } from '../../src/play/personality/chooseMove.ts';
import { candidateGapForElo, choosePersonalityMove } from '../../src/play/personality/engine.ts';
import { computeThinkingPlan } from '../../src/play/personality/thinking.ts';
import { blunderChance } from '../../src/play/strength.ts';
import { buildPgn } from '../../src/play/pgn.ts';
import type { StockfishController } from '../../src/engine/useStockfish.ts';

const CHRISTIAN = getOpponent('christian-hernandez');
const STYLE = styleFor('christian-hernandez', 950) as PersonalityStyle;

function position(...san: string[]): Chess {
  const game = new Chess();
  for (const move of san) game.move(move);
  return game;
}

function assertLegal(fen: string, uci: string) {
  const game = new Chess(fen);
  game.move({
    from: uci.slice(0, 2) as never,
    to: uci.slice(2, 4) as never,
    promotion: uci.length > 4 ? uci.slice(4, 5) : undefined,
  });
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

/**
 * A stand-in engine that reports every legal move at the same evaluation, so a
 * whole game can be played through the real selection path without Stockfish.
 */
function legalMoveEngine(): StockfishController {
  return {
    ...noEngine,
    evaluateWithin: async (fen) => {
      const game = new Chess(fen);
      const candidates = game.moves({ verbose: true }).map((move, index) => ({
        rank: index + 1,
        uci: `${move.from}${move.to}${move.promotion ?? ''}`,
        scoreCp: 0,
        mate: null as number | null,
        pv: [`${move.from}${move.to}${move.promotion ?? ''}`],
      }));
      return {
        fen,
        depth: 1,
        bestMove: candidates[0]?.uci ?? null,
        secondBestMove: candidates[1]?.uci ?? null,
        ponder: null,
        pv: candidates[0] ? [candidates[0].uci] : [],
        scoreCp: 0,
        mate: null,
        secondScoreCp: 0,
        secondMate: null,
        shallowScoreCp: 0,
        shallowMate: null,
        candidates,
      };
    },
  };
}

function engineWith(candidates: Array<{ uci: string; scoreCp: number }>): StockfishController {
  return {
    ...noEngine,
    evaluateWithin: async (fen) => ({
      fen,
      depth: 1,
      bestMove: candidates[0]?.uci ?? null,
      secondBestMove: candidates[1]?.uci ?? null,
      ponder: null,
      pv: candidates[0] ? [candidates[0].uci] : [],
      scoreCp: candidates[0]?.scoreCp ?? 0,
      mate: null,
      secondScoreCp: candidates[1]?.scoreCp ?? 0,
      secondMate: null,
      shallowScoreCp: candidates[0]?.scoreCp ?? 0,
      shallowMate: null,
      candidates: candidates.map((candidate, index) => ({
        rank: index + 1,
        uci: candidate.uci,
        scoreCp: candidate.scoreCp,
        mate: null,
        pv: [candidate.uci],
      })),
    }),
  };
}

/* ---------------------------- identity ----------------------------- */

test('Christian Hernandez is on the roster as Senior, 950, in the Beginner band', () => {
  assert.ok(CHRISTIAN);
  assert.equal(CHRISTIAN.id, 'christian-hernandez', 'his own stable id');
  assert.equal(CHRISTIAN.kind, 'personality');
  assert.equal(CHRISTIAN.name, 'Christian Hernandez');
  assert.equal(CHRISTIAN.title, 'Senior');
  assert.equal(CHRISTIAN.elo, 950);
  assert.equal(CHRISTIAN.category, 'beginner');
  assert.equal(CHRISTIAN.initials, 'CH');
  assert.equal(CHRISTIAN.usesRepertoire, false);

  assert.doesNotMatch(CHRISTIAN.name, /\(/, 'the name carries no parenthetical suffix');
  assert.doesNotMatch(CHRISTIAN.name, /senior/i, 'the subtext lives in its own field');
  assert.equal(opponentStage(CHRISTIAN), 'Senior', 'the subtext is printed');
  assert.equal(opponentMeta(CHRISTIAN), 'Senior · 950 Elo');
  assert.equal(opponentFullName(CHRISTIAN), 'Christian Hernandez (Senior)');
  assert.ok(CHRISTIAN.style.length > 0);
  assert.match(CHRISTIAN.style, /natural/i, 'the card names his archetype');
});

test('he is registered exactly once, at the top of the Beginner band', () => {
  assert.equal(
    PERSONALITY_OPPONENTS.filter((opponent) => opponent.id === 'christian-hernandez').length,
    1,
    'registered exactly once',
  );
  assert.equal(new Set(ALL_OPPONENTS.map((opponent) => opponent.id)).size, ALL_OPPONENTS.length);
  assert.equal(getOpponent('christian-hernandez'), CHRISTIAN, 'the catalogue entry is the same object');

  assert.deepEqual(
    PERSONALITY_OPPONENTS.filter((opponent) => opponent.category === 'beginner').map(
      (opponent) => opponent.id,
    ),
    ['emmanuel', 'edward', 'faadi', 'christian-hernandez'],
    'the Beginner band lists him last, as its strongest card',
  );
  assert.ok(
    PERSONALITY_OPPONENTS.filter((opponent) => opponent.category === 'beginner').every(
      (opponent) => opponent.elo >= 100 && opponent.elo <= 1000,
    ),
    'the band is 100–1000 Elo',
  );

  /* Three cards now print "Senior"; every stored label still tells them apart. */
  const seniors = PERSONALITY_OPPONENTS.filter((opponent) => opponent.title === 'Senior');
  assert.equal(seniors.length, 5);
  assert.equal(new Set(seniors.map((opponent) => opponentFullName(opponent))).size, 5);
  assert.equal(
    new Set(PERSONALITY_OPPONENTS.map((opponent) => opponentFullName(opponent))).size,
    PERSONALITY_OPPONENTS.length,
    'saved games can always tell two opponents apart',
  );
});

test('his portrait is his own file, with the monogram kept as the fallback', () => {
  assert.equal(CHRISTIAN.portraitPath, 'opponents/christian-hernandez.webp');
  assert.equal(fs.existsSync('public/opponents/christian-hernandez.webp'), true);
  for (const other of PERSONALITY_OPPONENTS) {
    if (other.id === 'christian-hernandez') continue;
    assert.notEqual(other.portraitPath, CHRISTIAN.portraitPath, `${other.id} keeps its own portrait`);
  }
});

/* ------------------------- tendency profile -------------------------- */

test('his tendency table is the natural player: no speciality, a trade preference', () => {
  assert.deepEqual(
    {
      aggression: STYLE.aggression,
      risk: STYLE.risk,
      positional: STYLE.positional,
      tactical: STYLE.tactical,
      defensive: STYLE.defensive,
      initiative: STYLE.initiative,
      simplification: STYLE.simplification,
      complexity: STYLE.complexity,
      kingSafety: STYLE.kingSafety,
      material: STYLE.material,
    },
    {
      aggression: 38,
      risk: 35,
      positional: 35,
      tactical: 38,
      defensive: 45,
      initiative: 45,
      simplification: 72,
      complexity: 30,
      kingSafety: 60,
      material: 65,
    },
  );
  assert.equal(STYLE.id, 'christian-hernandez');

  /* The trade preference is a preference: it is the highest dial, but it is a
     number in the same table as everything else, never a rule. */
  const dials = [
    STYLE.aggression,
    STYLE.risk,
    STYLE.positional,
    STYLE.tactical,
    STYLE.defensive,
    STYLE.initiative,
    STYLE.complexity,
    STYLE.kingSafety,
    STYLE.material,
  ];
  assert.equal(STYLE.simplification > Math.max(...dials), true, 'trades are his leaning');
  assert.ok(STYLE.simplification < 100, 'a preference, not an automatic exchange');

  /* Nothing is a speciality: no dial runs to either end of the table. */
  for (const value of [...dials, STYLE.simplification]) {
    assert.ok(value > 20 && value < 80, `${value} stays inside the natural range`);
  }
  assert.ok(STYLE.tactical < 45, 'not a tactical player');
  assert.ok(STYLE.complexity < 40, 'he does not sharpen the position');
  assert.ok((STYLE.openingBias.sharp ?? 0) < 0);
  assert.ok((STYLE.openingBias.developing ?? 0) > 0);
  assert.ok((STYLE.openingBias.solid ?? 0) > 0);
});

test('950 is the strength dial and nothing inflates it', () => {
  assert.equal(STYLE.accuracy, accuracyForElo(950));
  assert.ok(STYLE.accuracy < accuracyForElo(1400), 'no accuracy inflation');
  assert.equal(STYLE.depthCap, undefined, 'no artificial search ceiling');
  assert.equal(STYLE.mistakeChance, undefined, 'the rating curve decides his slips');
  assert.ok(candidateGapForElo(950) > candidateGapForElo(1400));
  assert.ok(blunderChance(950) > blunderChance(1550), 'a 950 misses more than a 1550');

  /* The engine's best move still outranks his trade preference. */
  const italian = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 6';
  const chosen = choosePersonalityMove({
    fen: italian,
    candidates: [
      { uci: 'e1g1', scoreCp: 40, mate: null },
      { uci: 'f3g5', scoreCp: -90, mate: null },
    ],
    style: STYLE,
    elo: 950,
    random: () => 0.9,
  });
  assert.equal(chosen?.uci, 'e1g1');

  /* And a forced mate overrides every tendency. */
  const mate = choosePersonalityMove({
    fen: italian,
    candidates: [
      { uci: 'f3g5', scoreCp: -10, mate: 2 },
      { uci: 'e1g1', scoreCp: 30, mate: null },
    ],
    style: STYLE,
    elo: 950,
    random: () => 0.1,
  });
  assert.equal(mate?.uci, 'f3g5');
});

/* --------------------------- London System --------------------------- */

test('his White repertoire is the London System and nothing deeper', () => {
  assert.ok(ChristiansLondon().length >= 2);
  for (const line of ChristiansLondon()) {
    assert.equal(line.san[0], 'd4', `${line.id} starts 1.d4`);
    assert.ok(line.san.includes('Bf4'), `${line.id} puts the bishop outside the chain`);
    assert.ok(line.san.includes('e3'), `${line.id} supports the centre with e3`);
    assert.ok(line.san.length <= 16, `${line.id} stays a short, basic line`);
    assert.ok(line.id.startsWith('christian-hernandez-london-'));
  }

  assert.deepEqual(
    legalBookMoves(personalityBookFor('christian-hernandez', 'w'), new Chess()).map(
      (move) => move.san,
    ),
    ['d4'],
  );
  const afterD5 = legalBookMoves(
    personalityBookFor('christian-hernandez', 'w'),
    position('d4', 'd5'),
  ).map((move) => move.san);
  assert.ok(afterD5.includes('Bf4'), 'the London bishop comes out');
  assert.ok(afterD5.includes('Nf3'), 'normal knight development');
});

function ChristiansLondon() {
  return CHRISTIAN_HERNANDEZ_REPERTOIRE.asWhite;
}

/* ------------------- no Black repertoire, no leakage ---------------- */

test('he has no Black repertoire at all, against 1.e4 or 1.d4', () => {
  assert.deepEqual(PERSONALITY_REPERTOIRES['christian-hernandez'].asBlack, []);
  assert.equal(personalityBookFor('christian-hernandez', 'b').size, 0, 'no Black book');
  for (const san of [['e4'], ['d4'], ['c4'], ['Nf3'], ['e4', 'e5'], ['d4', 'd5']]) {
    assert.deepEqual(
      legalBookMoves(personalityBookFor('christian-hernandez', 'b'), position(...san)),
      [],
      `no invented answer after ${san.join(' ')}`,
    );
  }

  /* The principle-based King's Indian layer does not run for him either: that
     would be a formal defence sneaking in through the back door. */
  assert.equal(kidPlan(position('d4').fen(), ['d4'], STYLE, 'b'), null);

  assert.equal(isRepertoireId('christian-hernandez'), true);
  assert.equal(personalityBooks('christian-hernandez').b.book.size, 0);
  assert.equal(personalityBooks('christian-hernandez').b.issues.length, 0);
});

test('outside the London he improvises legally and never leaks a colour', async () => {
  const openGame = position('e4', 'e5', 'Nf3', 'Nc6');
  assert.deepEqual(legalBookMoves(personalityBookFor('christian-hernandez', 'w'), openGame), []);

  const chosen = await chooseBotMove({
    game: openGame,
    fen: openGame.fen(),
    history: ['e4', 'e5', 'Nf3', 'Nc6'],
    botColor: 'w',
    style: STYLE,
    elo: 950,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: engineWith([
      { uci: 'f1b5', scoreCp: 25 },
      { uci: 'f1c4', scoreCp: 20 },
      { uci: 'd2d4', scoreCp: 15 },
    ]),
    random: () => 0.5,
  });
  assert.ok(chosen);
  assert.equal(chosen.bookMove, false);
  assertLegal(openGame.fen(), chosen.uci);

  assert.deepEqual(
    legalBookMoves(personalityBookFor('christian-hernandez', 'w'), position('e4')).map(
      (move) => move.san,
    ),
    [],
    'his White moves do not become Black answers',
  );
});

test('his book compiles, stays legal and borrows nothing from another opponent', () => {
  assert.deepEqual(repertoireIssues().filter((entry) => entry.issues.length > 0), []);
  assert.ok(repertoireIssues().some((entry) => entry.id === 'christian-hernandez'));

  for (const color of ['w', 'b'] as const) {
    for (const [key, moves] of personalityBooks('christian-hernandez')[color].book) {
      assert.equal(key.split(' ')[1], color, `${color} book only holds ${color} turns`);
      for (const entry of moves) {
        assertLegal(`${key} - 0 1`, entry.uci);
        assert.ok(entry.lineIds.every((id) => id.startsWith('christian-hernandez-')));
      }
    }
  }

  const foreign = Object.entries(PERSONALITY_REPERTOIRES)
    .filter(([id]) => id !== 'christian-hernandez')
    .flatMap(([, repertoire]) => [...repertoire.asWhite, ...repertoire.asBlack]);
  for (const line of [...CHRISTIAN_HERNANDEZ_REPERTOIRE.asWhite, ...CHRISTIAN_HERNANDEZ_REPERTOIRE.asBlack]) {
    assert.equal(foreign.includes(line), false, `${line.id} is a line of his own`);
    assert.equal(
      foreign.some((other) => other.san.join(' ') === line.san.join(' ')),
      false,
      `${line.id} is not copied from another opponent`,
    );
  }
});

/* ---------------------------- dialogue ------------------------------- */

test('his voice is relaxed, friendly and free of engine or theory talk', () => {
  const bank = DIALOGUE_BANKS['christian-hernandez'];
  assert.deepEqual(
    Object.keys(bank).sort(),
    Object.keys(DIALOGUE_BANKS.freshman).sort(),
    'every dialogue event has something to say',
  );
  for (const lines of Object.values(bank)) {
    assert.ok(lines.length > 0);
    for (const line of lines) {
      assert.ok(line.length > 0 && line.length <= 80, line);
      assert.ok(!/[0-9]/.test(line), line);
      assert.ok(
        !/\b(eval|evaluation|centipawn|engine|stockfish|depth|variant|pv|score)\b/i.test(line),
        `no engine vocabulary: ${line}`,
      );
      assert.ok(
        !/\b(gambit|sicilian|london|fianchetto|zugzwang|variation|theory|kings? indian)\b/i.test(line),
        `no theory talk: ${line}`,
      );
    }
  }

  /* The two phrases he is known for, used sparingly rather than as a reflex. */
  const all = Object.values(bank).flat();
  assert.ok(all.includes('Gracias.'), 'his thank-you is there');
  assert.ok(all.includes('Don’t even trip dawg.'), 'his reassurance is there');
  assert.equal(all.filter((line) => line.includes('Gracias')).length, 1, 'said once, not every move');
  assert.equal(
    all.filter((line) => /trip dawg/i.test(line)).length,
    1,
    'and the other one is not a catchphrase machine either',
  );

  /* Calm, not shouty: no all-caps lines and hardly any exclamation marks. */
  assert.equal(all.filter((line) => line === line.toUpperCase()).length, 0);
  assert.ok(all.filter((line) => line.includes('!')).length <= 2, 'unbothered, not shouting');

  /* And it is not somebody else's bank. */
  assert.notEqual(bank, DIALOGUE_BANKS.freshman);
  assert.notEqual(bank, DIALOGUE_BANKS.bryan);
  assert.notEqual(bank, DIALOGUE_BANKS['alex-tang']);
  assert.notEqual(bank.mistake, DIALOGUE_BANKS.emmanuel.mistake);
});

test('his lines respect the shared gap, the repeat gap and never repeat', () => {
  const state = createDialogueState();
  assert.ok(maybeReact('christian-hernandez', 'strong', { ply: 20, state, random: () => 0 }));

  /* The shared three-ply gap: anything ordinary waits for it. */
  assert.equal(
    maybeReact('christian-hernandez', 'mistake', { ply: 21, state, random: () => 0 }),
    null,
  );
  assert.ok(maybeReact('christian-hernandez', 'mistake', { ply: 23, state, random: () => 0 }));

  /* The same event waits for the longer repeat gap. */
  assert.equal(maybeReact('christian-hernandez', 'strong', { ply: 25, state, random: () => 0 }), null);
  assert.ok(maybeReact('christian-hernandez', 'strong', { ply: 28, state, random: () => 0 }));

  /* Once-per-game remarks stay once per game. */
  const once = createDialogueState();
  assert.ok(maybeReact('christian-hernandez', 'losing', { ply: 10, state: once, random: () => 0 }));
  assert.equal(
    maybeReact('christian-hernandez', 'losing', { ply: 60, state: once, random: () => 0 }),
    null,
  );

  /* A used line is not chosen again while the bank lasts. */
  const fresh = createDialogueState();
  const seen = new Set<string>();
  let ply = 40;
  while (seen.size < DIALOGUE_BANKS['christian-hernandez'].strong.length) {
    ply += 20;
    const line = maybeReact('christian-hernandez', 'strong', { ply, state: fresh, random: () => 0.99 });
    assert.ok(line);
    assert.equal(seen.has(line.text), false, 'a line is not repeated while unused ones remain');
    seen.add(line.text);
  }

  /* A finished game always gets a line. */
  const closing = createDialogueState();
  const loss = maybeReact('christian-hernandez', 'loss', {
    ply: 2,
    state: closing,
    force: true,
    random: () => 0,
  });
  assert.ok(loss);
  assert.ok(DIALOGUE_BANKS['christian-hernandez'].loss.includes(loss.text));
});

/* --------------------- selection and a whole game -------------------- */

test('Normal Play: his first move comes from the London book with no search', async () => {
  const game = new Chess();
  const chosen = await chooseBotMove({
    game,
    fen: game.fen(),
    history: [],
    botColor: 'w',
    style: STYLE,
    elo: 950,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: noEngine,
    random: () => 0.99,
  });
  assert.equal(chosen?.uci, 'd2d4');
  assert.equal(chosen?.bookMove, true);
  assert.equal(chosen?.source, 'repertoire');
  assert.equal(chosen?.plan?.reason, 'book');
});

test('as Black he has no book move, so natural selection plays the position', async () => {
  const game = position('e4');
  const chosen = await chooseBotMove({
    game,
    fen: game.fen(),
    history: ['e4'],
    botColor: 'b',
    style: STYLE,
    elo: 950,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: engineWith([
      { uci: 'e7e5', scoreCp: 25 },
      { uci: 'c7c5', scoreCp: 18 },
      { uci: 'g8f6', scoreCp: 12 },
    ]),
    random: () => 0.5,
  });
  assert.ok(chosen);
  assert.equal(chosen.bookMove, false);
  assert.equal(chosen.source, 'engine');
  assertLegal(game.fen(), chosen.uci);
});

test('he can play a complete game from the London, legally, move after move', async () => {
  const game = new Chess();
  const engine = legalMoveEngine();
  const history: string[] = [];
  let bookPlies = 0;

  for (let ply = 0; ply < 80 && !game.isGameOver(); ply += 1) {
    const chosen = await chooseBotMove({
      game,
      fen: game.fen(),
      history,
      botColor: game.turn(),
      style: STYLE,
      elo: 950,
      clockMs: null,
      incrementMs: 0,
      initialMs: 0,
      engine,
      random: () => 0.7,
    });
    assert.ok(chosen, `ply ${ply} produced a move`);
    assertLegal(game.fen(), chosen.uci);
    if (chosen.bookMove) bookPlies += 1;
    const move = game.move({
      from: chosen.uci.slice(0, 2) as never,
      to: chosen.uci.slice(2, 4) as never,
      promotion: chosen.uci.length > 4 ? chosen.uci.slice(4, 5) : undefined,
    });
    history.push(move.san);
  }

  assert.ok(history.length >= 10, 'the game actually got going');
  /* Both seats are his, so Black leaves the London lines after one move and the
     book hands over to natural selection. White's own first move is a book move. */
  assert.ok(bookPlies >= 1, 'the London book covers the start of a real game');
  assert.equal(history[0], 'd4', 'White opens his own way');
  assert.equal(game.isGameOver() || history.length === 80, true);
});

test('he thinks for a quick, relaxed beat in every phase', () => {
  for (const fen of [
    new Chess().fen(),
    position('d4', 'd5', 'Bf4', 'Nf6', 'e3', 'c5').fen(),
    '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',
  ]) {
    const plan = computeThinkingPlan({
      fen,
      style: STYLE,
      clockMs: 300_000,
      incrementMs: 0,
      initialMs: 300_000,
      ply: 10,
      bookMove: false,
    });
    assert.ok(plan.searchMs > 0);
    assert.ok(plan.budgetMs <= 22_000);
    assert.ok(plan.deliberationMs >= 1000 && plan.deliberationMs <= 6000);
  }
});

test('a saved game and its PGN keep his name, subtext, colour and rating', () => {
  const pgn = buildPgn(
    {
      white: opponentFullName(CHRISTIAN),
      black: opponentFullName(getOpponent('edward')!),
      result: '1-0',
      date: Date.UTC(2026, 10, 21),
      timeControl: '300+0',
      whiteElo: CHRISTIAN.elo,
      blackElo: getOpponent('edward')!.elo,
      event: 'Bot vs. Bot',
    },
    ['d4', 'd5', 'Bf4', 'Nf6', 'e3'],
  );
  assert.match(pgn, /\[White "Christian Hernandez \(Senior\)"\]/);
  assert.match(pgn, /\[WhiteElo "950"\]/);

  const profile = profileFromRecord({
    opponent_id: CHRISTIAN.id,
    opponent_name: opponentFullName(CHRISTIAN),
    opponent_elo: CHRISTIAN.elo,
    opponent_kind: CHRISTIAN.kind,
  });
  assert.equal(profile.id, 'christian-hernandez');
  assert.equal(profile.name, 'Christian Hernandez');
  assert.equal(profile.title, 'Senior');
  assert.equal(profile.elo, 950);
  assert.equal(profile.category, 'beginner');
  assert.equal(opponentMeta(profile), 'Senior · 950 Elo');
});

/* ---------------------------- regressions --------------------------- */

test('every other opponent and the General Bot are untouched', () => {
  assert.equal(PERSONALITY_OPPONENTS.length, 22);
  assert.equal(ALL_OPPONENTS.length, 23);

  const expected: Array<[string, string, string, number, string]> = [
    ['emmanuel', 'Emmanuel Domah', 'Senior', 150, 'beginner'],
    ['edward', 'Edward Chen', 'Senior', 800, 'beginner'],
    ['faadi', 'Faadi Granillo Garcia', 'Prime', 700, 'beginner'],
    ['alex-tang', 'Alex Tang', 'Sophomore', 1100, 'novice'],
    ['freshman', 'Johnfer Quispe', 'Freshman', 1250, 'novice'],
    ['sophia-kuan', 'Sophia Kuan', 'Senior', 1300, 'novice'],
    ['bryan-widjaja', 'Bryan Widjaja', 'Prime', 1400, 'intermediate'],
    ['bryan', 'Bryan Martinez-Hernandez', 'Junior', 1800, 'varsity'],
    ['senior', 'Johnfer Quispe', 'Senior', 2000, 'varsity'],
    ['brandon', 'Brandon Tran', 'Prime', 2350, 'big-4'],
  ];
  for (const [id, name, title, elo, category] of expected) {
    const opponent = getOpponent(id);
    assert.ok(opponent, `${id} is still on the roster`);
    assert.equal(opponent.name, name);
    assert.equal(opponent.title, title);
    assert.equal(opponent.elo, elo);
    assert.equal(opponent.category, category);
    assert.notEqual(opponent.id, CHRISTIAN.id);
  }
  assert.equal(GENERAL_BOT.id, 'general');
  assert.equal(GENERAL_BOT.elo, 1500);
  assert.equal(GENERAL_BOT.usesRepertoire, false);

  /* Other profiles' anchors are exactly as they were. */
  assert.equal(PERSONALITY_STYLES.freshman.defensive, 85);
  assert.equal(PERSONALITY_STYLES.edward.depthCap, 10);
  assert.equal(PERSONALITY_STYLES.emmanuel.mistakeChance, 0.55);
  assert.equal(PERSONALITY_STYLES['bryan-widjaja'].defensive, 98);
  assert.equal(PERSONALITY_STYLES['alex-tang'].aggression, 35);

  /* Their books still build, and none of them gained his lines. */
  for (const id of ['freshman', 'edward', 'alex-tang', 'bryan-widjaja', 'sophia-kuan']) {
    assert.ok(
      personalityBookFor(id, 'w').size + personalityBookFor(id, 'b').size > 0,
      `${id} still has a book`,
    );
  }
  assert.equal(personalityBookFor('emmanuel', 'w').size, 0, 'the repertoire-less card is still empty');
});
