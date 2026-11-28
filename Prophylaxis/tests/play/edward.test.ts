/**
 * Edward Chen (Senior) — the principled beginner, 800.
 *
 * Covers his catalogue entry and card identity, the tendency table, what 800
 * means for his move choice and calculation, his small Ruy Lopez / ...e5 / ...d5
 * repertoire, the low-familiarity recall that is separate from both his rating
 * and the engine, the stoic dialogue bank and its quiet cadence, the thinking
 * beat, bot-vs-bot book play, and the saved-game/PGN identity — plus the
 * regressions that keep the other twelve opponents exactly as they were.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { Chess } from 'chess.js';
import {
  ALL_OPPONENTS,
  GENERAL_BOT,
  OPPONENT_CATEGORIES,
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
  personalityBookFor,
  personalityBooks,
  repertoireIssues,
} from '../../src/play/personality/repertoires/index.ts';
import { legalBookMoves } from '../../src/play/personality/repertoires/book.ts';
import {
  EDWARD_FAMILIARITY,
  chooseEdwardBookMove,
  edwardAllowsMistake,
  edwardForgetChance,
} from '../../src/play/personality/edward.ts';
import { ninaForgetChance } from '../../src/play/personality/nina.ts';
import { chooseBotMove } from '../../src/play/personality/chooseMove.ts';
import {
  candidateGapForElo,
  choosePersonalityMove,
} from '../../src/play/personality/engine.ts';
import { computeThinkingPlan } from '../../src/play/personality/thinking.ts';
import { blunderChance, depthForElo } from '../../src/play/strength.ts';
import { isBlatantMaterialBlunder } from '../../src/play/blunders.ts';
import { buildPgn } from '../../src/play/pgn.ts';
import { opponentFullName as fullName } from '../../src/play/opponents.ts';
import type { PlayedGameRecord } from '../../src/play/types.ts';
import type { StockfishController } from '../../src/engine/useStockfish.ts';

const EDWARD = getOpponent('edward');
const STYLE = styleFor('edward', 800) as PersonalityStyle;
const REPERTOIRE = PERSONALITY_REPERTOIRES.edward;

/** Italian Game, White to move: castle (king safety) or send the knight to g5. */
const QUIET_OR_ACTIVE = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 6';

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

/** Book-first selection must never need a search. */
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

/** Engine stub for the positions where he has to improvise. */
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

/* ------------------------------ registration ------------------------------ */

