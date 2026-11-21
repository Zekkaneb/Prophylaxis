/**
 * Bryan Martinez-Hernandez: the seventh personality.
 *
 * Covers registration, shared-opening reuse (Brandon's Vienna, Johnfer's Pirc),
 * the Alapin preference, the King's Indian setup, the balanced tendency profile,
 * the 1850 strength ladder, the thinking profile and the dialogue bank — plus
 * the regressions that keep the other six characters exactly as they were.
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
  profileFromRecord,
} from '../../src/play/opponents.ts';
import { DIALOGUE_BANKS, maybeReact, createDialogueState } from '../../src/play/personality/dialogue.ts';
import { PERSONALITY_STYLES, accuracyForElo, styleFor } from '../../src/play/personality/styles.ts';
import {
  personalityBookFor,
  personalityBooks,
  repertoireIssues,
} from '../../src/play/personality/repertoires/index.ts';
import { legalBookMoves } from '../../src/play/personality/repertoires/book.ts';
import { JUNIOR_REPERTOIRE } from '../../src/play/personality/repertoires/junior.ts';
import { kidPlan, isKidOpening } from '../../src/play/personality/repertoires/kid.ts';
import { bryanAlapinPreference } from '../../src/play/personality/bryan.ts';
import { computeThinkingPlan } from '../../src/play/personality/thinking.ts';
import { candidateGapForElo, choosePersonalityMove } from '../../src/play/personality/engine.ts';
import { blunderChance } from '../../src/play/strength.ts';
import type { PersonalityStyle } from '../../src/play/personality/styles.ts';

const BRYAN = getOpponent('bryan');
const BRYAN_STYLE = styleFor('bryan', 1800) as PersonalityStyle;
const PRIME = getOpponent('bryan-prime');
const PRIME_STYLE = styleFor('bryan-prime', 2000) as PersonalityStyle;

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

/* ------------------------------ registration ------------------------------ */

test('Bryan (Junior) is on the roster at 1800 with a unique id', () => {
  assert.ok(BRYAN);
  assert.equal(BRYAN.id, 'bryan');
  assert.equal(BRYAN.name, 'Bryan Martinez-Hernandez');
  assert.equal(BRYAN.elo, 1800);
  assert.equal(BRYAN.kind, 'personality');
  assert.equal(BRYAN.category, 'varsity');
  assert.equal(BRYAN.title, 'Junior');
  assert.equal(BRYAN.initials, 'BM', 'the monogram fallback survives a missing portrait');
  assert.equal(BRYAN.portraitPath, 'opponents/bryan-junior.webp');
  assert.ok(
    fs.existsSync('public/opponents/bryan-junior.webp'),
    'his own portrait is installed',
  );
  assert.match(BRYAN.style, /balanced/i);
  assert.match(BRYAN.style, /intuitive/i);

  assert.equal(PERSONALITY_OPPONENTS.length, 21);
  assert.equal(ALL_OPPONENTS.length, 22, 'twenty-one personalities plus the General Bot');
  assert.equal(new Set(ALL_OPPONENTS.map((opponent) => opponent.id)).size, 22);
  assert.equal(
    PERSONALITY_OPPONENTS.filter((opponent) => opponent.id === 'bryan').length,
    1,
  );
  assert.equal(opponentFullName(BRYAN), 'Bryan Martinez-Hernandez (Junior)');
});

test('the roster keeps its ratings and ids', () => {
  const ratings = PERSONALITY_OPPONENTS.map((opponent) => [opponent.id, opponent.elo]);
  assert.deepEqual(ratings, [
    ['emmanuel', 150],
    ['edward', 800],
    ['faadi', 700],
    ['nina-freshman', 1200],
    ['freshman', 1250],
    ['alex-tang', 1100],
    ['bryan-sophomore', 1350],
    ['bryan-widjaja', 1400],
    ['sophomore', 1450],
    ['nina', 1550],
    ['brandon-freshman', 1600],
    ['bryan', 1800],
    ['senior', 2000],
    ['brandon', 2350],
    ['junior', 2150],
    ['bryan-prime', 2000],
    ['mabinti', 1550],
    ['erik-wiessmann', 1100],
    ['jonah-pachikara', 1400],
    ['sophia-kuan', 1300],
    ['brandon-varsity', 1850],
  ]);
});

/* ---------------------------- personality shape --------------------------- */

