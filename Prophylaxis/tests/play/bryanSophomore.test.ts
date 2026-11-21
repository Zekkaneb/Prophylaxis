/**
 * Bryan Martinez-Hernandez (Sophomore) — the defender, at 1350.
 *
 * Covers his catalogue entry and card label, the tendency table that makes him
 * defend first, what 1350 means for his move choice, the shared Vienna/Pirc book
 * and Alapin preference he inherits from his own character, the King's Indian
 * setup against 1.d4, the dialogue bank (his voice plus a defender's lines), the
 * thinking beat, and the regressions that keep Junior and Prime untouched.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { Chess } from 'chess.js';
import {
  ALL_OPPONENTS,
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
} from '../../src/play/personality/styles.ts';
import {
  personalityBookFor,
  personalityBooks,
  repertoireIssues,
} from '../../src/play/personality/repertoires/index.ts';
import { legalBookMoves } from '../../src/play/personality/repertoires/book.ts';
import { kidPlan } from '../../src/play/personality/repertoires/kid.ts';
import { bryanAlapinPreference } from '../../src/play/personality/bryan.ts';
import {
  candidateGapForElo,
  choosePersonalityMove,
} from '../../src/play/personality/engine.ts';
import { computeThinkingPlan } from '../../src/play/personality/thinking.ts';
import { blunderChance } from '../../src/play/strength.ts';
import type { PersonalityStyle } from '../../src/play/personality/styles.ts';

const SOPHOMORE = getOpponent('bryan-sophomore');
const STYLE = styleFor('bryan-sophomore', 1350) as PersonalityStyle;
const JUNIOR = styleFor('bryan', 1800) as PersonalityStyle;
const PRIME = styleFor('bryan-prime', 2000) as PersonalityStyle;

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

/**
 * Italian Game, White to move: castle (king safety) or send the knight to g5
 * (activity). The engine rates them equal, which is exactly the tie a
 * personality is supposed to break.
 */
const QUIET_OR_ACTIVE = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 6';

/* ------------------------------ registration ------------------------------ */