test('Edward Chen is on the roster as Senior, 800, in the Beginner band', () => {
  assert.ok(EDWARD);
  assert.equal(EDWARD.id, 'edward', 'his own stable id, never a re-used “senior”');
  assert.equal(EDWARD.kind, 'personality');
  assert.equal(EDWARD.name, 'Edward Chen');
  assert.equal(EDWARD.title, 'Senior', 'the subtext is exactly Senior');
  assert.equal(EDWARD.elo, 800);
  assert.equal(EDWARD.category, 'beginner');
  assert.equal(EDWARD.initials, 'EC');
  assert.equal(EDWARD.usesRepertoire, false);

  /* Two display fields, never one combined name. */
  assert.doesNotMatch(EDWARD.name, /\(/, 'the name carries no parenthetical suffix');
  assert.doesNotMatch(EDWARD.name, /senior/i, 'the subtext lives in its own field');
  assert.equal(opponentStage(EDWARD), 'Senior');
  assert.equal(opponentMeta(EDWARD), 'Senior · 800 Elo');
  assert.equal(opponentFullName(EDWARD), 'Edward Chen (Senior)');
  assert.match(EDWARD.style, /tunnel vision|potential/i);
  assert.ok(EDWARD.style.length > 0);
});

test('his portrait is his own file, with the monogram kept as the fallback', () => {
  assert.equal(EDWARD.portraitPath, 'opponents/edward.webp');
  assert.equal(EDWARD.initials, 'EC');
  assert.equal(fs.existsSync('public/opponents/edward.webp'), true);
  assert.notEqual(EDWARD.portraitPath, getOpponent('senior')?.portraitPath);
});

test('his “Senior” is not Johnfer Quispe’s Senior', () => {
  const johnfer = getOpponent('senior');
  assert.ok(johnfer);
  assert.equal(johnfer.name, 'Johnfer Quispe');
  assert.equal(johnfer.elo, 2000);
  assert.equal(johnfer.category, 'varsity');
  assert.notEqual(johnfer.id, EDWARD.id);
  assert.notEqual(opponentFullName(johnfer), opponentFullName(EDWARD));
  /* The shared word is a stage, and the full labels still tell them apart. */
  assert.equal(opponentStage(johnfer), 'Senior');
  assert.equal(
    profileFromRecord({
      opponent_id: 'senior',
      opponent_name: 'Johnfer Quispe (Senior)',
      opponent_elo: 2000,
      opponent_kind: 'personality',
    }).name,
    'Johnfer Quispe',
  );
  assert.equal(
    profileFromRecord({
      opponent_id: 'edward',
      opponent_name: 'Edward Chen (Senior)',
      opponent_elo: 800,
      opponent_kind: 'personality',
    }).title,
    'Senior',
  );
});

test('the roster gains him once, without disturbing any existing id', () => {
  assert.equal(PERSONALITY_OPPONENTS.length, 23);
  assert.equal(ALL_OPPONENTS.length, 24, 'twenty-three personalities plus the General Bot');
  assert.equal(
    PERSONALITY_OPPONENTS.filter((opponent) => opponent.id === 'edward').length,
    1,
  );
  assert.equal(new Set(ALL_OPPONENTS.map((opponent) => opponent.id)).size, 24);
  assert.equal(
    new Set(PERSONALITY_OPPONENTS.map((opponent) => opponentFullName(opponent))).size,
    23,
    'saved games and PGN headers can always tell two opponents apart',
  );

  /* Every pre-existing entry keeps its id, rating, stage and group. */
  const expected: Array<[string, string, string, number, string]> = [
    ['freshman', 'Johnfer Quispe', 'Freshman', 1250, 'novice'],
    ['sophomore', 'Johnfer Quispe', 'Sophomore', 1450, 'intermediate'],
    ['faadi', 'Faadi Granillo Garcia', 'Prime', 700, 'beginner'],
    ['nina-freshman', 'Nina Yang', 'Freshman', 1200, 'novice'],
    ['bryan-sophomore', 'Bryan Martinez-Hernandez', 'Sophomore', 1350, 'intermediate'],
    ['nina', 'Nina Yang', 'Sophomore', 1550, 'intermediate'],
    ['bryan', 'Bryan Martinez-Hernandez', 'Junior', 1800, 'varsity'],
    ['senior', 'Johnfer Quispe', 'Senior', 2000, 'varsity'],
    ['brandon', 'Brandon Tran', 'Prime', 2350, 'big-4'],
    ['junior', 'Johnfer Quispe', 'Junior', 2150, 'big-4'],
    ['bryan-prime', 'Bryan Martinez-Hernandez', 'Prime', 2000, 'big-4'],
  ];
  for (const [id, name, title, elo, category] of expected) {
    const opponent = getOpponent(id);
    assert.ok(opponent, `${id} is still on the roster`);
    assert.equal(opponent.name, name);
    assert.equal(opponent.title, title);
    assert.equal(opponent.elo, elo);
    assert.equal(opponent.category, category);
  }
  assert.equal(GENERAL_BOT.id, 'general');
  assert.equal(GENERAL_BOT.usesRepertoire, false);
});

test('he is selectable in the Beginner section, which holds the lowest ratings', () => {
  assert.ok(OPPONENT_CATEGORIES.some((group) => group.id === 'beginner'));
  const beginners = PERSONALITY_OPPONENTS.filter(
    (opponent) => opponent.category === 'beginner',
  );
  assert.deepEqual(
    beginners.map((opponent) => opponent.id),
    ['emmanuel', 'edward', 'faadi', 'christian-hernandez'],
  );
  assert.ok(beginners.every((opponent) => opponent.elo <= 1000));
  /* Emmanuel is the weakest card now, and Edward is no longer the top of the
     band: Christian Hernandez's 950 is. */
  assert.ok(EDWARD.elo > getOpponent('emmanuel')!.elo);
  assert.equal(
    Math.max(...beginners.map((opponent) => opponent.elo)),
    getOpponent('christian-hernandez')!.elo,
    'the strongest card of the Beginner band',
  );
});

/* --------------------------- personality shape ---------------------------- */

test('his tendency table is the principled beginner as specified', () => {
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
      aggression: 25,
      risk: 20,
      positional: 30,
      tactical: 20,
      defensive: 45,
      initiative: 25,
      simplification: 65,
      complexity: 20,
      kingSafety: 65,
      material: 75,
    },
  );
  assert.equal(STYLE.id, 'edward');
  assert.equal(STYLE.accuracy, accuracyForElo(STYLE.planElo ?? 800));
  assert.equal(STYLE.sacrifice, 10, 'he does not give material away on purpose');
  assert.ok((STYLE.openingBias.developing ?? 0) > 0, 'developing is what he likes');
  assert.ok((STYLE.openingBias.sharp ?? 0) < 0, 'and complications are what he avoids');
});

