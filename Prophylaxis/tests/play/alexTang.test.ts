/**
 * Alex Tang (Sophomore) — the energetic goofball, 1100.
 *
 * Covers the catalogue identity and card fields, the Beginners group, his
 * tendency table and 1100 strength dials, the London System, the King's Indian
 * setup against 1.d4, the deliberately empty answer to 1.e4, legal fallback
 * outside the book, his voice and cadence, Normal Play and Bot vs. Bot
 * selection, saved-game/PGN identity, and the regressions that keep every other
 * opponent unchanged.
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
  personalityBookFor,
  personalityBooks,
  repertoireIssues,
} from '../../src/play/personality/repertoires/index.ts';
import { legalBookMoves } from '../../src/play/personality/repertoires/book.ts';
import { ALEX_TANG_REPERTOIRE } from '../../src/play/personality/repertoires/alexTang.ts';
import { kidPlan } from '../../src/play/personality/repertoires/kid.ts';
import { chooseBotMove } from '../../src/play/personality/chooseMove.ts';
import {
  candidateGapForElo,
  choosePersonalityMove,
} from '../../src/play/personality/engine.ts';
import { computeThinkingPlan } from '../../src/play/personality/thinking.ts';
import { blunderChance } from '../../src/play/strength.ts';
import { buildPgn } from '../../src/play/pgn.ts';
import type { StockfishController } from '../../src/engine/useStockfish.ts';

const ALEX = getOpponent('alex-tang');
const STYLE = styleFor('alex-tang', 1100) as PersonalityStyle;

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

/* ---------------------------- 1-2. identity ----------------------------- */

test('Alex Tang is on the roster as Sophomore, 1100, in the Novice band', () => {
  assert.ok(ALEX);
  assert.equal(ALEX.id, 'alex-tang', 'his own stable id');
  assert.equal(ALEX.kind, 'personality');
  assert.equal(ALEX.name, 'Alex Tang');
  assert.equal(ALEX.title, 'Sophomore');
  assert.equal(ALEX.elo, 1100);
  assert.equal(ALEX.category, 'novice');
  assert.equal(ALEX.initials, 'AT');
  assert.equal(ALEX.usesRepertoire, false);

  assert.doesNotMatch(ALEX.name, /\(/, 'the name carries no parenthetical suffix');
  assert.doesNotMatch(ALEX.name, /sophomore/i, 'the subtext lives in its own field');
  assert.equal(opponentStage(ALEX), 'Sophomore');
  assert.equal(opponentMeta(ALEX), 'Sophomore · 1100 Elo');
  assert.equal(opponentFullName(ALEX), 'Alex Tang (Sophomore)');
  assert.ok(ALEX.style.length > 0);
});

test('his id is unique, never a re-used Sophomore or another beginner', () => {
  assert.equal(PERSONALITY_OPPONENTS.filter((opponent) => opponent.id === 'alex-tang').length, 1);
  assert.equal(new Set(ALL_OPPONENTS.map((opponent) => opponent.id)).size, ALL_OPPONENTS.length);
  assert.equal(getOpponent('alex-tang'), ALEX, 'the catalogue entry is the same object');

  const sophomores = PERSONALITY_OPPONENTS.filter((opponent) => opponent.title === 'Sophomore');
  assert.equal(sophomores.length, 5);
  assert.equal(new Set(sophomores.map((opponent) => opponentFullName(opponent))).size, 5);
  assert.equal(
    new Set(PERSONALITY_OPPONENTS.map((opponent) => opponentFullName(opponent))).size,
    PERSONALITY_OPPONENTS.length,
    'saved games can always tell two opponents apart',
  );

  const beginners = PERSONALITY_OPPONENTS.filter((opponent) => opponent.category === 'novice');
  assert.ok(beginners.some((opponent) => opponent.id === 'alex-tang'), 'listed among the beginners');
});

test('his portrait is his own file, with the monogram kept as the fallback', () => {
  assert.equal(ALEX.portraitPath, 'opponents/alex-tang.webp');
  assert.equal(fs.existsSync('public/opponents/alex-tang.webp'), true);
  for (const other of PERSONALITY_OPPONENTS) {
    if (other.id === 'alex-tang') continue;
    assert.notEqual(other.portraitPath, ALEX.portraitPath, `${other.id} keeps its own portrait`);
  }
});

/* ------------------------- 8. tendency profile -------------------------- */

test('his tendency table is the straightforward beginner table', () => {
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
      aggression: 35,
      risk: 30,
      positional: 45,
      tactical: 40,
      defensive: 50,
      initiative: 40,
      simplification: 60,
      complexity: 30,
      kingSafety: 65,
      material: 70,
    },
  );
  assert.equal(STYLE.id, 'alex-tang');
  /* The goofball is in the dialogue, not the move chooser. */
  assert.ok(STYLE.complexity < 40, 'he steers away from messes');
  assert.ok(STYLE.risk < 40, 'no speculative play');
  assert.ok(STYLE.sacrifice <= 20, 'a pawn for an idea, never a piece');
  assert.ok((STYLE.openingBias.sharp ?? 0) < 0);
  assert.ok((STYLE.openingBias.developing ?? 0) > 0);
});