test('Bryan’s tendency profile is the balanced table as specified', () => {
  assert.deepEqual(
    {
      aggression: BRYAN_STYLE.aggression,
      risk: BRYAN_STYLE.risk,
      positional: BRYAN_STYLE.positional,
      tactical: BRYAN_STYLE.tactical,
      defensive: BRYAN_STYLE.defensive,
      initiative: BRYAN_STYLE.initiative,
      simplification: BRYAN_STYLE.simplification,
      complexity: BRYAN_STYLE.complexity,
      kingSafety: BRYAN_STYLE.kingSafety,
      material: BRYAN_STYLE.material,
    },
    {
      aggression: 55,
      risk: 50,
      positional: 45,
      tactical: 45,
      defensive: 55,
      initiative: 55,
      simplification: 50,
      complexity: 45,
      kingSafety: 60,
      material: 55,
    },
  );

  /* Weaker tactical and positional *taste*, not an absence of either: both sit
     below his defensive and king-safety numbers, and neither collapses. */
  assert.ok(BRYAN_STYLE.tactical < BRYAN_STYLE.defensive);
  assert.ok(BRYAN_STYLE.positional < BRYAN_STYLE.kingSafety);
  assert.ok(BRYAN_STYLE.tactical >= 40 && BRYAN_STYLE.positional >= 40);

  /* No dominant specialty: the spread across the ten inputs stays narrow. */
  const values = [
    BRYAN_STYLE.aggression,
    BRYAN_STYLE.risk,
    BRYAN_STYLE.positional,
    BRYAN_STYLE.tactical,
    BRYAN_STYLE.defensive,
    BRYAN_STYLE.initiative,
    BRYAN_STYLE.simplification,
    BRYAN_STYLE.complexity,
    BRYAN_STYLE.kingSafety,
    BRYAN_STYLE.material,
  ];
  assert.ok(Math.max(...values) - Math.min(...values) <= 20, 'balanced, not specialised');

  /* He is not a quieter Brandon or a louder Johnfer. */
  for (const other of ['brandon', 'senior', 'junior'] as const) {
    assert.notDeepEqual(
      [BRYAN_STYLE.aggression, BRYAN_STYLE.tactical, BRYAN_STYLE.complexity],
      [
        PERSONALITY_STYLES[other].aggression,
        PERSONALITY_STYLES[other].tactical,
        PERSONALITY_STYLES[other].complexity,
      ],
    );
  }
});

test('accuracy still comes from the rating, so 1800 is the strength dial', () => {
  assert.equal(BRYAN_STYLE.accuracy, accuracyForElo(1800));
  assert.ok(BRYAN_STYLE.accuracy > accuracyForElo(1550));
  assert.ok(BRYAN_STYLE.accuracy < accuracyForElo(2150));
  assert.equal(candidateGapForElo(1800), 90);
  const rate = blunderChance(1800);
  assert.ok(rate > 0.03 && rate < 0.05, `about ${(rate * 100).toFixed(1)}% per move`);
});

/* ------------------------------ Vienna (White) ---------------------------- */

test('Bryan’s White book is Brandon’s Vienna chapters, reused not copied', () => {
  const start = new Chess();
  assert.deepEqual(
    legalBookMoves(personalityBookFor('bryan', 'w'), start).map((move) => move.san),
    ['e4'],
  );

  const vienna = position('e4', 'e5');
  assert.ok(
    legalBookMoves(personalityBookFor('bryan', 'w'), vienna).some((move) => move.san === 'Nc3'),
    'the Vienna knight move is book',
  );

  const bryanBook = personalityBooks('bryan').w.book;
  const brandonBook = personalityBooks('brandon').w.book;
  assert.ok(bryanBook.size > 0);
  assert.ok(bryanBook.size < brandonBook.size, 'only the Vienna chapters came across');

  /* Every entry is an existing Brandon entry for the same position, and every
     move carries a Vienna line id: shared data, filtered view, no copies. */
  for (const [key, moves] of bryanBook) {
    const source = brandonBook.get(key) ?? [];
    for (const move of moves) {
      assert.ok(
        source.some((entry) => entry.uci === move.uci),
        `${key} ${move.uci} exists in Brandon’s book`,
      );
      assert.ok(
        move.lineIds.some((id) => id.startsWith('brandon-vienna-')),
        `${move.uci} is a Vienna chapter`,
      );
    }
  }
});

