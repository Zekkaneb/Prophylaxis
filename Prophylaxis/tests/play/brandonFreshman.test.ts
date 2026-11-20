/**
 * Brandon Tran (Freshman), 1600 — the funky attacker.
 *
 * Covers his independent identity beside Prime Brandon, the tendency table and
 * the ambition/accuracy split, the funk re-ranking of engine candidates, his
 * shared-but-reduced opening book (Vienna and French reused, Keres and Grünfeld
 * left to Prime, Open Sicilian and ...d5 mainlines added), his chapter-by-chapter
 * familiarity, the shared Brandon voice, bot-vs-bot play, and persistence.
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
  type PersonalityStyle,
} from '../../src/play/personality/styles.ts';
import { personalityBookFor, personalityBooks, repertoireIssues } from '../../src/play/personality/repertoires/index.ts';
import { legalBookMoves, type BookMove } from '../../src/play/personality/repertoires/book.ts';
import { BRANDON_BOOK } from '../../src/play/personality/repertoires/brandonBook.ts';
import {
  BRANDON_FRESHMAN_EXCLUDED_PREFIXES,
  BRANDON_FRESHMAN_MAINLINES,
} from '../../src/play/personality/repertoires/brandonFreshman.ts';
import {
  BRANDON_FRESHMAN_FAMILIARITY,
  BRANDON_FRESHMAN_FUNK,
  brandonFreshmanAllowsMove,
  brandonFreshmanFamily,
  brandonFreshmanForgetChance,
  brandonFreshmanFunkScore,
  chooseBrandonFreshmanBookMove,
  chooseBrandonFreshmanMove,
} from '../../src/play/personality/brandonFreshman.ts';
import { describeMove } from '../../src/play/personality/engine.ts';
import { isBlatantMaterialBlunder } from '../../src/play/blunders.ts';
import { chooseBotMove } from '../../src/play/personality/chooseMove.ts';
import { computeThinkingPlan } from '../../src/play/personality/thinking.ts';
import { blunderChance } from '../../src/play/strength.ts';
import { buildPgn } from '../../src/play/pgn.ts';
import type { PlayedGameRecord } from '../../src/play/types.ts';
import type { StockfishController } from '../../src/engine/useStockfish.ts';

const FRESH = getOpponent('brandon-freshman');
const PRIME = getOpponent('brandon');
const STYLE = styleFor('brandon-freshman', 1600) as PersonalityStyle;
const PRIME_STYLE = styleFor('brandon', 2350) as PersonalityStyle;

/** Italian Game: castle, or throw the bishop at f7 for a pawn and a check. */
const QUIET_OR_ATTACK = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 6';

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

/* ------------------------------ identity ---------------------------------- */