/* --------------------------- 7. 1100 strength --------------------------- */

test('1100 is the strength dial and nothing inflates it', () => {
  assert.equal(STYLE.accuracy, accuracyForElo(1100));
  assert.ok(STYLE.accuracy < accuracyForElo(1400), 'no accuracy inflation');
  assert.equal(STYLE.depthCap, undefined, 'no artificial search ceiling');
  assert.equal(STYLE.mistakeChance, undefined, 'the rating curve decides his slips');
  assert.equal(candidateGapForElo(1100), candidateGapForElo(1100));
  assert.ok(candidateGapForElo(1100) > candidateGapForElo(1400));
  assert.ok(blunderChance(1100) > blunderChance(1550), 'a 1100 misses more than a 1550');

  /* The engine-best move still wins over taste, as for every profile. */
  const italian = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 6';
  const chosen = choosePersonalityMove({
    fen: italian,
    candidates: [
      { uci: 'e1g1', scoreCp: 40, mate: null },
      { uci: 'f3g5', scoreCp: -90, mate: null },
    ],
    style: STYLE,
    elo: 1100,
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
    elo: 1100,
    random: () => 0.1,
  });
  assert.equal(mate?.uci, 'f3g5');
});

/* --------------------------- 3. London System --------------------------- */

test('his White repertoire is the London System and nothing deeper', () => {
  assert.ok(ALEX_TANG_REPERTOIRE.asWhite.length >= 2);
  for (const line of ALEX_TANG_REPERTOIRE.asWhite) {
    assert.equal(line.san[0], 'd4', `${line.id} starts 1.d4`);
    assert.ok(line.san.includes('Bf4'), `${line.id} puts the bishop outside the chain`);
    assert.ok(line.san.includes('e3'), `${line.id} supports the centre with e3`);
    assert.ok(line.san.length <= 16, `${line.id} stays a short, basic line`);
    assert.ok(line.id.startsWith('alex-tang-'));
  }

  assert.deepEqual(
    legalBookMoves(personalityBookFor('alex-tang', 'w'), new Chess()).map((move) => move.san),
    ['d4'],
  );
  const afterD5 = legalBookMoves(personalityBookFor('alex-tang', 'w'), position('d4', 'd5')).map(
    (move) => move.san,
  );
  assert.ok(afterD5.includes('Bf4'), 'the London bishop comes out');
  assert.ok(afterD5.includes('Nf3'), 'normal knight development');
});

/* --------------------------- 4. King's Indian --------------------------- */