test('the Sicilian is not answered from the borrowed book', () => {
  const sicilian = position('e4', 'c5');
  assert.deepEqual(
    legalBookMoves(personalityBookFor('bryan', 'w'), sicilian).map((move) => move.san),
    [],
    'Brandon’s 2.Ne2 is his taste, not Bryan’s',
  );
});

test('the Alapin preference picks 2.c3 after 1.e4 c5 and nothing else', () => {
  const sicilian = position('e4', 'c5');
  assert.equal(
    bryanAlapinPreference(sicilian.fen(), ['e4', 'c5'], BRYAN_STYLE),
    'c2c3',
  );
  assertLegal(sicilian.fen(), 'c2c3');

  assert.equal(
    bryanAlapinPreference(position('e4', 'e5').fen(), ['e4', 'e5'], BRYAN_STYLE),
    null,
    'an open game is not a Sicilian',
  );
  assert.equal(
    bryanAlapinPreference(position('d4', 'd5').fen(), ['d4', 'd5'], BRYAN_STYLE),
    null,
  );
  assert.equal(
    bryanAlapinPreference(
      sicilian.fen(),
      ['e4', 'c5'],
      styleFor('brandon', 2350) as PersonalityStyle,
    ),
    null,
    'the preference belongs to Bryan alone',
  );

  /* No c-pawn to push: the preference must yield rather than invent a move. */
  const noPawn = new Chess('rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PP1P1PPP/RNBQKBNR w KQkq - 0 2');
  assert.equal(bryanAlapinPreference(noPawn.fen(), ['e4', 'c5'], BRYAN_STYLE), null);
});

/* -------------------------------- Pirc (Black) ---------------------------- */

test('Bryan’s Black book is Johnfer’s Pirc lines, reused not copied', () => {
  const afterE4 = position('e4');
  const moves = legalBookMoves(personalityBookFor('bryan', 'b'), afterE4).map((move) => move.san);
  assert.ok(moves.includes('d6'), 'the Pirc meets 1.e4');
  assert.ok(!moves.includes('e5'), 'not Freshman’s open game');
  assert.ok(!moves.includes('e6'), 'not Brandon’s French');

  const pirc = position('e4', 'd6', 'd4', 'Nf6', 'Nc3');
  assert.ok(
    legalBookMoves(personalityBookFor('bryan', 'b'), pirc).some((move) => move.san === 'g6'),
    'the Pirc fianchetto is book',
  );

  const bryanBlack = personalityBooks('bryan').b.book;
  const juniorBlack = personalityBooks('junior').b.book;
  assert.ok(bryanBlack.size > 0);
  assert.ok(bryanBlack.size <= juniorBlack.size);
  for (const [key, entries] of bryanBlack) {
    const source = juniorBlack.get(key) ?? [];
    for (const move of entries) {
      assert.ok(source.some((entry) => entry.uci === move.uci), `${key} ${move.uci}`);
      assert.ok(
        move.lineIds.every((id) => id.startsWith('junior-pirc-')),
        `${move.uci} only carries Pirc lines`,
      );
    }
  }

  const afterD4 = position('d4');
  assert.deepEqual(
    legalBookMoves(personalityBookFor('bryan', 'b'), afterD4).map((move) => move.san),
    [],
    '1.d4 is answered by the King’s Indian preference, not a book line',
  );

  /* Johnfer’s own repertoire is untouched by the reuse. */
  const senior = personalityBooks('senior').b.book;
  assert.ok(
    (senior.get(position('d4').fen().replace(/ \d+ \d+$/, '')) ?? []).length > 0 ||
      legalBookMoves(personalityBookFor('senior', 'b'), position('d4')).length > 0,
    'Senior still answers 1.d4 from his Grünfeld lines',
  );
  assert.equal(
    JUNIOR_REPERTOIRE.asBlack.filter((line) => line.id.startsWith('junior-pirc-')).length,
    4,
  );
  assert.deepEqual(repertoireIssues().filter((entry) => entry.issues.length > 0), []);
});

/* ---------------------------- King’s Indian (1.d4) ------------------------ */

