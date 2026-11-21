/**
 * Erik Wiessmann (Teacher) — the chill logician, 1100.
 *
 * Covers the catalogue identity and card fields, the Novice band, the
 * principled tendency table and the untouched 1100 strength dials, the 1.e4
 * White book, the 1...e5 and 1...d5 answers, legal fallback outside the book,
 * his voice and cadence, Normal Play and Bot vs. Bot selection, saved-game/PGN
 * identity, and the regressions that keep every other opponent unchanged.
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
import { ERIK_WIESSMANN_REPERTOIRE } from '../../src/play/personality/repertoires/erikWiessmann.ts';
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

const ERIK = getOpponent('erik-wiessmann');
const STYLE = styleFor('erik-wiessmann', 1100) as PersonalityStyle;

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

test('Erik Wiessmann is on the roster as Teacher, 1100, in the Novice band', () => {
  assert.ok(ERIK);
  assert.equal(ERIK.id, 'erik-wiessmann', 'his own stable id');
  assert.equal(ERIK.kind, 'personality');
  assert.equal(ERIK.name, 'Erik Wiessmann');
  assert.equal(ERIK.title, 'Teacher');
  assert.equal(ERIK.elo, 1100);
  assert.equal(ERIK.category, 'novice');
  assert.equal(ERIK.initials, 'EW');
  assert.equal(ERIK.usesRepertoire, false);

  assert.doesNotMatch(ERIK.name, /\(/, 'the name carries no parenthetical suffix');
  assert.doesNotMatch(ERIK.name, /teacher/i, 'the subtext lives in its own field');
  assert.equal(opponentStage(ERIK), 'Teacher');
  assert.equal(opponentMeta(ERIK), 'Teacher · 1100 Elo');
  assert.equal(opponentFullName(ERIK), 'Erik Wiessmann (Teacher)');
  assert.ok(ERIK.style.length > 0);
});

test('his id is unique and never resolves to another Novice card', () => {
  assert.equal(PERSONALITY_OPPONENTS.filter((opponent) => opponent.id === 'erik-wiessmann').length, 1);
  assert.equal(new Set(ALL_OPPONENTS.map((opponent) => opponent.id)).size, ALL_OPPONENTS.length);
  assert.equal(getOpponent('erik-wiessmann'), ERIK, 'the catalogue entry is the same object');

  const novice = PERSONALITY_OPPONENTS.filter((opponent) => opponent.category === 'novice');
  assert.ok(novice.some((opponent) => opponent.id === 'erik-wiessmann'));
  assert.equal(
    new Set(PERSONALITY_OPPONENTS.map((opponent) => opponentFullName(opponent))).size,
    PERSONALITY_OPPONENTS.length,
    'saved games can always tell two opponents apart',
  );
  /* Another 1100 exists (Alex Tang): the ids and full labels keep them apart. */
  const namesakes = PERSONALITY_OPPONENTS.filter((opponent) => opponent.elo === 1100);
  assert.equal(namesakes.length, 2);
  assert.equal(new Set(namesakes.map((opponent) => opponent.id)).size, 2);
  assert.equal(new Set(namesakes.map((opponent) => opponentFullName(opponent))).size, 2);
});

test('his portrait is his own file, with the monogram kept as the fallback', () => {
  assert.equal(ERIK.portraitPath, 'opponents/erik-wiessmann.webp');
  assert.equal(fs.existsSync('public/opponents/erik-wiessmann.webp'), true);
  for (const other of PERSONALITY_OPPONENTS) {
    if (other.id === 'erik-wiessmann') continue;
    assert.notEqual(other.portraitPath, ERIK.portraitPath, `${other.id} keeps its own portrait`);
  }
});

/* -------------------------- 5. tendency profile ------------------------- */