test('the new opponent is Bryan Martinez-Hernandez, Sophomore, 1350', () => {
  assert.ok(SOPHOMORE);
  assert.equal(SOPHOMORE.id, 'bryan-sophomore');
  assert.equal(SOPHOMORE.kind, 'personality');
  assert.equal(SOPHOMORE.name, 'Bryan Martinez-Hernandez');
  assert.equal(SOPHOMORE.title, 'Sophomore');
  assert.equal(opponentStage(SOPHOMORE), 'Sophomore');
  assert.equal(SOPHOMORE.elo, 1350);
  assert.equal(SOPHOMORE.category, 'intermediate', 'sits with the mid-rated group');
  assert.equal(SOPHOMORE.initials, 'BM');
  assert.equal(SOPHOMORE.portraitPath, 'opponents/bryan-sophomore.webp');
  assert.ok(
    fs.existsSync('public/opponents/bryan-sophomore.webp'),
    'his own portrait, not the shared placeholder path',
  );
  assert.equal(SOPHOMORE.usesRepertoire, false);
  assert.match(SOPHOMORE.style, /defend/i);

  /* The card is two fields: name, then the subtext on its own line. */
  assert.doesNotMatch(SOPHOMORE.name, /\(/, 'the name carries no parenthetical suffix');
  assert.equal(opponentFullName(SOPHOMORE), 'Bryan Martinez-Hernandez (Sophomore)');
  assert.equal(opponentMeta(SOPHOMORE), 'Sophomore · 1350 Elo');

  assert.equal(PERSONALITY_OPPONENTS.length, 21);
  assert.equal(ALL_OPPONENTS.length, 22);
  assert.equal(
    PERSONALITY_OPPONENTS.filter((opponent) => opponent.id === 'bryan-sophomore').length,
    1,
    'registered once',
  );
  assert.equal(
    PERSONALITY_OPPONENTS.filter((opponent) => opponent.id.startsWith('bryan')).length,
    4,
    'four separate Bryan ids, no merge',
  );
});

test('he is grouped with the other mid-rated opponents, not the strong ones', () => {
  const beginners = PERSONALITY_OPPONENTS.filter(
    (opponent) => opponent.category === 'beginner',
  );
  const intermediate = PERSONALITY_OPPONENTS.filter(
    (opponent) => opponent.category === 'intermediate',
  );

  assert.ok(intermediate.some((opponent) => opponent.id === 'bryan-sophomore'));
  assert.equal(intermediate.includes(SOPHOMORE), true);
  assert.equal(beginners.includes(SOPHOMORE), false, 'no longer a beginner');

  /* Every beginner is below every intermediate card. */
  assert.ok(
    Math.max(...beginners.map((opponent) => opponent.elo)) <=
      Math.min(...intermediate.map((opponent) => opponent.elo)),
  );
  /* He is the lowest intermediate, and no beginner outrates him. */
  assert.equal(
    Math.min(...intermediate.map((opponent) => opponent.elo)),
    SOPHOMORE.elo,
  );
  assert.ok(Math.max(...beginners.map((opponent) => opponent.elo)) < SOPHOMORE.elo);

  const strong = PERSONALITY_OPPONENTS.filter(
    (opponent) => opponent.category === 'varsity' || opponent.category === 'big-4',
  );
  for (const opponent of strong) {
    assert.ok(opponent.elo > SOPHOMORE.elo, `${opponent.id} is stronger than him`);
  }
});

test('Junior and Prime are untouched additions, not replacements', () => {
  const junior = getOpponent('bryan');
  const prime = getOpponent('bryan-prime');
  assert.ok(junior);
  assert.ok(prime);
  assert.equal(junior.elo, 1800);
  assert.equal(junior.title, 'Junior');
  assert.equal(junior.category, 'varsity');
  assert.equal(prime.elo, 2000);
  assert.equal(prime.title, 'Prime');
  assert.equal(prime.category, 'big-4');

  assert.equal(new Set([junior.id, prime.id, SOPHOMORE.id]).size, 3);
  assert.equal(
    new Set([opponentFullName(junior), opponentFullName(prime), opponentFullName(SOPHOMORE)])
      .size,
    3,
    'saved games and PGN headers tell the three apart',
  );

  /* Their tendency tables are exactly what they were. */
  assert.deepEqual(
    [
      PERSONALITY_STYLES.bryan.aggression,
      PERSONALITY_STYLES.bryan.tactical,
      PERSONALITY_STYLES.bryan.complexity,
    ],
    [55, 45, 45],
  );
  for (const key of [
    'aggression',
    'risk',
    'positional',
    'tactical',
    'defensive',
    'initiative',
    'simplification',
    'complexity',
    'kingSafety',
    'material',
  ] as const) {
    assert.equal(PERSONALITY_STYLES['bryan-prime'][key], 50, `Prime ${key} unchanged`);
  }
});

test('a saved game resolves to this profile, not to the other Bryans', () => {
  const record = profileFromRecord({
    opponent_id: 'bryan-sophomore',
    opponent_name: 'Bryan Martinez-Hernandez (Sophomore)',
    opponent_elo: 1350,
    opponent_kind: 'personality',
  });
  assert.equal(record.id, 'bryan-sophomore');
  assert.equal(record.title, 'Sophomore');
  assert.equal(record.elo, 1350);

  /* The older ids still resolve to their own profiles. */
  assert.equal(
    profileFromRecord({
      opponent_id: 'bryan',
      opponent_name: 'Bryan Martinez-Hernandez',
      opponent_elo: 1800,
      opponent_kind: 'personality',
    }).title,
    'Junior',
  );
  assert.equal(
    profileFromRecord({
      opponent_id: 'bryan-prime',
      opponent_name: 'Bryan Martinez-Hernandez (Prime)',
      opponent_elo: 2000,
      opponent_kind: 'personality',
    }).title,
    'Prime',
  );
});

/* --------------------------- defensive identity --------------------------- */

test('his tendency table is the agreed defender profile', () => {
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
      positional: 50,
      tactical: 30,
      defensive: 95,
      initiative: 35,
      simplification: 75,
      complexity: 25,
      kingSafety: 95,
      material: 90,
    },
  );

  /* Defence is the defining strength: nothing else reaches it. */
  const values = [
    STYLE.aggression,
    STYLE.risk,
    STYLE.positional,
    STYLE.tactical,
    STYLE.defensive,
    STYLE.initiative,
    STYLE.simplification,
    STYLE.complexity,
    STYLE.kingSafety,
    STYLE.material,
  ];
  assert.equal(Math.max(...values), Math.max(STYLE.defensive, STYLE.kingSafety));
  assert.ok(STYLE.defensive < 100, 'a player, not a fortress');

  /* Tactics are the weakness, and noticeably so. */
  assert.ok(STYLE.defensive - STYLE.tactical >= 60);
  assert.ok(STYLE.tactical < STYLE.aggression);
  assert.ok(STYLE.tactical < STYLE.simplification);
  assert.ok(STYLE.tactical < JUNIOR.tactical, 'worse than his own Junior profile');
  assert.ok(STYLE.tactical < PRIME.tactical, 'and worse than Prime');
  assert.ok(STYLE.defensive > JUNIOR.defensive && STYLE.defensive > PRIME.defensive);
  assert.ok(STYLE.kingSafety > JUNIOR.kingSafety && STYLE.kingSafety > PRIME.kingSafety);

  /* The opening bias points at solid, not sharp. */
  assert.ok((STYLE.openingBias.solid ?? 0) > 0);
  assert.ok((STYLE.openingBias.sharp ?? 0) < 0);
  assert.equal(STYLE.sacrifice, 10, 'a defender gives material up only when forced');
});