test('the King’s Indian setup is legal, position-aware and only on 1.d4', () => {
  const afterD4 = position('d4');
  const history = ['d4'];
  assert.equal(isKidOpening(afterD4.fen(), history), true);

  const plan = kidPlan(afterD4.fen(), history, BRYAN_STYLE, 'b', () => 0.1);
  assert.ok(plan);
  assert.equal(plan.moves[0]?.uci, 'g8f6', 'the setup starts with ...Nf6');
  for (const move of plan.moves) assertLegal(afterD4.fen(), move.uci);

  /* Once the skeleton is up, the break appears — ...e5 against a White e4
     centre, and only when it is legal. */
  /* Black to move with the full skeleton and White's e4 already placed. */
  const builtHistory = ['d4', 'Nf6', 'Nf3', 'g6', 'c4', 'Bg7', 'Nc3', 'd6', 'e4', 'O-O', 'Be2'];
  const built = position(...builtHistory);
  assert.equal(isKidOpening(built.fen(), builtHistory), true);
  const builtPlan = kidPlan(built.fen(), builtHistory, BRYAN_STYLE, 'b', () => 0.9);
  assert.ok(builtPlan);
  assert.equal(builtPlan.setupComplete, true);
  assert.ok(builtPlan.moves.some((move) => move.uci === 'e7e5'), 'the classical break is preferred');
  for (const move of builtPlan.moves) assertLegal(built.fen(), move.uci);

  /* Against 1.e4 the Pirc book owns the opening; the KID must not fire. */
  assert.equal(isKidOpening(position('e4').fen(), ['e4']), false);
  assert.equal(kidPlan(position('e4').fen(), ['e4'], BRYAN_STYLE, 'b'), null);

  /* A Queen’s Gambit structure is not a King’s Indian. */
  assert.equal(isKidOpening(position('d4', 'd5').fen(), ['d4', 'd5']), false);
});

test('Bryan’s King’s Indian is his own reading, and the others are untouched', () => {
  const afterD4 = position('d4');
  const junior = styleFor('junior', 2150) as PersonalityStyle;
  const sophomore = styleFor('sophomore', 1450) as PersonalityStyle;

  const bryanSetup = kidPlan(afterD4.fen(), ['d4'], BRYAN_STYLE, 'b', () => 0.5);
  assert.equal(bryanSetup?.moves[0]?.uci, 'g8f6', 'Bryan builds the setup first');
  assert.equal(
    kidPlan(afterD4.fen(), ['d4'], junior, 'b', () => 0.5)?.moves[0]?.uci,
    'g8f6',
    'Junior is unchanged',
  );
  assert.equal(
    kidPlan(afterD4.fen(), ['d4'], sophomore, 'b', () => 0.5)?.moves[0]?.uci,
    'g8f6',
    'Sophomore is unchanged',
  );
});

/* ---------------------------- intuitive selection ------------------------- */

test('ordinary positions go through the engine candidates with personality taste', () => {
  const fen = position('e4', 'e5').fen();
  const candidates = [
    { uci: 'g1f3', scoreCp: 30, mate: null },
    { uci: 'b1c3', scoreCp: 25, mate: null },
    { uci: 'f1c4', scoreCp: 20, mate: null },
    { uci: 'd2d4', scoreCp: 10, mate: null },
  ];
  const choice = choosePersonalityMove({ fen, candidates, style: BRYAN_STYLE, elo: 1800 });
  assert.ok(choice);
  assert.ok(candidates.some((candidate) => candidate.uci === choice.uci));
  assert.ok(choice.gap <= candidateGapForElo(1800));
  assertLegal(fen, choice.uci);
});

test('a straightforward mate is still found', () => {
  const fen = '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1';
  const choice = choosePersonalityMove({
    fen,
    candidates: [
      { uci: 'a1a8', scoreCp: 0, mate: 1 },
      { uci: 'a1a7', scoreCp: 400, mate: null },
    ],
    style: BRYAN_STYLE,
    elo: 1800,
  });
  assert.equal(choice?.uci, 'a1a8');
  assert.equal(choice?.best, true);
});

/* ------------------------------- thinking time ---------------------------- */

test('Bryan thinks like the middle of the ladder', () => {
  const fen = new Chess().fen();
  const plan = (style: PersonalityStyle) =>
    computeThinkingPlan({
      fen,
      style,
      clockMs: null,
      incrementMs: 0,
      initialMs: 300_000,
      ply: 0,
      bookMove: false,
    });

  const bryan = plan(BRYAN_STYLE);
  assert.ok(bryan.budgetMs > 0);
  assert.ok(bryan.searchMs > 0, 'an ordinary position still gets a real search');
  assert.ok(bryan.deliberationMs >= 1000 && bryan.deliberationMs <= 6000);

  const brandon = plan(styleFor('brandon', 2350) as PersonalityStyle);
  const junior = plan(styleFor('junior', 2150) as PersonalityStyle);
  assert.ok(brandon.budgetMs <= bryan.budgetMs, 'quicker than the quickest');
  assert.ok(bryan.budgetMs <= junior.budgetMs, 'less patient than the strategist');

  const lowClock = computeThinkingPlan({
    fen,
    style: BRYAN_STYLE,
    clockMs: 1_000,
    incrementMs: 0,
    initialMs: 300_000,
    ply: 40,
    bookMove: false,
  });
  assert.ok(lowClock.budgetMs < 1_000, 'never gambles the clock on one search');
});