test('his tendency table is the principled, low-risk one', () => {
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
      risk: 25,
      positional: 75,
      tactical: 45,
      defensive: 65,
      initiative: 40,
      simplification: 65,
      complexity: 25,
      kingSafety: 75,
      material: 75,
    },
  );
  assert.equal(STYLE.id, 'erik-wiessmann');
  assert.ok(STYLE.sacrifice <= 15, 'no speculation with material');
  assert.ok((STYLE.openingBias.sharp ?? 0) < 0, 'he avoids complications');
  assert.ok((STYLE.openingBias.developing ?? 0) > 0);
});

/* ---------------------------- strength dials ---------------------------- */

test('his logic is taste, not strength: 1100 still owns the dials', () => {
  assert.equal(STYLE.accuracy, accuracyForElo(1100));
  assert.equal(STYLE.accuracy, 0.85);
  assert.equal(STYLE.depthCap, undefined, 'no artificial search ceiling');
  assert.equal(STYLE.mistakeChance, undefined, 'the rating curve decides his slips');
  assert.equal(candidateGapForElo(1100), candidateGapForElo(1100));
  assert.ok(candidateGapForElo(1100) > candidateGapForElo(1400));
  assert.ok(blunderChance(1100) > blunderChance(1550));

  /* Principled taste picks the developing castle over a loose jump... */
  const italian = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 6';
  const equal = choosePersonalityMove({
    fen: italian,
    candidates: [
      { uci: 'e1g1', scoreCp: 15, mate: null },
      { uci: 'f3g5', scoreCp: 15, mate: null },
    ],
    style: STYLE,
    elo: 1100,
    random: () => 0.9,
  });
  assert.equal(equal?.uci, 'e1g1');

  /* ...but a clearly better move and a forced mate still win. */
  const better = choosePersonalityMove({
    fen: italian,
    candidates: [
      { uci: 'e1g1', scoreCp: 10, mate: null },
      { uci: 'f3g5', scoreCp: 90, mate: null },
    ],
    style: STYLE,
    elo: 1100,
    random: () => 0.1,
  });
  assert.equal(better?.uci, 'f3g5');
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

/* --------------------------- 3. White 1.e4 ------------------------------ */

test('White opens 1.e4 and follows up with principled development', () => {
  assert.ok(ERIK_WIESSMANN_REPERTOIRE.asWhite.length >= 2);
  for (const line of ERIK_WIESSMANN_REPERTOIRE.asWhite) {
    assert.equal(line.san[0], 'e4', `${line.id} starts 1.e4`);
    assert.ok(
      line.san.some((san) => san.startsWith('N') || san.startsWith('B')),
      `${line.id} develops a piece`,
    );
    assert.ok(line.san.length <= 14, `${line.id} stays a short, principled line`);
    assert.ok(line.id.startsWith('erik-wiessmann-'));
  }

  assert.deepEqual(
    legalBookMoves(personalityBookFor('erik-wiessmann', 'w'), new Chess()).map((move) => move.san),
    ['e4'],
  );
  assert.deepEqual(
    legalBookMoves(personalityBookFor('erik-wiessmann', 'w'), position('e4', 'e5')).map(
      (move) => move.san,
    ),
    ['Nf3'],
  );
});

/* ------------------- 4. Black 1...e5 and 1...d5 answers ------------------ */

test('as Black he answers 1.e4 with 1...e5 and 1.d4 with 1...d5', () => {
  assert.deepEqual(
    legalBookMoves(personalityBookFor('erik-wiessmann', 'b'), position('e4')).map(
      (move) => move.san,
    ),
    ['e5'],
  );
  assert.deepEqual(
    legalBookMoves(personalityBookFor('erik-wiessmann', 'b'), position('d4')).map(
      (move) => move.san,
    ),
    ['d5'],
  );

  /* Ordinary development follows in both main lines. */
  assert.deepEqual(
    legalBookMoves(
      personalityBookFor('erik-wiessmann', 'b'),
      position('e4', 'e5', 'Nf3'),
    ).map((move) => move.san),
    ['Nc6'],
  );
  assert.deepEqual(
    legalBookMoves(
      personalityBookFor('erik-wiessmann', 'b'),
      position('d4', 'd5', 'c4'),
    ).map((move) => move.san),
    ['e6', 'c6'],
  );

  /* And he never reaches for the King's Indian layer: 1...d5 is his answer. */
  assert.equal(kidPlan(position('d4').fen(), ['d4'], STYLE, 'b'), null);
});

/* --------------------------- legal fallback ----------------------------- */

test('outside his book he improvises legally and never leaks a colour', async () => {
  const reti = position('Nf3', 'Nf6');
  assert.deepEqual(legalBookMoves(personalityBookFor('erik-wiessmann', 'w'), reti), []);

  const chosen = await chooseBotMove({
    game: reti,
    fen: reti.fen(),
    history: ['Nf3', 'Nf6'],
    botColor: 'w',
    style: STYLE,
    elo: 1100,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: engineWith([
      { uci: 'c2c4', scoreCp: 25 },
      { uci: 'd2d4', scoreCp: 20 },
      { uci: 'g2g3', scoreCp: 12 },
    ]),
    random: () => 0.5,
  });
  assert.ok(chosen);
  assert.equal(chosen.bookMove, false);
  assert.equal(chosen.source, 'engine');
  assertLegal(reti.fen(), chosen.uci);

  assert.deepEqual(
    legalBookMoves(personalityBookFor('erik-wiessmann', 'w'), position('e4')).map(
      (move) => move.san,
    ),
    [],
    'his Black answers do not become White moves',
  );
});

test('his book compiles, stays legal and borrows nothing from another opponent', () => {
  assert.deepEqual(repertoireIssues().filter((entry) => entry.issues.length > 0), []);
  assert.ok(repertoireIssues().some((entry) => entry.id === 'erik-wiessmann'));

  for (const color of ['w', 'b'] as const) {
    for (const [key, moves] of personalityBooks('erik-wiessmann')[color].book) {
      assert.equal(key.split(' ')[1], color, `${color} book only holds ${color} turns`);
      for (const entry of moves) {
        assertLegal(`${key} - 0 1`, entry.uci);
        assert.ok(entry.lineIds.every((id) => id.startsWith('erik-wiessmann-')));
      }
    }
  }

  const foreign = Object.entries(PERSONALITY_REPERTOIRES)
    .filter(([id]) => id !== 'erik-wiessmann')
    .flatMap(([, repertoire]) => [...repertoire.asWhite, ...repertoire.asBlack]);
  for (const line of [...ERIK_WIESSMANN_REPERTOIRE.asWhite, ...ERIK_WIESSMANN_REPERTOIRE.asBlack]) {
    assert.equal(foreign.includes(line), false, `${line.id} is a line of his own`);
    assert.equal(
      foreign.some((other) => other.san.join(' ') === line.san.join(' ')),
      false,
      `${line.id} is not copied from another opponent`,
    );
  }
});

/* ---------------------------- 6. dialogue ------------------------------- */

test('his voice is chill and logical without lecturing', () => {
  const bank = DIALOGUE_BANKS['erik-wiessmann'];
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
        !/\b(gambit|sicilian|french|ruy|fianchetto|zugzwang|variation|theory|tactic)\b/i.test(line),
        `no theory talk: ${line}`,
      );
      /* A colleague, not a lecturer. */
      assert.ok(!/\b(therefore|furthermore|as I said|obviously)\b/i.test(line), `not a lecture: ${line}`);
    }
  }

  const spoken = Object.values(bank).flat().join(' | ');
  for (const line of [
    'Alright, let’s see.',
    'That is actually pretty interesting.',
    'Okay, now we are getting somewhere.',
    'Nah, we cannot allow that.',
    'Haha, fair enough.',
    'Good game.',
  ]) {
    assert.ok(spoken.includes(line), `missing his voice: ${line}`);
  }

  const all = Object.values(bank).flat();
  assert.equal(all.filter((line) => line === line.toUpperCase()).length, 0, 'no shouting');
  assert.ok(all.filter((line) => line.includes('!')).length <= 1, 'relaxed, not gushing');
  assert.notEqual(bank, DIALOGUE_BANKS.freshman);
  assert.notEqual(bank, DIALOGUE_BANKS.bryan);
});