test('Freshman Brandon is his own opponent, 1600, in the Strong group', () => {
  assert.ok(FRESH);
  assert.equal(FRESH.id, 'brandon-freshman');
  assert.equal(FRESH.kind, 'personality');
  assert.equal(FRESH.name, 'Brandon Tran');
  assert.equal(FRESH.title, 'Freshman');
  assert.equal(FRESH.elo, 1600);
  assert.equal(FRESH.category, 'strong');
  assert.equal(FRESH.shortName, 'Brandon Frosh');
  assert.equal(FRESH.initials, 'BT');
  assert.equal(FRESH.usesRepertoire, false);

  /* Two fields on the card, one unambiguous string for stored games. */
  assert.equal(opponentStage(FRESH), 'Freshman');
  assert.equal(opponentMeta(FRESH), 'Freshman · 1600 Elo');
  assert.equal(opponentFullName(FRESH), 'Brandon Tran (Freshman)');
  assert.doesNotMatch(FRESH.name, /\(/);

  assert.match(FRESH.style, /funky/i);
  assert.match(FRESH.style, /attack/i);
});

test('Prime is untouched and the two Brandons stay separately selectable', () => {
  assert.ok(PRIME);
  assert.equal(PRIME.id, 'brandon');
  assert.equal(PRIME.title, 'Prime');
  assert.equal(PRIME.elo, 2350);
  assert.equal(PRIME.category, 'big-3');
  assert.equal(PRIME.portraitPath, 'opponents/brandon.webp');
  assert.notEqual(PRIME.id, FRESH.id);
  assert.notEqual(opponentFullName(PRIME), opponentFullName(FRESH));
  assert.notEqual(PRIME.elo, FRESH.elo);

  /* Same person at an earlier stage, with his own portrait file. */
  assert.equal(FRESH.portraitPath, 'opponents/brandon-freshman.webp');
  assert.notEqual(FRESH.portraitPath, PRIME.portraitPath);
  assert.equal(fs.existsSync('public/opponents/brandon-freshman.webp'), true);
  assert.equal(fs.existsSync('public/opponents/brandon.webp'), true);

  assert.equal(
    PERSONALITY_OPPONENTS.filter((opponent) => opponent.name === 'Brandon Tran').length,
    2,
  );
  const strong = PERSONALITY_OPPONENTS.filter(
    (opponent) => opponent.category === 'strong',
  ).map((opponent) => opponent.id);
  assert.ok(strong.includes('brandon-freshman'));
  assert.ok(strong.indexOf('brandon-freshman') < strong.indexOf('bryan'));
  assert.equal(ALL_OPPONENTS.length, 16);
  assert.equal(new Set(ALL_OPPONENTS.map((opponent) => opponent.id)).size, 16);
});

test('saved games resolve each Brandon to his own version', () => {
  const prime = profileFromRecord({
    opponent_id: 'brandon',
    opponent_name: 'Brandon Tran (Prime)',
    opponent_elo: 2350,
    opponent_kind: 'personality',
  });
  const fresh = profileFromRecord({
    opponent_id: 'brandon-freshman',
    opponent_name: 'Brandon Tran (Freshman)',
    opponent_elo: 1600,
    opponent_kind: 'personality',
  });
  assert.equal(prime.title, 'Prime');
  assert.equal(fresh.title, 'Freshman');
  assert.equal(fresh.elo, 1600);
  assert.equal(fresh.category, 'strong');
  assert.notEqual(prime.id, fresh.id);
});

/* ---------------------------- playing style ------------------------------- */

test('his tendencies are the funky attacker table', () => {
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
      aggression: 90,
      risk: 85,
      positional: 40,
      tactical: 75,
      defensive: 35,
      initiative: 95,
      simplification: 20,
      complexity: 95,
      kingSafety: 45,
      material: 30,
    },
  );
  assert.equal(STYLE.sacrifice, 80);
  assert.ok((STYLE.openingBias.sharp ?? 0) > 0);
  assert.ok((STYLE.openingBias.solid ?? 0) < 0);
});

test('tactical ambition is Prime’s; tactical accuracy is the 1600 rating', () => {
  /* Ambition: he still looks for tactics almost as often as Prime. */
  assert.ok(STYLE.tactical >= 70);
  assert.ok(STYLE.aggression > PERSONALITY_STYLES.bryan.aggression);
  assert.ok(STYLE.initiative > PERSONALITY_STYLES.senior.initiative);
  assert.ok(STYLE.complexity > PERSONALITY_STYLES.nina.complexity);
  assert.ok(STYLE.material < PERSONALITY_STYLES.senior.material);
  assert.ok(STYLE.sacrifice > PERSONALITY_STYLES.faadi.sacrifice);

  /* Accuracy: the same ambition, judged far worse. Derived, never hand-set. */
  assert.equal(STYLE.accuracy, accuracyForElo(1600));
  assert.ok(STYLE.accuracy < PRIME_STYLE.accuracy);
  assert.ok(accuracyForElo(1600) < accuracyForElo(2350));
  assert.ok(blunderChance(1600) > blunderChance(2350));
  assert.ok(blunderChance(1600) < blunderChance(1250));
});