test('he is not a copy of any other beginner, Bryan Sophomore included', () => {
  const bryan = PERSONALITY_STYLES['bryan-sophomore'];
  const faadi = PERSONALITY_STYLES.faadi;
  const freshman = PERSONALITY_STYLES.freshman;
  for (const other of [bryan, faadi, freshman]) {
    assert.notDeepEqual(
      [STYLE.aggression, STYLE.risk, STYLE.tactical, STYLE.material],
      [other.aggression, other.risk, other.tactical, other.material],
      `${other.id} is a different character`,
    );
  }
  /* Defence is Bryan's whole idea; Edward is simply a cautious beginner. */
  assert.ok(STYLE.defensive < bryan.defensive);
  assert.ok(STYLE.kingSafety < bryan.kingSafety);
  assert.ok(STYLE.material < bryan.material);
  /* And his calculation ceiling is his own. */
  assert.equal(STYLE.depthCap, 10);
  assert.ok((STYLE.depthCap ?? 0) < depthForElo(800));
});

test('equal moves go to the principled one: develop and keep the king safe', () => {
  const choice = choosePersonalityMove({
    fen: QUIET_OR_ACTIVE,
    candidates: [
      { uci: 'e1g1', scoreCp: 15, mate: null },
      { uci: 'f3g5', scoreCp: 15, mate: null },
    ],
    style: STYLE,
    elo: 800,
    random: () => 0.9,
  });
  assert.equal(choice?.uci, 'e1g1');

  /* The same tie splits the table: Brandon takes the sortie. */
  const brandon = choosePersonalityMove({
    fen: QUIET_OR_ACTIVE,
    candidates: [
      { uci: 'e1g1', scoreCp: 15, mate: null },
      { uci: 'f3g5', scoreCp: 15, mate: null },
    ],
    style: styleFor('brandon', 2350) as PersonalityStyle,
    elo: 2350,
    random: () => 0.9,
  });
  assert.equal(brandon?.uci, 'f3g5');
});

test('taste cannot outvote a clearly better move, and a mate is still a mate', () => {
  const sane = choosePersonalityMove({
    fen: QUIET_OR_ACTIVE,
    candidates: [
      { uci: 'e1g1', scoreCp: 15, mate: null },
      { uci: 'f3g5', scoreCp: -120, mate: null },
    ],
    style: STYLE,
    elo: 800,
    random: () => 0.9,
  });
  assert.equal(sane?.uci, 'e1g1');

  const mate = choosePersonalityMove({
    fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',
    candidates: [
      { uci: 'a1a8', scoreCp: 0, mate: 1 },
      { uci: 'a1a7', scoreCp: 400, mate: null },
    ],
    style: STYLE,
    elo: 800,
  });
  assert.equal(mate?.uci, 'a1a8');
});