test('his lines respect the quiet gap, the repeat gap and never repeat', () => {
  const state = createDialogueState();
  assert.ok(maybeReact('erik-wiessmann', 'strong', { ply: 20, state, random: () => 0 }));

  /* Inside his three-ply gap he stays quiet, whichever event it is. */
  assert.equal(maybeReact('erik-wiessmann', 'mistake', { ply: 22, state, random: () => 0 }), null);
  assert.ok(maybeReact('erik-wiessmann', 'mistake', { ply: 25, state, random: () => 0 }));

  /* The same event waits for the longer repeat gap. */
  assert.equal(maybeReact('erik-wiessmann', 'strong', { ply: 28, state, random: () => 0 }), null);
  assert.ok(maybeReact('erik-wiessmann', 'strong', { ply: 31, state, random: () => 0 }));

  /* Once-per-game remarks stay once per game. */
  const once = createDialogueState();
  assert.ok(maybeReact('erik-wiessmann', 'losing', { ply: 10, state: once, random: () => 0 }));
  assert.equal(maybeReact('erik-wiessmann', 'losing', { ply: 70, state: once, random: () => 0 }), null);

  /* A used line is not chosen again while the bank lasts. */
  const fresh = createDialogueState();
  const seen = new Set<string>();
  let ply = 40;
  while (seen.size < DIALOGUE_BANKS['erik-wiessmann'].strong.length) {
    ply += 20;
    const line = maybeReact('erik-wiessmann', 'strong', { ply, state: fresh, random: () => 0.99 });
    assert.ok(line);
    assert.equal(seen.has(line.text), false, 'a line is not repeated while unused ones remain');
    seen.add(line.text);
  }

  /* A finished game always gets a line. */
  const closing = createDialogueState();
  const loss = maybeReact('erik-wiessmann', 'loss', { ply: 2, state: closing, force: true, random: () => 0 });
  assert.ok(loss);
  assert.ok(DIALOGUE_BANKS['erik-wiessmann'].loss.includes(loss.text));
});