test('the funk bonus likes attacks and dislikes quiet trades and castling', () => {
  const quiet = describeMove(QUIET_OR_ATTACK, 'e1g1');
  const attack = describeMove(QUIET_OR_ATTACK, 'c4f7');
  assert.ok(quiet);
  assert.ok(attack);
  assert.equal(attack.check, true);
  assert.equal(attack.sacrifices, true);

  assert.ok(brandonFreshmanFunkScore(attack) > brandonFreshmanFunkScore(quiet));
  assert.ok(brandonFreshmanFunkScore(quiet) < 0, 'castling is a cold idea to him');

  /* The numbers are centipawns, not a licence: the whole bonus fits inside a
     candidate gap a 1600 is already allowed. */
  assert.ok(BRANDON_FRESHMAN_FUNK.sacrificeBonus <= 20);
  assert.ok(BRANDON_FRESHMAN_FUNK.speculationChance < 0.25);
});

test('he takes the checking idea over the solid castle when they are equal', () => {
  const chosen = chooseBrandonFreshmanMove({
    fen: QUIET_OR_ATTACK,
    candidates: [
      { uci: 'e1g1', scoreCp: 20, mate: null },
      { uci: 'c4f7', scoreCp: 20, mate: null },
    ],
    style: STYLE,
    elo: 1600,
    random: () => 0.9,
  });
  assert.equal(chosen?.uci, 'c4f7');

  /* The same position, the same two moves: Prime also likes the bishop, but the
     shared scorer is what decides for him, not this module. */
  assert.equal(
    chooseBrandonFreshmanMove({
      fen: QUIET_OR_ATTACK,
      candidates: [{ uci: 'e1g1', scoreCp: 20, mate: null }],
      style: PRIME_STYLE,
      elo: 2350,
    }),
    null,
    'no other character is re-ranked by his funk',
  );
});

test('a losing move is never funk, and a free piece is refused', () => {
  const safe = chooseBrandonFreshmanMove({
    fen: QUIET_OR_ATTACK,
    candidates: [
      { uci: 'e1g1', scoreCp: 200, mate: null },
      { uci: 'c4f7', scoreCp: -300, mate: null },
    ],
    style: STYLE,
    elo: 1600,
    random: () => 0,
  });
  assert.equal(safe?.uci, 'e1g1');

  /* A "sacrifice" is allowed because it checks the king; the guard only covers
     moves with nothing to show for the material. */
  for (const uci of ['e1g1', 'c4f7', 'f3g5', 'c3d5']) {
    const features = describeMove(QUIET_OR_ATTACK, uci);
    if (!features) continue;
    const allowed = brandonFreshmanAllowsMove(QUIET_OR_ATTACK, uci, features);
    const kingFacingSacrifice = features.sacrifices && (features.check || features.attacksKing);
    if (isBlatantMaterialBlunder(QUIET_OR_ATTACK, uci)) {
      assert.equal(allowed, kingFacingSacrifice, `${uci} is only allowed as an attack`);
    } else {
      assert.equal(allowed, true, `${uci} is not a blunder at all`);
    }
  }
  /* Without the move's features there is no justification, so the guard's
     refusal stands rather than being taken on trust. */
  assert.equal(brandonFreshmanAllowsMove(QUIET_OR_ATTACK, 'c4f7', null), false);
  assert.equal(
    brandonFreshmanAllowsMove(QUIET_OR_ATTACK, 'e1g1', null),
    true,
    'a move that is not a blunder needs no justification',
  );
});