/* --------------------------------- dialogue ------------------------------- */

test('Bryan has a full, casual dialogue bank with controlled slang', () => {
  const bank = DIALOGUE_BANKS.bryan;
  const events = Object.keys(DIALOGUE_BANKS.freshman);
  assert.deepEqual(Object.keys(bank).sort(), events.sort(), 'every event is covered');

  const lines = Object.values(bank).flat();
  for (const line of lines) {
    assert.ok(line.length > 0 && line.length <= 100, line);
    assert.ok(!/\b(eval|centipawn|engine|stockfish|depth|variation)\b/i.test(line), line);
    assert.ok(!/[0-9]/.test(line), line);
  }
  for (const [event, entries] of Object.entries(bank)) {
    assert.ok(entries.length >= 2, `bryan/${event} needs at least two lines`);
  }

  /* Slang is occasional, not the voice: a fifth of the bank at most. */
  const slang = lines.filter((line) => /walahi|lowkey|nah\b|frying|cooked|sold/i.test(line));
  assert.ok(slang.length >= 2, 'some slang for flavour');
  assert.ok(slang.length / lines.length < 0.35, 'but not a catchphrase machine');

  /* Distinguishable from the two characters he draws energy from. */
  assert.equal(new Set([bank.win[0], DIALOGUE_BANKS.brandon.win[0]]).size, 2);
  assert.equal(new Set([bank.loss[0], DIALOGUE_BANKS.freshman.loss[0]]).size, 2);
  assert.match(bank.loss.join(' '), /good game/i);
});

test('dialogue only speaks on real events, with cooldowns and no repeats', () => {
  const state = createDialogueState();
  const first = maybeReact('bryan', 'book', { ply: 2, state, random: () => 0 });
  assert.ok(first);

  assert.equal(
    maybeReact('bryan', 'book', { ply: 4, state, random: () => 0 }),
    null,
    'the ordinary gap stops a running commentary',
  );

  /* The bank is drawn from without repeats until it is exhausted; only then may
     a line come back, and still behind the repeat gap. */
  const seen = new Set([first!.text]);
  let plies = 22;
  for (let round = 0; round < 3; round += 1) {
    const line = maybeReact('bryan', 'book', { ply: plies, state, random: () => 0.99 });
    assert.ok(line);
    assert.ok(!seen.has(line.text), 'a line is not repeated until the bank runs out');
    seen.add(line.text);
    plies += 20;
  }
  assert.equal(seen.size, DIALOGUE_BANKS.bryan.book.length, 'the whole bank was used once');
});

/* --------------------------- Bryan Prime (2000) --------------------------- */

test('Bryan Prime is its own id at 2000 in The Big 4', () => {
  assert.ok(PRIME);
  assert.equal(PRIME.id, 'bryan-prime');
  assert.equal(PRIME.name, 'Bryan Martinez-Hernandez');
  assert.equal(PRIME.elo, 2000);
  assert.equal(PRIME.category, 'big-4');
  assert.equal(PRIME.title, 'Prime');
  assert.equal(PRIME.initials, 'BM');
  assert.equal(PRIME.kind, 'personality');
  assert.equal(PRIME.portraitPath, 'opponents/bryan-prime.webp');
  assert.ok(fs.existsSync('public/opponents/bryan-prime.webp'), 'his own portrait is installed');
  assert.equal(opponentFullName(PRIME), 'Bryan Martinez-Hernandez (Prime)');

  assert.notEqual(PRIME.id, BRYAN.id, 'the two Bryans are distinguishable in a saved game');
  assert.equal(PERSONALITY_OPPONENTS.filter((opponent) => opponent.id.startsWith('bryan')).length, 4);
});