test('every move he chooses is legal and comes from the engine list', () => {
  const fen = position('e4', 'e5', 'Nf3', 'Nc6').fen();
  const candidates = [
    { uci: 'f1b5', scoreCp: 30, mate: null },
    { uci: 'f1c4', scoreCp: 25, mate: null },
    { uci: 'd2d4', scoreCp: 20, mate: null },
    { uci: 'b1c3', scoreCp: 20, mate: null },
  ];
  for (let run = 0; run < 8; run += 1) {
    const choice = choosePersonalityMove({
      fen,
      candidates,
      style: STYLE,
      elo: 800,
      random: () => run / 8,
    });
    assert.ok(choice);
    assert.ok(candidates.some((candidate) => candidate.uci === choice.uci));
    assertLegal(fen, choice.uci);
  }
});

test('800 is the strength dial, and it is beginner-level', () => {
  assert.equal(candidateGapForElo(800), 140);
  assert.ok(candidateGapForElo(800) > candidateGapForElo(1450), 'wider than the Sophomore');
  assert.ok(candidateGapForElo(800) > candidateGapForElo(2000));

  assert.equal(blunderChance(800), 0.45, 'one deliberate slip every other move on the curve');
  assert.ok(blunderChance(800) > blunderChance(1100));
  assert.ok(blunderChance(800) > blunderChance(1250));

  /* But a slip never hangs a visible piece: his errors are oversights, not
     handed-over material. */
  const hangingQueen = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
  assert.equal(edwardAllowsMistake(hangingQueen, 'a2a3', STYLE), true);
  /* The guard is exactly the static material check, applied to him only. */
  const middlegame = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 6';
  for (const uci of ['e1g1', 'f3g5', 'c4f7', 'c3d5']) {
    assert.equal(
      edwardAllowsMistake(middlegame, uci, STYLE),
      !isBlatantMaterialBlunder(middlegame, uci),
      `the guard decides ${uci} for him`,
    );
    assert.equal(
      edwardAllowsMistake(middlegame, uci, styleFor('faadi', 1100) as PersonalityStyle),
      true,
      'and never touches another character',
    );
  }
});

/* ------------------------------- repertoire ------------------------------- */