/* ------------------- 7. Normal Play and Bot vs. Bot --------------------- */

test('Normal Play: his first move is 1.e4 from the book, with no search', async () => {
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
  assert.equal(chosen?.uci, 'e2e4');
  assert.equal(chosen?.bookMove, true);
  assert.equal(chosen?.source, 'repertoire');
  assert.equal(chosen?.plan?.reason, 'book');
});

test('Bot vs. Bot: he plays both colours through the same selection', async () => {
  const asBlack = await chooseBotMove({
    game: position('e4'),
    fen: position('e4').fen(),
    history: ['e4'],
    botColor: 'b',
    style: STYLE,
    elo: 1100,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: noEngine,
    random: () => 0.99,
  });
  assert.equal(asBlack?.uci, 'e7e5');

  const vsD4 = await chooseBotMove({
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
  assert.equal(vsD4?.uci, 'd7d5');
});

test('he thinks for an ordinary, methodical beat in every phase', () => {
  for (const fen of [
    new Chess().fen(),
    position('e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5').fen(),
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

/* ------------------------ 8. history and PGN identity ------------------- */

test('a saved game and its PGN keep his name, subtext, colour and rating', () => {
  const pgn = buildPgn(
    {
      white: opponentFullName(ERIK),
      black: opponentFullName(getOpponent('alex-tang')!),
      result: '1-0',
      date: Date.UTC(2026, 10, 21),
      timeControl: '300+0',
      whiteElo: ERIK.elo,
      blackElo: getOpponent('alex-tang')!.elo,
      event: 'Bot vs. Bot',
    },
    ['e4', 'e5', 'Nf3', 'Nc6'],
  );
  assert.match(pgn, /\[White "Erik Wiessmann \(Teacher\)"\]/);
  assert.match(pgn, /\[WhiteElo "1100"\]/);

  const profile = profileFromRecord({
    opponent_id: ERIK.id,
    opponent_name: opponentFullName(ERIK),
    opponent_elo: ERIK.elo,
    opponent_kind: ERIK.kind,
  });
  assert.equal(profile.id, 'erik-wiessmann');
  assert.equal(profile.name, 'Erik Wiessmann');
  assert.equal(profile.title, 'Teacher');
  assert.equal(profile.elo, 1100);
  assert.equal(profile.category, 'novice');
  assert.equal(opponentMeta(profile), 'Teacher · 1100 Elo');
});

/* ---------------------------- 9. regressions ---------------------------- */

test('every other opponent and the General Bot are untouched', () => {
  assert.equal(PERSONALITY_OPPONENTS.length, 22);
  assert.equal(ALL_OPPONENTS.length, 23);

  const expected: Array<[string, string, string, number, string]> = [
    ['emmanuel', 'Emmanuel Domah', 'Senior', 150, 'beginner'],
    ['edward', 'Edward Chen', 'Senior', 800, 'beginner'],
    ['faadi', 'Faadi Granillo Garcia', 'Prime', 700, 'beginner'],
    ['nina-freshman', 'Nina Yang', 'Freshman', 1200, 'novice'],
    ['freshman', 'Johnfer Quispe', 'Freshman', 1250, 'novice'],
    ['alex-tang', 'Alex Tang', 'Sophomore', 1100, 'novice'],
    ['bryan-sophomore', 'Bryan Martinez-Hernandez', 'Sophomore', 1350, 'intermediate'],
    ['bryan-widjaja', 'Bryan Widjaja', 'Prime', 1400, 'intermediate'],
    ['sophomore', 'Johnfer Quispe', 'Sophomore', 1450, 'intermediate'],
    ['nina', 'Nina Yang', 'Sophomore', 1550, 'intermediate'],
    ['brandon-freshman', 'Brandon Tran', 'Freshman', 1600, 'intermediate'],
    ['bryan', 'Bryan Martinez-Hernandez', 'Junior', 1800, 'varsity'],
    ['senior', 'Johnfer Quispe', 'Senior', 2000, 'varsity'],
    ['brandon', 'Brandon Tran', 'Prime', 2350, 'big-4'],
    ['junior', 'Johnfer Quispe', 'Junior', 2150, 'big-4'],
    ['bryan-prime', 'Bryan Martinez-Hernandez', 'Prime', 2000, 'big-4'],
    ['mabinti', 'Mabinti Mansaray', 'Junior', 1550, 'big-4'],
  ];
  for (const [id, name, title, elo, category] of expected) {
    const opponent = getOpponent(id);
    assert.ok(opponent, `${id} is still on the roster`);
    assert.equal(opponent.name, name);
    assert.equal(opponent.title, title);
    assert.equal(opponent.elo, elo);
    assert.equal(opponent.category, category);
    assert.notEqual(opponent.id, ERIK.id);
  }
  assert.equal(GENERAL_BOT.id, 'general');
  assert.equal(GENERAL_BOT.elo, 1500);
  assert.equal(GENERAL_BOT.usesRepertoire, false);

  /* Other profiles' tendency anchors are exactly as they were. */
  assert.equal(PERSONALITY_STYLES.freshman.defensive, 85);
  assert.equal(PERSONALITY_STYLES.edward.depthCap, 10);
  assert.equal(PERSONALITY_STYLES.emmanuel.mistakeChance, 0.55);
  assert.equal(PERSONALITY_STYLES['bryan-widjaja'].defensive, 98);
  assert.equal(PERSONALITY_STYLES['alex-tang'].complexity, 30);
  assert.equal(PERSONALITY_STYLES['bryan-sophomore'].defensive, 95);

  /* Other books still build, and his registration gives no one his lines. */
  for (const id of ['freshman', 'edward', 'bryan-widjaja', 'alex-tang']) {
    assert.ok(
      personalityBookFor(id, 'w').size + personalityBookFor(id, 'b').size > 0,
      `${id} still has a book`,
    );
  }
});