test('against 1.d4 he builds the King’s Indian setup', () => {
  assert.deepEqual(
    legalBookMoves(personalityBookFor('alex-tang', 'b'), position('d4')).map((move) => move.san),
    ['Nf6'],
  );
  assert.deepEqual(
    legalBookMoves(
      personalityBookFor('alex-tang', 'b'),
      position('d4', 'Nf6', 'Bf4', 'g6', 'e3'),
    ).map((move) => move.san),
    ['Bg7'],
  );

  const start = kidPlan(position('d4').fen(), ['d4'], STYLE, 'b');
  assert.ok(start);
  assert.equal(start.moves[0]?.uci, 'g8f6');

  const built = position(
    'd4',
    'Nf6',
    'Bf4',
    'g6',
    'e3',
    'Bg7',
    'Nf3',
    'O-O',
    'Be2',
    'd6',
    'O-O',
    'Nbd7',
    'h3',
  );
  const plan = kidPlan(
    built.fen(),
    ['d4', 'Nf6', 'Bf4', 'g6', 'e3', 'Bg7', 'Nf3', 'O-O', 'Be2', 'd6', 'O-O', 'Nbd7', 'h3'],
    STYLE, 'b',
  );
  assert.ok(plan);
  assert.equal(plan.setupComplete, true, 'setup first, break later');
  assert.equal(plan.moves[0]?.uci, 'e7e5');
});

/* ---------------------- 5-6. 1.e4 and legal fallback -------------------- */

test('against 1.e4 he has no book: principled selection plays a legal move', async () => {
  assert.deepEqual(
    legalBookMoves(personalityBookFor('alex-tang', 'b'), position('e4')),
    [],
    'no invented 1.e4 repertoire',
  );

  const game = position('e4');
  const chosen = await chooseBotMove({
    game,
    fen: game.fen(),
    history: ['e4'],
    botColor: 'b',
    style: STYLE,
    elo: 1100,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: engineWith([
      { uci: 'e7e5', scoreCp: 25 },
      { uci: 'c7c5', scoreCp: 18 },
      { uci: 'e7e6', scoreCp: 12 },
    ]),
    random: () => 0.5,
  });
  assert.ok(chosen);
  assert.equal(chosen.bookMove, false);
  assert.equal(chosen.source, 'engine');
  assertLegal(game.fen(), chosen.uci);
});