test('the speculative turn picks the boldest plausible idea, not the best one', () => {
  const candidates = [
    { uci: 'e1g1', scoreCp: 40, mate: null },
    { uci: 'c4f7', scoreCp: -20, mate: null },
  ];
  const speculative = chooseBrandonFreshmanMove({
    fen: QUIET_OR_ATTACK,
    candidates,
    style: STYLE,
    elo: 1600,
    /* 0 passes the speculation roll and then picks the first ambition. */
    random: () => 0,
  });
  assert.equal(speculative?.uci, 'c4f7');
  assert.equal(speculative?.best, false);
  assertLegal(QUIET_OR_ATTACK, speculative!.uci);

  const ordinary = chooseBrandonFreshmanMove({
    fen: QUIET_OR_ATTACK,
    candidates,
    style: STYLE,
    elo: 1600,
    random: () => 0.99,
  });
  assert.equal(ordinary?.uci, 'e1g1', 'without the roll he still prefers the sound move here');
});

test('a mate is not a style question', () => {
  const mate = '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1';
  assert.equal(
    chooseBrandonFreshmanMove({
      fen: mate,
      candidates: [{ uci: 'a1a8', scoreCp: 0, mate: 1 }],
      style: STYLE,
      elo: 1600,
    }),
    null,
    'the shared scorer takes forced mates',
  );
});

/* ------------------------------ repertoire -------------------------------- */

test('his White book is the Vienna plus Open Sicilian mainlines', () => {
  const start = new Chess();
  assert.deepEqual(
    legalBookMoves(personalityBookFor('brandon-freshman', 'w'), start).map((move) => move.san),
    ['e4'],
  );
  assert.deepEqual(
    legalBookMoves(personalityBookFor('brandon-freshman', 'w'), position('e4', 'e5')).map(
      (move) => move.san,
    ),
    ['Nc3'],
    'the Vienna move order is shared with Prime',
  );
  assert.deepEqual(
    legalBookMoves(
      personalityBookFor('brandon-freshman', 'w'),
      position('e4', 'e5', 'Nc3', 'Nf6'),
    ).map((move) => move.san),
    ['f4'],
    'the Vienna Gambit idea is still his',
  );

  const sicilian = position('e4', 'c5');
  assert.deepEqual(
    legalBookMoves(personalityBookFor('brandon-freshman', 'w'), sicilian).map((move) => move.san),
    ['Nf3'],
    'a conventional mainline answer, not 2.Ne2',
  );
  assert.ok(
    ![...personalityBooks('brandon-freshman').w.book.values()]
      .flat()
      .some((move) => move.san === 'Ne2'),
    'the Keres system is nowhere in his book',
  );

  const najdorf = position('e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6');
  assert.deepEqual(
    legalBookMoves(personalityBookFor('brandon-freshman', 'w'), najdorf).map((move) => move.san),
    ['Be3'],
  );
});

test('his Black book is the French plus ...d5 mainlines, never the Grünfeld', () => {
  assert.deepEqual(
    legalBookMoves(personalityBookFor('brandon-freshman', 'b'), position('e4')).map(
      (move) => move.san,
    ),
    ['e6'],
    'the French Defence is shared with Prime',
  );
  assert.deepEqual(
    legalBookMoves(
      personalityBookFor('brandon-freshman', 'b'),
      position('e4', 'e6', 'd4'),
    ).map((move) => move.san),
    ['d5'],
  );
  assert.ok(
    legalBookMoves(
      personalityBookFor('brandon-freshman', 'b'),
      position('e4', 'e6', 'd4', 'd5', 'Nc3'),
    )
      .map((move) => move.san)
      .includes('Bb4'),
    'the Winawer/Nimzo structures come out of the shared French chapter',
  );

  const d4 = legalBookMoves(personalityBookFor('brandon-freshman', 'b'), position('d4'));
  assert.ok(d4.some((move) => move.san === 'd5'), 'a queen’s-pawn mainline, not the Grünfeld');
  assert.ok(
    ![...personalityBooks('brandon-freshman').b.book.values()]
      .flat()
      .some((move) => move.lineIds.some((id) => id.startsWith('brandon-gruenfeld-'))),
    'no Grünfeld chapter reaches his Black book',
  );
  assert.deepEqual(
    legalBookMoves(
      personalityBookFor('brandon-freshman', 'b'),
      position('d4', 'Nf6', 'c4', 'g6'),
    ),
    [],
    'a Grünfeld position is not his book at all',
  );
});