test('his White repertoire is the Ruy Lopez and nothing deeper', () => {
  assert.equal(REPERTOIRE.asWhite.length, 3);
  for (const line of REPERTOIRE.asWhite) {
    assert.deepEqual(line.san.slice(0, 5), ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'], line.id);
    assert.ok(line.san.length <= 17, `${line.id} stays a short, principle-based line`);
  }
  const start = new Chess();
  assert.deepEqual(
    legalBookMoves(personalityBookFor('edward', 'w'), start).map((move) => move.san),
    ['e4'],
  );
  const open = position('e4', 'e5', 'Nf3', 'Nc6');
  assert.deepEqual(
    legalBookMoves(personalityBookFor('edward', 'w'), open).map((move) => move.san),
    ['Bb5'],
  );
});

test('he answers 1.e4 with 1...e5 and 1.d4 with 1...d5', () => {
  const e4 = position('e4');
  const vsE4 = legalBookMoves(personalityBookFor('edward', 'b'), e4).map((move) => move.san);
  assert.deepEqual(vsE4, ['e5']);

  const d4 = position('d4');
  const vsD4 = legalBookMoves(personalityBookFor('edward', 'b'), d4).map((move) => move.san);
  assert.deepEqual(vsD4, ['d5']);

  /* The same answer through a different move order, because the book is keyed
     by position rather than by line. */
  const reti = position('Nf3');
  assert.ok(
    legalBookMoves(personalityBookFor('edward', 'b'), reti).some((move) => move.san === 'd5'),
  );
  /* Against 1.c4 his prepared answer is a normal queen’s-pawn set-up, not a
     claim that every first move transposes. */
  const english = position('c4');
  const vsEnglish = legalBookMoves(personalityBookFor('edward', 'b'), english).map(
    (move) => move.san,
  );
  assert.ok(vsEnglish.length > 0);
  assert.ok(vsEnglish.includes('e6'));
});

test('his book compiles, stays legal, and borrows nothing from another opponent', () => {
  assert.deepEqual(repertoireIssues().filter((entry) => entry.issues.length > 0), []);
  assert.ok(repertoireIssues().some((entry) => entry.id === 'edward'));

  for (const color of ['w', 'b'] as const) {
    const moves = [...personalityBooks('edward')[color].book.entries()];
    assert.ok(moves.length > 0);
    for (const [key, entries] of moves) {
      const turn = key.split(' ')[1];
      assert.equal(turn, color, `${color} book only holds ${color} turns`);
      const fen = `${key} - 0 1`;
      for (const entry of entries) {
        assertLegal(fen, entry.uci);
        assert.ok(entry.lineIds.every((id) => id.startsWith('edward-')));
      }
    }
  }

  const mine = new Set(
    [...REPERTOIRE.asWhite, ...REPERTOIRE.asBlack].map((line) => line.san.join(' ')),
  );
  const others = Object.entries(PERSONALITY_REPERTOIRES)
    .filter(([id]) => id !== 'edward')
    .flatMap(([, repertoire]) =>
      [...repertoire.asWhite, ...repertoire.asBlack].map((line) => line.san.join(' ')),
    );
  for (const san of mine) {
    assert.equal(others.includes(san), false, 'no line is copied from another opponent');
  }
  const ids = [...REPERTOIRE.asWhite, ...REPERTOIRE.asBlack].map((line) => line.id);
  assert.equal(new Set(ids).size, ids.length, 'unique line ids');
});

/* ---------------------------- low familiarity ----------------------------- */

test('low opening familiarity is its own property, separate from Elo', () => {
  const move = legalBookMoves(personalityBookFor('edward', 'w'), new Chess())[0];
  assert.ok(move);

  /* It is high from the very first move... */
  const first = edwardForgetChance(move, 0);
  assert.ok(first >= 0.15, `first-move recall ${first}`);
  assert.ok(first < 0.3, 'but the repertoire still exists');
  assert.equal(first, EDWARD_FAMILIARITY.base);

  /* ...and it grows with the depth of the line, up to a cap. */
  assert.ok(edwardForgetChance(move, 10) > first);
  assert.ok(edwardForgetChance(move, 40) <= EDWARD_FAMILIARITY.cap);

  /* Far higher than the other character with a recall curve, and unrelated to
     the rating: the same 800 style would forget just as much at any Elo. */
  assert.ok(first > ninaForgetChance(move, 0) * 5);
  const styleAt1400 = styleFor('edward', 1400) as PersonalityStyle;
  assert.equal(styleAt1400.depthCap, STYLE.depthCap, 'the ceiling is his, not the rating’s');
  assert.equal(styleAt1400.accuracy === STYLE.accuracy, false, 'accuracy still tracks Elo');
});

test('he forgets a prepared move without corrupting the book or the position', () => {
  const start = new Chess();
  const moves = legalBookMoves(personalityBookFor('edward', 'w'), start);
  assert.ok(moves.length > 0);

  const forgotten = chooseEdwardBookMove({
    moves,
    style: STYLE,
    ply: 0,
    random: () => 0.01,
  });
  assert.equal(forgotten.move, null);
  assert.equal(forgotten.forgotten, true);

  const recalled = chooseEdwardBookMove({
    moves,
    style: STYLE,
    ply: 0,
    random: () => 0.99,
  });
  assert.equal(recalled.move?.san, 'e4');
  assert.equal(recalled.forgotten, false);

  /* A forgotten ply does not end his knowledge for the game. */
  const again = chooseEdwardBookMove({
    moves,
    style: STYLE,
    ply: 2,
    random: () => 0.99,
  });
  assert.equal(again.move?.san, 'e4');
});

test('outside his short repertoire he improvises with normal 800 play', () => {
  /* The Italian after 3.Bc4 is not one of his Ruy Lopez lines. */
  const italian = position('e4', 'e5', 'Nf3', 'Nc6', 'Bc4');
  assert.deepEqual(
    legalBookMoves(personalityBookFor('edward', 'w'), italian).map((move) => move.san),
    [],
  );

  /* A first move he never prepared leaves nothing to recall. */
  assert.deepEqual(
    legalBookMoves(personalityBookFor('edward', 'w'), position()).length > 0,
    true,
  );
  const afterA4 = position('a4');
  assert.deepEqual(
    legalBookMoves(personalityBookFor('edward', 'w'), afterA4).map((move) => move.san),
    [],
  );
});

/* -------------------------------- bot moves ------------------------------- */

test('as White he plays 1.e4 from the book, with no search at all', async () => {
  const game = new Chess();
  const chosen = await chooseBotMove({
    game,
    fen: game.fen(),
    history: [],
    botColor: 'w',
    style: STYLE,
    elo: 800,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: noEngine,
    random: () => 0.99,
  });
  assert.equal(chosen?.uci, 'e2e4');
  assert.equal(chosen?.bookMove, true);
  assert.equal(chosen?.source, 'repertoire');
});

test('as Black he answers 1.e4 with ...e5 and 1.d4 with ...d5', async () => {
  const e4 = position('e4');
  const open = await chooseBotMove({
    game: e4,
    fen: e4.fen(),
    history: ['e4'],
    botColor: 'b',
    style: STYLE,
    elo: 800,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: noEngine,
    random: () => 0.99,
  });
  assert.equal(open?.uci, 'e7e5');

  const d4 = position('d4');
  const closed = await chooseBotMove({
    game: d4,
    fen: d4.fen(),
    history: ['d4'],
    botColor: 'b',
    style: STYLE,
    elo: 800,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: noEngine,
    random: () => 0.99,
  });
  assert.equal(closed?.uci, 'd7d5');
});

test('a forgotten opening move is a deviation: normal play, still a legal move', async () => {
  const game = position('e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6');
  const chosen = await chooseBotMove({
    game,
    fen: game.fen(),
    history: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'],
    botColor: 'w',
    style: STYLE,
    /* Six plies of theory need a rating whose window still reaches them: the
       shared cap is four plies at 1000 and below (see `theory.ts`). */
    elo: 1600,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: engineWith([
      { uci: 'b5a4', scoreCp: 25 },
      { uci: 'b5c6', scoreCp: 10 },
      { uci: 'e1g1', scoreCp: 0 },
      { uci: 'd2d3', scoreCp: -10 },
      { uci: 'b1c3', scoreCp: -20 },
    ]),
    /* 0 forgets on the roll, then the picker still has randomness to spend. */
    random: () => 0,
  });
  assert.ok(chosen);
  assert.equal(chosen.bookMove, false, 'he did not play the prepared move');
  assert.equal(chosen.forgotten, true, 'the caller is told this was a lost line');
  assertLegal(game.fen(), chosen.uci);
});

/* -------------------------------- dialogue -------------------------------- */

test('his voice is stoic and short, and covers every event', () => {
  const bank = DIALOGUE_BANKS.edward;
  assert.deepEqual(
    Object.keys(bank).sort(),
    Object.keys(DIALOGUE_BANKS.freshman).sort(),
    'every dialogue event has something to say',
  );
  for (const lines of Object.values(bank)) {
    assert.ok(lines.length > 0);
  }

  const spoken = Object.values(bank).flat().join(' | ');
  for (const line of [
    'Oh frick.',
    'Oh shoot.',
    'I messed up.',
    'Hmm.',
    'I think this is okay.',
    "That wasn't good.",
    "Okay, let's see.",
    "I didn't expect that.",
    'It is fine.',
  ]) {
    assert.ok(spoken.includes(line), `missing his voice: ${line}`);
  }

  for (const line of Object.values(bank).flat()) {
    assert.ok(line.length > 0 && line.length <= 60, line);
    assert.ok(!/[0-9]/.test(line), line);
    assert.ok(!/\b(eval|centipawn|engine|stockfish|depth|blunder)\b/i.test(line), line);
  }
});

test('he is composed, not Bryan-Sophomore hesitant or Faadi loud', () => {
  const bank = DIALOGUE_BANKS.edward;
  const bryan = DIALOGUE_BANKS['bryan-sophomore'];
  const faadi = DIALOGUE_BANKS.faadi;
  assert.notEqual(bank, bryan);
  assert.notEqual(bank, faadi);

  const mine = Object.values(bank).flat().join(' ').toLowerCase();
  for (const slang of ['nah', 'lowkey', 'chilling', 'walahi', 'chat', 'bro']) {
    assert.equal(mine.includes(slang), false, `no slang borrowed from another character: ${slang}`);
  }
  /* No cocky or sarcastic register either. */
  assert.doesNotMatch(mine, /easy|obviously|of course|too good|you got lucky/i);

  /* A loss is accepted, not argued about. */
  for (const line of bank.loss) {
    assert.ok(!line.includes('!'), line);
    assert.doesNotMatch(line, /unfair|lucky|you cheated|whatever|stupid/i);
  }
});

test('he talks often: a short gap and no repeated line', () => {
  const state = createDialogueState();
  const first = maybeReact('edward', 'mistake', { ply: 20, state, random: () => 0 });
  assert.ok(first);

  /* Two plies later he is still quiet — his gap is two full moves. */
  assert.equal(maybeReact('edward', 'defense', { ply: 22, state, random: () => 0 }), null);
  /* Past the gap, a different event can speak. */
  assert.ok(maybeReact('edward', 'defense', { ply: 25, state, random: () => 0 }));
  /* The same event waits longer still. */
  assert.equal(maybeReact('edward', 'mistake', { ply: 29, state, random: () => 0 }), null);
  assert.ok(maybeReact('edward', 'mistake', { ply: 31, state, random: () => 0 }));

  /* No immediate repeats while the bank lasts. */
  const fresh = createDialogueState();
  const seen = new Set<string>();
  let ply = 40;
  while (seen.size < DIALOGUE_BANKS.edward.mistake.length) {
    ply += 40;
    const line = maybeReact('edward', 'mistake', { ply, state: fresh, random: () => 0.99 });
    assert.ok(line);
    assert.equal(seen.has(line.text), false, 'a line is not repeated until the bank runs out');
    seen.add(line.text);
  }
});

test('the end of a game always gets one of his lines, win or loss', () => {
  const state = createDialogueState();
  const loss = maybeReact('edward', 'loss', { ply: 2, state, force: true, random: () => 0 });
  const win = maybeReact('edward', 'win', { ply: 3, state, force: true, random: () => 0 });
  assert.ok(loss);
  assert.ok(win);
  assert.ok(DIALOGUE_BANKS.edward.loss.includes(loss.text));
  assert.ok(DIALOGUE_BANKS.edward.win.includes(win.text));
});

/* ------------------------------- thinking --------------------------------- */

test('he thinks like a beginner: a real search, an ordinary beat', () => {
  const plan = computeThinkingPlan({
    fen: new Chess().fen(),
    style: STYLE,
    clockMs: null,
    incrementMs: 0,
    initialMs: 300_000,
    ply: 0,
    bookMove: false,
  });
  assert.ok(plan.searchMs > 0, 'a real search, capped by his own depth ceiling');
  assert.ok(plan.budgetMs <= 22_000);
  assert.ok(plan.deliberationMs >= 1000 && plan.deliberationMs <= 6000);
  assert.notEqual(plan.reason, 'low-clock');

  const senior = computeThinkingPlan({
    fen: new Chess().fen(),
    style: styleFor('senior', 2000) as PersonalityStyle,
    clockMs: null,
    incrementMs: 0,
    initialMs: 300_000,
    ply: 0,
    bookMove: false,
  });
  assert.ok(plan.budgetMs < senior.budgetMs, 'quicker than the 2000 profiles');
  assert.ok(plan.deliberationMs < senior.deliberationMs);
});

/* ---------------------------- saved games / PGN --------------------------- */

test('a bot-vs-bot game saves and exports him by name, colour and rating', () => {
  const white = getOpponent('brandon');
  assert.ok(white);

  const pgn = buildPgn(
    {
      white: fullName(white),
      black: fullName(EDWARD),
      result: '1-0',
      date: Date.UTC(2026, 10, 19),
      timeControl: '300+0',
      whiteElo: white.elo,
      blackElo: EDWARD.elo,
      event: 'Bot vs. Bot',
    },
    ['e4', 'e5', 'Nf3', 'Nc6'],
  );
  assert.match(pgn, /\[White "Brandon Tran \(Prime\)"\]/);
  assert.match(pgn, /\[Black "Edward Chen \(Senior\)"\]/);
  assert.match(pgn, /\[BlackElo "800"\]/);

  const record: PlayedGameRecord = {
    game_id: 'edward-persistence',
    mode: 'bot-vs-bot',
    white_opponent_id: white.id,
    black_opponent_id: EDWARD.id,
    white_name: fullName(white),
    black_name: fullName(EDWARD),
    white_elo: white.elo,
    black_elo: EDWARD.elo,
    opponent_id: EDWARD.id,
    opponent_name: fullName(EDWARD),
    opponent_elo: EDWARD.elo,
    opponent_kind: EDWARD.kind,
    player_color: 'w',
    result: '1-0',
    reason: 'checkmate',
    pgn,
    sans: ['e4', 'e5', 'Nf3', 'Nc6'],
    initial_seconds: 300,
    increment_seconds: 0,
    started_at: 1,
    ended_at: 2,
    duration_seconds: 1,
    final_fen: position('e4', 'e5', 'Nf3', 'Nc6').fen(),
    starting_fen: new Chess().fen(),
    board_orientation: 'white',
    time_control_id: '5+0',
  };

  assert.equal(record.opponent_id, 'edward');
  assert.equal(record.opponent_name, 'Edward Chen (Senior)');
  assert.equal(record.black_opponent_id, 'edward');
  assert.equal(record.black_name, 'Edward Chen (Senior)');
  assert.equal(record.black_elo, 800);

  /* History and review rebuild the live card from the stored fields. */
  const profile = profileFromRecord(record);
  assert.equal(profile.id, 'edward');
  assert.equal(profile.name, 'Edward Chen');
  assert.equal(profile.title, 'Senior');
  assert.equal(profile.elo, 800);
  assert.equal(profile.category, 'beginner');
  assert.equal(opponentMeta(profile), 'Senior · 800 Elo');
  assert.equal(profileFromRecord(record).id, 'edward');

  /* The export filename keys off the opponent id, so it is his own file. */
  assert.equal(record.opponent_id, 'edward');
});

test('the regression anchors for the rest of the roster are intact', () => {
  assert.equal(PERSONALITY_STYLES['bryan-sophomore'].defensive, 95);
  assert.equal(PERSONALITY_STYLES.faadi.complexity, 85);
  assert.equal(PERSONALITY_STYLES.freshman.aggression, 25);
  assert.equal(getOpponent('brandon')?.elo, 2350);
  assert.equal(getOpponent('senior')?.title, 'Senior');
  assert.equal(getOpponent('general')?.kind, 'general');
  assert.ok(
    Object.values(PERSONALITY_STYLES).every((style) => typeof style.accuracy === 'number'),
    'every style still resolves an accuracy from its rating',
  );
});