test('given equal moves he keeps the king safe instead of creating activity', () => {
  const choice = choosePersonalityMove({
    fen: QUIET_OR_ACTIVE,
    candidates: [
      { uci: 'e1g1', scoreCp: 15, mate: null },
      { uci: 'f3g5', scoreCp: 15, mate: null },
    ],
    style: STYLE,
    elo: 1350,
    random: () => 0.9,
  });
  assert.equal(choice?.uci, 'e1g1', 'castling beats a knight adventure at equal evaluation');

  /* The same tie splits the table: Brandon takes the active move. */
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
  assert.equal(brandon?.uci, 'f3g5', 'the tendencies really do decide this tie');
});

test('taste cannot outvote a clearly better move', () => {
  const choice = choosePersonalityMove({
    fen: QUIET_OR_ACTIVE,
    candidates: [
      { uci: 'e1g1', scoreCp: 15, mate: null },
      { uci: 'f3g5', scoreCp: -120, mate: null },
    ],
    style: STYLE,
    elo: 1350,
    random: () => 0.9,
  });
  assert.equal(choice?.uci, 'e1g1');
  assert.equal(choice?.best, true);
});

test('a forced mate is still a forced mate', () => {
  const fen = '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1';
  const choice = choosePersonalityMove({
    fen,
    candidates: [
      { uci: 'a1a8', scoreCp: 0, mate: 1 },
      { uci: 'a1a7', scoreCp: 400, mate: null },
    ],
    style: STYLE,
    elo: 1350,
  });
  assert.equal(choice?.uci, 'a1a8', 'defensive taste never refuses a mate in one');
});

/* -------------------------------- strength -------------------------------- */

test('1350 is the strength dial: a wide window, fewer blunders than a beginner', () => {
  assert.equal(STYLE.accuracy, accuracyForElo(1350));
  assert.ok(STYLE.accuracy < JUNIOR.accuracy, 'less accurate than 1800');
  assert.ok(STYLE.accuracy < PRIME.accuracy, 'less accurate than 2000');
  assert.ok(STYLE.accuracy > accuracyForElo(1100), 'more accurate than Faadi');

  /* Weaker tactics are expressed as a wider tolerated gap, not a shallow
     search: the engine still searches at the depth his rating earns. */
  assert.equal(candidateGapForElo(1350), 115);
  assert.ok(candidateGapForElo(1350) > candidateGapForElo(1800));
  assert.ok(candidateGapForElo(1350) > candidateGapForElo(2000));

  const rate = blunderChance(1350);
  assert.ok(rate > blunderChance(1800), 'more mistakes than Junior');
  assert.ok(rate < blunderChance(1100), 'but far fewer than a 1100');
  assert.ok(rate > 0, 'he is not invincible either');
});

test('a chosen move is always legal, and always from the engine list', () => {
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
      elo: 1350,
      random: () => run / 8,
    });
    assert.ok(choice);
    assert.ok(candidates.some((candidate) => candidate.uci === choice.uci));
    assertLegal(fen, choice.uci);
    assert.ok(choice.gap <= candidateGapForElo(1350) + 20, 'inside the Elo window');
  }
});

/* ------------------------------- repertoire ------------------------------- */