test('Prime keeps the Keres and Grünfeld chapters that Freshman does not have', () => {
  const primeWhite = legalBookMoves(personalityBookFor('brandon', 'w'), position('e4', 'c5'));
  assert.deepEqual(primeWhite.map((move) => move.san), ['Ne2']);
  const primeBlack = legalBookMoves(personalityBookFor('brandon', 'b'), position('d4'));
  assert.ok(primeBlack.some((move) => move.san === 'Nf6'));
  assert.ok(!primeBlack.some((move) => move.san === 'd5'));

  /* The compiled source still carries all five supplied studies. */
  const prefixes = new Set(
    BRANDON_BOOK.flatMap((entry) => entry.lineIds.map((id) => id.split('-').slice(0, 2).join('-'))),
  );
  for (const prefix of ['brandon-vienna', 'brandon-sicilian', 'brandon-austrian', 'brandon-french', 'brandon-gruenfeld']) {
    assert.ok(prefixes.has(prefix), `${prefix} is still in Prime’s book`);
  }
  for (const prefix of BRANDON_FRESHMAN_EXCLUDED_PREFIXES) {
    assert.ok(prefixes.has(prefix.replace(/-$/, '')), `${prefix} was not deleted from the source`);
  }
});

test('the shared chapters are the same compiled entries, not copies', () => {
  assert.deepEqual(repertoireIssues().filter((entry) => entry.issues.length > 0), []);
  assert.ok(repertoireIssues().some((entry) => entry.id === 'brandon-freshman'));

  /* Every Vienna/French entry Freshman owns also exists in Prime's book with
     the same move, which is what "reused" has to mean. */
  const primeWhite = personalityBooks('brandon').w.book;
  const freshWhite = personalityBooks('brandon-freshman').w.book;
  let shared = 0;
  for (const [key, moves] of freshWhite) {
    const primeMoves = primeWhite.get(key);
    if (!primeMoves) continue;
    for (const move of moves) {
      if (!move.lineIds.some((id) => id.startsWith('brandon-vienna-'))) continue;
      assert.ok(
        primeMoves.some((entry) => entry.uci === move.uci),
        `${move.san} at ${key} is Prime’s own entry`,
      );
      shared += 1;
    }
  }
  assert.ok(shared > 20, `shared Vienna entries: ${shared}`);

  /* His hand-written mainlines are declared once, in his own file. */
  assert.equal(BRANDON_FRESHMAN_MAINLINES.asWhite.length, 5);
  assert.equal(BRANDON_FRESHMAN_MAINLINES.asBlack.length, 5);
  const lineIds = [
    ...BRANDON_FRESHMAN_MAINLINES.asWhite,
    ...BRANDON_FRESHMAN_MAINLINES.asBlack,
  ].map((line) => line.id);
  assert.equal(new Set(lineIds).size, lineIds.length);
  for (const id of lineIds) assert.ok(id.startsWith('brandon-freshman-'));
});

/* ----------------------------- familiarity -------------------------------- */