test('outside his repertoire he improvises legally and never leaks a colour', async () => {
  const openGame = position('e4', 'e5', 'Nf3', 'Nc6');
  assert.deepEqual(legalBookMoves(personalityBookFor('alex-tang', 'w'), openGame), []);

  const chosen = await chooseBotMove({
    game: openGame,
    fen: openGame.fen(),
    history: ['e4', 'e5', 'Nf3', 'Nc6'],
    botColor: 'w',
    style: STYLE,
    elo: 1100,
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
    legalBookMoves(personalityBookFor('alex-tang', 'w'), position('e4')).map((move) => move.san),
    [],
    'his Black answers do not become White moves',
  );
});

test('his book compiles, stays legal and borrows nothing from another opponent', () => {
  assert.deepEqual(repertoireIssues().filter((entry) => entry.issues.length > 0), []);
  assert.ok(repertoireIssues().some((entry) => entry.id === 'alex-tang'));

  for (const color of ['w', 'b'] as const) {
    for (const [key, moves] of personalityBooks('alex-tang')[color].book) {
      assert.equal(key.split(' ')[1], color, `${color} book only holds ${color} turns`);
      for (const entry of moves) {
        assertLegal(`${key} - 0 1`, entry.uci);
        assert.ok(entry.lineIds.every((id) => id.startsWith('alex-tang-')));
      }
    }
  }

  const foreign = Object.entries(PERSONALITY_REPERTOIRES)
    .filter(([id]) => id !== 'alex-tang')
    .flatMap(([, repertoire]) => [...repertoire.asWhite, ...repertoire.asBlack]);
  for (const line of [...ALEX_TANG_REPERTOIRE.asWhite, ...ALEX_TANG_REPERTOIRE.asBlack]) {
    assert.equal(foreign.includes(line), false, `${line.id} is a line of his own`);
    assert.equal(
      foreign.some((other) => other.san.join(' ') === line.san.join(' ')),
      false,
      `${line.id} is not copied from another opponent`,
    );
  }
});

/* ---------------------------- 9. dialogue ------------------------------- */

test('his voice is upbeat, spontaneous and free of engine or theory talk', () => {
  const bank = DIALOGUE_BANKS['alex-tang'];
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

  const spoken = Object.values(bank).flat().join(' | ');
  for (const line of [
    'Okay okay okay, hear me out.',
    'WAIT, hold on, I have an idea.',
    'I’m actually cooking right now.',
    'Wait, what was I doing?',
    'BRO, WHAT?',
    'Good game! That was fun.',
  ]) {
    assert.ok(spoken.includes(line), `missing his voice: ${line}`);
  }

  /* Excitable, not shouty: a couple of all-caps reactions, not a wall of them. */
  const all = Object.values(bank).flat();
  assert.ok(all.filter((line) => line === line.toUpperCase()).length <= 2, 'no wall of caps');
  assert.ok(all.filter((line) => line.includes('!')).length <= 4, 'not every line is a shout');
  /* And it is not somebody else's bank. */
  assert.notEqual(bank, DIALOGUE_BANKS.freshman);
  assert.notEqual(bank, DIALOGUE_BANKS.bryan);
});

test('his lines respect the quick gap, the repeat gap and never repeat', () => {
  const state = createDialogueState();
  assert.ok(maybeReact('alex-tang', 'strong', { ply: 20, state, random: () => 0 }));

  /* Inside his two-ply gap he stays quiet, whichever event it is. */
  assert.equal(maybeReact('alex-tang', 'mistake', { ply: 21, state, random: () => 0 }), null);
  assert.ok(maybeReact('alex-tang', 'mistake', { ply: 22, state, random: () => 0 }));

  /* The same event waits for the longer repeat gap. */
  assert.equal(maybeReact('alex-tang', 'strong', { ply: 25, state, random: () => 0 }), null);
  assert.ok(maybeReact('alex-tang', 'strong', { ply: 28, state, random: () => 0 }));

  /* Once-per-game remarks stay once per game. */
  const once = createDialogueState();
  assert.ok(maybeReact('alex-tang', 'losing', { ply: 10, state: once, random: () => 0 }));
  assert.equal(maybeReact('alex-tang', 'losing', { ply: 60, state: once, random: () => 0 }), null);

  /* A used line is not chosen again while the bank lasts. */
  const fresh = createDialogueState();
  const seen = new Set<string>();
  let ply = 40;
  while (seen.size < DIALOGUE_BANKS['alex-tang'].strong.length) {
    ply += 20;
    const line = maybeReact('alex-tang', 'strong', { ply, state: fresh, random: () => 0.99 });
    assert.ok(line);
    assert.equal(seen.has(line.text), false, 'a line is not repeated while unused ones remain');
    seen.add(line.text);
  }

  /* A finished game always gets a line. */
  const closing = createDialogueState();
  const loss = maybeReact('alex-tang', 'loss', { ply: 2, state: closing, force: true, random: () => 0 });
  assert.ok(loss);
  assert.ok(DIALOGUE_BANKS['alex-tang'].loss.includes(loss.text));
});

/* --------------------- 10. Normal Play and Bot vs. Bot ------------------ */

test('Normal Play: his first move comes from the London book with no search', async () => {
  const game = new Chess();
  const chosen = await chooseBotMove({
    game,
    fen: game.fen(),
    history: [],
    botColor: 'w',
    style: STYLE,
    elo: 1100,
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

test('Bot vs. Bot: he plays both colours through the same selection', async () => {
  const asBlack = await chooseBotMove({
    game: position('d4'),
    fen: position('d4').fen(),
    history: ['d4'],
    botColor: 'b',
    style: STYLE,
    elo: 1100,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: noEngine,
    random: () => 0.99,
  });
  assert.equal(asBlack?.uci, 'g8f6');

  const london = await chooseBotMove({
    game: position('d4', 'd5'),
    fen: position('d4', 'd5').fen(),
    history: ['d4', 'd5'],
    botColor: 'w',
    style: STYLE,
    elo: 1100,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: noEngine,
    random: () => 0,
  });
  assert.ok(london);
  assert.equal(london.bookMove, true);
  assertLegal(position('d4', 'd5').fen(), london.uci);
});

test('he thinks for a quick, interested beat in every phase', () => {
  for (const fen of [
    new Chess().fen(),
    position('d4', 'Nf6', 'Bf4', 'g6', 'e3', 'Bg7').fen(),
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
      white: opponentFullName(ALEX),
      black: opponentFullName(getOpponent('brandon')!),
      result: '1-0',
      date: Date.UTC(2026, 10, 21),
      timeControl: '300+0',
      whiteElo: ALEX.elo,
      blackElo: getOpponent('brandon')!.elo,
      event: 'Bot vs. Bot',
    },
    ['d4', 'd5', 'Bf4', 'Nf6', 'e3'],
  );
  assert.match(pgn, /\[White "Alex Tang \(Sophomore\)"\]/);
  assert.match(pgn, /\[WhiteElo "1100"\]/);

  const profile = profileFromRecord({
    opponent_id: ALEX.id,
    opponent_name: opponentFullName(ALEX),
    opponent_elo: ALEX.elo,
    opponent_kind: ALEX.kind,
  });
  assert.equal(profile.id, 'alex-tang');
  assert.equal(profile.name, 'Alex Tang');
  assert.equal(profile.title, 'Sophomore');
  assert.equal(profile.elo, 1100);
  assert.equal(profile.category, 'novice');
  assert.equal(opponentMeta(profile), 'Sophomore · 1100 Elo');
});

/* ---------------------------- 11. regressions --------------------------- */

test('every other opponent and the General Bot are untouched', () => {
  assert.equal(PERSONALITY_OPPONENTS.length, 21);
  assert.equal(ALL_OPPONENTS.length, 22);

  const expected: Array<[string, string, string, number, string]> = [
    ['freshman', 'Johnfer Quispe', 'Freshman', 1250, 'novice'],
    ['sophomore', 'Johnfer Quispe', 'Sophomore', 1450, 'intermediate'],
    ['nina', 'Nina Yang', 'Sophomore', 1550, 'intermediate'],
    ['bryan', 'Bryan Martinez-Hernandez', 'Junior', 1800, 'varsity'],
    ['senior', 'Johnfer Quispe', 'Senior', 2000, 'varsity'],
    ['brandon', 'Brandon Tran', 'Prime', 2350, 'big-4'],
    ['junior', 'Johnfer Quispe', 'Junior', 2150, 'big-4'],
    ['bryan-prime', 'Bryan Martinez-Hernandez', 'Prime', 2000, 'big-4'],
    ['bryan-sophomore', 'Bryan Martinez-Hernandez', 'Sophomore', 1350, 'intermediate'],
    ['mabinti', 'Mabinti Mansaray', 'Junior', 1550, 'big-4'],
    ['edward', 'Edward Chen', 'Senior', 800, 'beginner'],
    ['bryan-widjaja', 'Bryan Widjaja', 'Prime', 1400, 'intermediate'],
  ];
  for (const [id, name, title, elo, category] of expected) {
    const opponent = getOpponent(id);
    assert.ok(opponent, `${id} is still on the roster`);
    assert.equal(opponent.name, name);
    assert.equal(opponent.title, title);
    assert.equal(opponent.elo, elo);
    assert.equal(opponent.category, category);
    assert.notEqual(opponent.id, ALEX.id);
  }
  assert.equal(GENERAL_BOT.id, 'general');
  assert.equal(GENERAL_BOT.elo, 1500);
  assert.equal(GENERAL_BOT.usesRepertoire, false);

  /* Other profiles' tendency anchors are exactly as they were. */
  assert.equal(PERSONALITY_STYLES.freshman.defensive, 85);
  assert.equal(PERSONALITY_STYLES.edward.depthCap, 10);
  assert.equal(PERSONALITY_STYLES.emmanuel.mistakeChance, 0.55);
  assert.equal(PERSONALITY_STYLES['bryan-widjaja'].defensive, 98);
  assert.equal(PERSONALITY_STYLES['bryan-sophomore'].defensive, 95);

  /* Other books still build, and his registration does not give anyone his lines. */
  for (const id of ['freshman', 'edward', 'bryan-widjaja', 'bryan-sophomore']) {
    assert.ok(
      personalityBookFor(id, 'w').size + personalityBookFor(id, 'b').size > 0,
      `${id} still has a book`,
    );
  }
});