test('his White book is the shared Vienna, not a copy of it', () => {
  const start = new Chess();
  assert.deepEqual(
    legalBookMoves(personalityBookFor('bryan-sophomore', 'w'), start).map((move) => move.san),
    ['e4'],
  );

  const vienna = position('e4', 'e5');
  assert.ok(
    legalBookMoves(personalityBookFor('bryan-sophomore', 'w'), vienna).some(
      (move) => move.san === 'Nc3',
    ),
  );

  const mine = personalityBooks('bryan-sophomore').w.book;
  const junior = personalityBooks('bryan').w.book;
  assert.ok(mine.size > 0);
  assert.deepEqual([...mine.keys()].sort(), [...junior.keys()].sort(), 'same Vienna positions');
  for (const [key, moves] of mine) {
    for (const move of moves) {
      /* A move can belong to more than one study line, but at least one of them
         is a Vienna chapter — the same filtered view Junior reads. */
      assert.ok(move.lineIds.some((id) => id.startsWith('brandon-vienna-')));
      assert.ok((junior.get(key) ?? []).some((entry) => entry.uci === move.uci));
    }
  }
});

test('his Black book is the shared Pirc, built from Johnfer’s lines', () => {
  const moves = legalBookMoves(
    personalityBookFor('bryan-sophomore', 'b'),
    position('e4'),
  ).map((move) => move.san);
  assert.ok(moves.includes('d6'), 'the Pirc meets 1.e4');
  assert.ok(!moves.includes('e5'));
  assert.ok(!moves.includes('e6'));

  const pirc = position('e4', 'd6', 'd4', 'Nf6', 'Nc3');
  assert.ok(
    legalBookMoves(personalityBookFor('bryan-sophomore', 'b'), pirc).some(
      (move) => move.san === 'g6',
    ),
  );

  const mine = personalityBooks('bryan-sophomore').b.book;
  const junior = personalityBooks('bryan').b.book;
  assert.deepEqual([...mine.keys()].sort(), [...junior.keys()].sort());
  for (const [, entries] of mine) {
    for (const move of entries) {
      assert.ok(move.lineIds.every((id) => id.startsWith('junior-pirc-')));
    }
  }

  /* 1.d4 is the King's Indian preference, not a book line. */
  assert.deepEqual(
    legalBookMoves(personalityBookFor('bryan-sophomore', 'b'), position('d4')).map(
      (move) => move.san,
    ),
    [],
  );
});

test('the Alapin is his answer to the Sicilian, as it is for the whole character', () => {
  const sicilian = position('e4', 'c5');
  assert.equal(bryanAlapinPreference(sicilian.fen(), ['e4', 'c5'], STYLE), 'c2c3');
  assertLegal(sicilian.fen(), 'c2c3');
  assert.equal(
    bryanAlapinPreference(position('e4', 'e5').fen(), ['e4', 'e5'], STYLE),
    null,
  );
  assert.equal(
    bryanAlapinPreference(sicilian.fen(), ['e4', 'c5'], styleFor('freshman', 1250) as PersonalityStyle),
    null,
    'the preference stays within the Bryan character',
  );
});

test('the King’s Indian setup is available to him against 1.d4', () => {
  const afterD4 = position('d4');
  const plan = kidPlan(afterD4.fen(), ['d4'], STYLE, () => 0.3);
  assert.ok(plan);
  assert.equal(plan.moves[0]?.uci, 'g8f6');
  for (const move of plan.moves) assertLegal(afterD4.fen(), move.uci);

  /* He finishes the skeleton before looking for a break. */
  const skeleton = ['d4', 'Nf6', 'Nf3', 'g6', 'c4', 'Bg7', 'Nc3', 'd6', 'e4'];
  const building = position(...skeleton);
  const buildingPlan = kidPlan(building.fen(), skeleton, STYLE, () => 0.5);
  assert.ok(buildingPlan);
  assert.equal(buildingPlan.setupComplete, false);
  assert.equal(buildingPlan.moves[0]?.uci, 'e8g8', 'castling before any break');

  /* Setup finished: the classical break appears, exactly as it does for Junior. */
  const history = [...skeleton, 'O-O', 'Be2'];
  const built = position(...history);
  const builtPlan = kidPlan(built.fen(), history, STYLE, () => 0.5);
  assert.ok(builtPlan);
  assert.equal(builtPlan.setupComplete, true);
  assert.ok(builtPlan.moves.some((move) => move.uci === 'e7e5'));
  assert.deepEqual(
    builtPlan.moves.map((move) => move.uci),
    kidPlan(built.fen(), history, JUNIOR, () => 0.5)?.moves.map((move) => move.uci),
    'the same shared plan Junior builds',
  );

  /* Against 1.e4 the Pirc owns the opening. */
  assert.equal(kidPlan(position('e4').fen(), ['e4'], STYLE), null);
});