test('opening familiarity is per chapter and independent of Elo', () => {
  const vienna = legalBookMoves(
    personalityBookFor('brandon-freshman', 'w'),
    position('e4', 'e5'),
  )[0];
  const french = legalBookMoves(personalityBookFor('brandon-freshman', 'b'), position('e4'))[0];
  const mainline = legalBookMoves(personalityBookFor('brandon-freshman', 'w'), position('e4', 'c5'))[0];
  assert.ok(vienna && french && mainline);

  assert.equal(brandonFreshmanFamily(vienna), 'vienna');
  assert.equal(brandonFreshmanFamily(french), 'french');
  assert.equal(brandonFreshmanFamily(mainline), 'mainline');

  /* Vienna best known, French moderate, the mainlines basic — and none of them
     is "forget every move" territory. */
  const chance = (move: BookMove, ply: number) => brandonFreshmanForgetChance(move, ply);
  assert.ok(chance(vienna, 4) < chance(french, 4));
  assert.ok(chance(french, 4) < chance(mainline, 4));
  assert.ok(chance(vienna, 4) < 0.1);
  assert.ok(chance(mainline, 4) < 0.2);
  assert.ok(chance(mainline, 40) <= BRANDON_FRESHMAN_FAMILIARITY.mainline.cap);

  /* Recall fades deeper into the line. */
  assert.ok(chance(french, 20) >= chance(french, 2));
});

test('a forgotten move costs that ply, not the whole opening', () => {
  const moves = legalBookMoves(
    personalityBookFor('brandon-freshman', 'w'),
    position('e4', 'e5'),
  );
  assert.ok(moves.length > 0);

  const forgotten = chooseBrandonFreshmanBookMove({
    moves,
    style: STYLE,
    ply: 2,
    random: () => 0,
  });
  assert.equal(forgotten.move, null);
  assert.equal(forgotten.forgotten, true);

  const recalled = chooseBrandonFreshmanBookMove({
    moves,
    style: STYLE,
    ply: 4,
    random: () => 0.99,
  });
  assert.equal(recalled.move?.san, 'Nc3');
  assert.equal(recalled.forgotten, false);
});

/* ------------------------------- dialogue --------------------------------- */

test('he speaks with Prime’s voice, line for line', () => {
  assert.equal(DIALOGUE_BANKS['brandon-freshman'], DIALOGUE_BANKS.brandon);

  const spoken = Object.values(DIALOGUE_BANKS['brandon-freshman']).flat().join(' | ');
  for (const line of [
    'Alright, let’s make this interesting.',
    'Hope you brought your calculator.',
    'Oh, you are gonna love this.',
    'Material is temporary, right?',
    'You might wanna check on your king.',
    'Haha, that was fun.',
    'Okay, okay. I will give you that one.',
  ]) {
    assert.ok(spoken.includes(line), `missing his voice: ${line}`);
  }

  /* And it is not somebody else’s bank. */
  assert.notEqual(DIALOGUE_BANKS['brandon-freshman'], DIALOGUE_BANKS.senior);
  assert.notEqual(DIALOGUE_BANKS['brandon-freshman'], DIALOGUE_BANKS.edward);
});

test('his chat follows the same cooldown and anti-repeat as Prime', () => {
  const fresh = createDialogueState();
  const prime = createDialogueState();
  const first = maybeReact('brandon-freshman', 'mistake', { ply: 20, state: fresh, random: () => 0 });
  assert.ok(first);
  assert.equal(
    maybeReact('brandon-freshman', 'strong', { ply: 22, state: fresh, random: () => 0 }),
    null,
    'no chatter inside the quiet gap',
  );
  assert.ok(maybeReact('brandon-freshman', 'strong', { ply: 26, state: fresh, random: () => 0 }));

  /* Prime reacts identically at the same plies, because the cadence is shared. */
  assert.ok(maybeReact('brandon', 'mistake', { ply: 20, state: prime, random: () => 0 }));
  assert.equal(maybeReact('brandon', 'strong', { ply: 22, state: prime, random: () => 0 }), null);

  /* A line is not repeated while the bank has unused lines. */
  const state = createDialogueState();
  const seen = new Set<string>();
  let ply = 40;
  while (seen.size < DIALOGUE_BANKS['brandon-freshman'].mistake.length) {
    ply += 40;
    const line = maybeReact('brandon-freshman', 'mistake', { ply, state, random: () => 0.99 });
    assert.ok(line);
    assert.equal(seen.has(line.text), false);
    seen.add(line.text);
  }
});