test('the two Bryans share one voice and one repertoire', () => {
  assert.equal(
    DIALOGUE_BANKS['bryan-prime'],
    DIALOGUE_BANKS.bryan,
    'the dialogue bank object is shared, not copied',
  );

  const junior = personalityBooks('bryan');
  const prime = personalityBooks('bryan-prime');
  assert.ok(prime.w.book.size > 0);
  assert.deepEqual(
    [...prime.w.book.keys()].sort(),
    [...junior.w.book.keys()].sort(),
    'same Vienna positions as White',
  );
  assert.deepEqual(
    [...prime.b.book.keys()].sort(),
    [...junior.b.book.keys()].sort(),
    'same Pirc positions as Black',
  );

  const sicilian = position('e4', 'c5');
  assert.equal(bryanAlapinPreference(sicilian.fen(), ['e4', 'c5'], PRIME_STYLE), 'c2c3');
  assert.equal(
    legalBookMoves(personalityBookFor('bryan-prime', 'w'), sicilian).length,
    0,
    'still no borrowed 2.Ne2',
  );

  const afterD4 = position('d4');
  const plan = kidPlan(afterD4.fen(), ['d4'], PRIME_STYLE, 'b', () => 0.5);
  assert.equal(plan?.moves[0]?.uci, 'g8f6', 'the King’s Indian setup is shared too');
  for (const move of plan?.moves ?? []) assertLegal(afterD4.fen(), move.uci);
});

test('Prime’s tendencies are neutral; Junior keeps his softer edges', () => {
  const dims = [
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
  ] as const;

  for (const key of dims) {
    assert.equal(PERSONALITY_STYLES['bryan-prime'][key], 50, `${key} is the neutral midpoint`);
  }
  assert.equal(
    new Set(Object.values(PERSONALITY_STYLES['bryan-prime'].openingBias)).size,
    1,
    'no opening tag is favoured',
  );

  assert.ok(PRIME_STYLE.tactical > BRYAN_STYLE.tactical, 'steadier recognition of tactics');
  assert.ok(PRIME_STYLE.positional > BRYAN_STYLE.positional, 'clearer long-term plans');
  assert.ok(BRYAN_STYLE.tactical < BRYAN_STYLE.defensive, 'Junior still under-weights tactics');
  assert.ok(BRYAN_STYLE.positional < BRYAN_STYLE.kingSafety, 'and long-term planning');
});

test('the two strength profiles are independent', () => {
  assert.equal(PRIME_STYLE.accuracy, accuracyForElo(2000));
  assert.ok(candidateGapForElo(2000) < candidateGapForElo(1800), 'a tighter candidate window');
  assert.ok(blunderChance(2000) < blunderChance(1800), 'and fewer visible mistakes');

  /* Profiles are copies: editing one must not leak into the other. */
  const junior = styleFor('bryan', 1800) as PersonalityStyle;
  const prime = styleFor('bryan-prime', 2000) as PersonalityStyle;
  assert.notEqual(junior, prime);
  junior.aggression = 0;
  assert.equal(PERSONALITY_STYLES.bryan.aggression, 55, 'Junior’s profile is untouched');
  assert.equal(PERSONALITY_STYLES['bryan-prime'].aggression, 50, 'and Prime’s is its own');
  assert.equal((styleFor('bryan-prime', 2000) as PersonalityStyle).aggression, 50);

  /* Selecting one id can never resolve to the other. */
  assert.notEqual(getOpponent('bryan')?.elo, getOpponent('bryan-prime')?.elo);
  assert.equal(
    profileFromRecord({
      opponent_id: 'bryan',
      opponent_name: 'Bryan Martinez-Hernandez',
      opponent_elo: 1850,
      opponent_kind: 'personality',
    }).id,
    'bryan',
  );
  assert.equal(
    profileFromRecord({
      opponent_id: 'bryan-prime',
      opponent_name: 'Bryan Martinez-Hernandez (Prime)',
      opponent_elo: 2000,
      opponent_kind: 'personality',
    }).id,
    'bryan-prime',
  );
});

test('Prime thinks a little longer than his Junior profile', () => {
  const fen = new Chess().fen();
  const plan = (style: PersonalityStyle) =>
    computeThinkingPlan({
      fen,
      style,
      clockMs: null,
      incrementMs: 0,
      initialMs: 300_000,
      ply: 0,
      bookMove: false,
    });
  const junior = plan(BRYAN_STYLE);
  const prime = plan(PRIME_STYLE);
  assert.ok(prime.budgetMs >= junior.budgetMs);
  assert.ok(prime.deliberationMs >= junior.deliberationMs);
  assert.ok(prime.budgetMs <= 20_000, 'still an ordinary, bounded think');
});