test('every declaration still replays, including his', () => {
  const issues = repertoireIssues().filter((entry) => entry.issues.length > 0);
  assert.deepEqual(issues, []);
  assert.ok(
    repertoireIssues().some((entry) => entry.id === 'bryan-sophomore'),
    'his book is validated with the others',
  );
});

/* -------------------------------- dialogue -------------------------------- */

test('he speaks with Bryan’s voice, plus a defender’s lines', () => {
  const bank = DIALOGUE_BANKS['bryan-sophomore'];
  const bryan = DIALOGUE_BANKS.bryan;

  assert.deepEqual(Object.keys(bank).sort(), Object.keys(bryan).sort(), 'every event covered');
  for (const [event, lines] of Object.entries(bank)) {
    const inherited = bryan[event as keyof typeof bryan];
    /* Nothing was taken away from the shared voice. */
    for (const line of inherited) assert.ok(lines.includes(line), `${event} keeps "${line}"`);
  }

  /* The five defensive lines the brief asks for. */
  const spoken = [...bank.defense, ...bank.losing].join(' | ');
  for (const line of [
    'Nah, we’re holding this.',
    'I’m chilling. You’re gonna have to find something.',
    'Wait, I can defend this.',
    'It’s not over yet.',
    'I’m just trying to survive here.',
  ]) {
    assert.ok(spoken.includes(line), `missing: ${line}`);
  }

  /* All of it still reads like a person, not an engine. */
  for (const line of Object.values(bank).flat()) {
    assert.ok(line.length > 0 && line.length <= 100, line);
    assert.ok(!/[0-9]/.test(line), line);
    assert.ok(!/\b(eval|centipawn|engine|stockfish|depth)\b/i.test(line), line);
  }
});

test('his extra lines do not leak into Junior or Prime', () => {
  const bryan = DIALOGUE_BANKS.bryan;
  assert.equal(bryan.defense.length, 3, 'Junior’s bank is unchanged');
  assert.ok(!bryan.defense.includes('Nah, we’re holding this.'));
  assert.ok(!bryan.losing.includes('I’m just trying to survive here.'));
  assert.equal(DIALOGUE_BANKS['bryan-prime'], bryan, 'Prime still shares the original object');

  /* And his bank is its own object, so a later edit cannot cross over. */
  assert.notEqual(DIALOGUE_BANKS['bryan-sophomore'], bryan);
});

test('he does not talk after every move', () => {
  const state = createDialogueState();
  const first = maybeReact('bryan-sophomore', 'defense', { ply: 20, state, random: () => 0 });
  assert.ok(first);
  assert.equal(
    maybeReact('bryan-sophomore', 'defense', { ply: 22, state, random: () => 0 }),
    null,
    'the ordinary gap is respected',
  );

  /* The defensive pool alone is deep enough not to repeat itself immediately. */
  const seen = new Set([first!.text]);
  let ply = 20;
  for (let round = 0; round < 6; round += 1) {
    ply += 20;
    const line = maybeReact('bryan-sophomore', 'defense', { ply, state, random: () => 0.99 });
    assert.ok(line);
    assert.ok(!seen.has(line.text), 'no immediate repeats');
    seen.add(line.text);
  }
  assert.equal(seen.size, DIALOGUE_BANKS['bryan-sophomore'].defense.length);
});

/* ------------------------------- thinking --------------------------------- */

test('he thinks at an ordinary 1350 pace', () => {
  const plan = (style: PersonalityStyle) =>
    computeThinkingPlan({
      fen: new Chess().fen(),
      style,
      clockMs: null,
      incrementMs: 0,
      initialMs: 300_000,
      ply: 0,
      bookMove: false,
    });

  const his = plan(STYLE);
  assert.ok(his.budgetMs > 0);
  assert.ok(his.searchMs > 0, 'a real search, not a fixed shallow depth');
  assert.ok(his.deliberationMs >= 1000 && his.deliberationMs <= 6000);

  assert.ok(his.budgetMs < plan(JUNIOR).budgetMs, 'quicker than the 1800 profiles');
  assert.ok(his.budgetMs < plan(PRIME).budgetMs);
});