/* ------------------------------- thinking --------------------------------- */

test('he moves faster than Prime but still thinks in real positions', () => {
  const fen = position('e4', 'e5', 'Nf3', 'Nc6', 'Bb5').fen();
  const input = {
    fen,
    clockMs: 300_000,
    incrementMs: 0,
    initialMs: 300_000,
    ply: 10,
    bookMove: false,
  };
  const fresh = computeThinkingPlan({ ...input, style: STYLE });
  const prime = computeThinkingPlan({ ...input, style: PRIME_STYLE });

  assert.ok(fresh.searchMs > 0);
  assert.ok(fresh.deliberationMs >= 1000);
  assert.ok(fresh.deliberationMs <= fresh.budgetMs);
  assert.ok(fresh.deliberationMs < prime.deliberationMs, 'the energetic rhythm');
  assert.ok(fresh.budgetMs <= prime.budgetMs);

  const book = computeThinkingPlan({ ...input, bookMove: true, style: STYLE });
  assert.equal(book.searchMs, 0, 'a known move needs no search');
  assert.equal(book.reason, 'book');
  assert.ok(book.deliberationMs > 0, 'but it is not played instantly');
});

/* ---------------------------- bot moves / play ---------------------------- */

test('as White he opens 1.e4 from the shared Vienna book', async () => {
  const game = new Chess();
  const chosen = await chooseBotMove({
    game,
    fen: game.fen(),
    history: [],
    botColor: 'w',
    style: STYLE,
    elo: 1600,
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

test('as Black he plays the French and answers 1.d4 in the centre', async () => {
  const e4 = position('e4');
  const french = await chooseBotMove({
    game: e4,
    fen: e4.fen(),
    history: ['e4'],
    botColor: 'b',
    style: STYLE,
    elo: 1600,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: noEngine,
    random: () => 0.99,
  });
  assert.equal(french?.uci, 'e7e6');

  const d4 = position('d4');
  const reply = await chooseBotMove({
    game: d4,
    fen: d4.fen(),
    history: ['d4'],
    botColor: 'b',
    style: STYLE,
    elo: 1600,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: noEngine,
    random: () => 0.99,
  });
  assert.ok(['d7d5', 'g8f6'].includes(reply!.uci), `unexpected reply ${reply?.uci}`);
  assert.equal(reply?.bookMove, true);
});

test('a lost book line hands over to his own play, not to a random move', async () => {
  const game = position('e4', 'c5', 'Nf3', 'Nc6', 'd4', 'cxd4', 'Nxd4', 'e5');
  const chosen = await chooseBotMove({
    game,
    fen: game.fen(),
    history: ['e4', 'c5', 'Nf3', 'Nc6', 'd4', 'cxd4', 'Nxd4', 'e5'],
    botColor: 'w',
    style: STYLE,
    elo: 1600,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: engineWith([
      { uci: 'd4f5', scoreCp: 30 },
      { uci: 'd4b5', scoreCp: 25 },
      { uci: 'd4f3', scoreCp: 5 },
      { uci: 'c1e3', scoreCp: 0 },
      { uci: 'b1c3', scoreCp: -10 },
    ]),
    random: () => 0.9,
  });
  assert.ok(chosen);
  assert.equal(chosen.bookMove, false);
  assertLegal(game.fen(), chosen.uci);
});

test('both Brandons can play each other, each on his own repertoire', async () => {
  const start = new Chess();
  const white = await chooseBotMove({
    game: start,
    fen: start.fen(),
    history: [],
    botColor: 'w',
    style: STYLE,
    elo: 1600,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: noEngine,
    random: () => 0.99,
  });
  assert.equal(white?.uci, 'e2e4');

  const afterE4 = position('e4');
  const primeBlack = await chooseBotMove({
    game: afterE4,
    fen: afterE4.fen(),
    history: ['e4'],
    botColor: 'b',
    style: PRIME_STYLE,
    elo: 2350,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: noEngine,
    random: () => 0.99,
  });
  assert.equal(primeBlack?.uci, 'e7e6', 'Prime’s French, from his own book');

  /* The defining difference shows against 1.d4: ...d5 is Freshman’s, ...Nf6 is
     Prime’s Grünfeld. */
  assert.ok(!legalBookMoves(personalityBookFor('brandon', 'b'), position('d4')).some((move) => move.san === 'd5'));
  assert.ok(legalBookMoves(personalityBookFor('brandon-freshman', 'b'), position('d4')).some((move) => move.san === 'd5'));
  assert.equal(STYLE.accuracy, accuracyForElo(1600));
  assert.equal(PRIME_STYLE.accuracy, accuracyForElo(2350));
});

/* ---------------------------- persistence / PGN --------------------------- */

test('a saved game and its PGN name him as Freshman, never as Prime', () => {
  const pgn = buildPgn(
    {
      white: opponentFullName(FRESH),
      black: opponentFullName(PRIME),
      result: '0-1',
      date: Date.UTC(2026, 10, 19),
      timeControl: '300+0',
      whiteElo: FRESH.elo,
      blackElo: PRIME.elo,
      event: 'Bot vs. Bot',
    },
    ['e4', 'e6', 'd4', 'd5'],
  );
  assert.match(pgn, /\[White "Brandon Tran \(Freshman\)"\]/);
  assert.match(pgn, /\[WhiteElo "1600"\]/);
  assert.match(pgn, /\[Black "Brandon Tran \(Prime\)"\]/);
  assert.match(pgn, /\[BlackElo "2350"\]/);

  const record: PlayedGameRecord = {
    game_id: 'brandon-freshman-persistence',
    mode: 'bot-vs-bot',
    white_opponent_id: FRESH.id,
    black_opponent_id: PRIME.id,
    white_name: opponentFullName(FRESH),
    black_name: opponentFullName(PRIME),
    white_elo: FRESH.elo,
    black_elo: PRIME.elo,
    opponent_id: FRESH.id,
    opponent_name: opponentFullName(FRESH),
    opponent_elo: FRESH.elo,
    opponent_kind: FRESH.kind,
    player_color: 'w',
    result: '0-1',
    reason: 'resignation',
    pgn,
    sans: ['e4', 'e6', 'd4', 'd5'],
    initial_seconds: 300,
    increment_seconds: 0,
    started_at: 1,
    ended_at: 2,
    duration_seconds: 1,
    final_fen: position('e4', 'e6', 'd4', 'd5').fen(),
    starting_fen: new Chess().fen(),
    board_orientation: 'white',
    time_control_id: '5+0',
  };

  assert.equal(record.opponent_id, 'brandon-freshman');
  assert.equal(record.black_opponent_id, 'brandon');
  const profile = profileFromRecord(record);
  assert.equal(profile.id, 'brandon-freshman');
  assert.equal(profile.name, 'Brandon Tran');
  assert.equal(profile.title, 'Freshman');
  assert.equal(profile.elo, 1600);
  assert.equal(opponentMeta(profile), 'Freshman · 1600 Elo');
});

test('Prime’s anchors are untouched', () => {
  assert.equal(PERSONALITY_STYLES.brandon.aggression, 95);
  assert.equal(PERSONALITY_STYLES.brandon.tactical, 98);
  assert.equal(PERSONALITY_STYLES.brandon.material, 25);
  assert.ok(PERSONALITY_STYLES.brandon.sacrifice > PERSONALITY_STYLES['brandon-freshman'].sacrifice);
  assert.equal(getOpponent('brandon')?.elo, 2350);
  assert.equal(getOpponent('brandon')?.title, 'Prime');
  assert.equal(getOpponent('brandon')?.portraitPath, 'opponents/brandon.webp');
});
