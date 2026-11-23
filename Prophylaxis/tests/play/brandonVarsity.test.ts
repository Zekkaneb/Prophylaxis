/**
 * Brandon Tran (Sophomore) — the funky attacker, 1850, Varsity.
 *
 * The third Brandon: independent id, rating, category, portrait, strength
 * configuration and book, sharing only the immutable Brandon voice with the
 * Freshman and the Prime. Covers identity and separation, the 1850 dials against
 * both other versions, the Vienna Gambit, the French counterattack, the 1...d5
 * answer to 1.d4 (and the absence of a Grünfeld), legality and fallback, his
 * voice, Normal Play, Bot vs. Bot, saved-game/PGN identity and the regressions.
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
import { BRANDON_VARSITY_REPERTOIRE } from '../../src/play/personality/repertoires/brandonVarsity.ts';
import { kidPlan } from '../../src/play/personality/repertoires/kid.ts';
import { chooseBotMove } from '../../src/play/personality/chooseMove.ts';
import { candidateGapForElo, choosePersonalityMove } from '../../src/play/personality/engine.ts';
import { computeThinkingPlan } from '../../src/play/personality/thinking.ts';
import { blunderChance } from '../../src/play/strength.ts';
import { buildPgn } from '../../src/play/pgn.ts';
import type { StockfishController } from '../../src/engine/useStockfish.ts';

const SOPHOMORE = getOpponent('brandon-varsity');
const FRESHMAN = getOpponent('brandon-freshman');
const PRIME = getOpponent('brandon');
const STYLE = styleFor('brandon-varsity', 1850) as PersonalityStyle;
const FRESH_STYLE = styleFor('brandon-freshman', 1600) as PersonalityStyle;
const PRIME_STYLE = styleFor('brandon', 2350) as PersonalityStyle;

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

test('Brandon Tran (Sophomore) is registered at 1850 in Varsity', () => {
  assert.ok(SOPHOMORE);
  assert.equal(SOPHOMORE.id, 'brandon-varsity', 'his own stable id');
  assert.equal(SOPHOMORE.kind, 'personality');
  assert.equal(SOPHOMORE.name, 'Brandon Tran');
  assert.equal(SOPHOMORE.title, 'Sophomore', 'the subtext is exactly Sophomore');
  assert.equal(SOPHOMORE.elo, 1850);
  assert.equal(SOPHOMORE.category, 'varsity', 'Varsity, not Intermediate and not Big 4');
  assert.equal(SOPHOMORE.initials, 'BT');
  assert.equal(SOPHOMORE.usesRepertoire, false);
  assert.ok(SOPHOMORE.style.length > 0);
  assert.match(SOPHOMORE.style, /attack|funky|sharp/i);

  assert.doesNotMatch(SOPHOMORE.name, /\(/, 'the name carries no parenthetical suffix');
  assert.doesNotMatch(SOPHOMORE.name, /sophomore|freshman|prime/i, 'the subtext lives in its own field');
  assert.equal(opponentStage(SOPHOMORE), 'Sophomore');
  assert.equal(opponentMeta(SOPHOMORE), 'Sophomore · 1850 Elo');
  assert.equal(opponentFullName(SOPHOMORE), 'Brandon Tran (Sophomore)');
});

test('the three Brandons are separate identities at their own strengths', () => {
  assert.ok(FRESHMAN);
  assert.ok(PRIME);
  assert.notEqual(SOPHOMORE.id, FRESHMAN.id);
  assert.notEqual(SOPHOMORE.id, PRIME.id);
  assert.notEqual(FRESHMAN.id, PRIME.id);

  assert.equal(FRESHMAN.title, 'Freshman');
  assert.equal(FRESHMAN.elo, 1600);
  assert.equal(FRESHMAN.category, 'intermediate');

  assert.equal(PRIME.title, 'Prime');
  assert.equal(PRIME.elo, 2350);
  assert.equal(PRIME.category, 'big-4');

  assert.equal(
    PERSONALITY_OPPONENTS.filter((opponent) => opponent.name === 'Brandon Tran').length,
    3,
  );
  assert.equal(
    new Set(
      PERSONALITY_OPPONENTS.filter((opponent) => opponent.name === 'Brandon Tran').map((opponent) =>
        opponentFullName(opponent),
      ),
    ).size,
    3,
    'history can always tell the three apart',
  );

  /* Not shared mutable objects: each profile is its own frozen record. */
  assert.notEqual(SOPHOMORE, FRESHMAN);
  assert.notEqual(SOPHOMORE, PRIME);
  assert.notEqual(STYLE, FRESH_STYLE);
  assert.notEqual(STYLE, PRIME_STYLE);
  assert.equal(STYLE.id, 'brandon-varsity');
});

test('he is placed in Varsity, above the Intermediates and below the Big 4', () => {
  const varsity = PERSONALITY_OPPONENTS.filter((opponent) => opponent.category === 'varsity');
  assert.deepEqual(
    varsity.map((opponent) => opponent.id),
    ['bryan', 'senior', 'brandon-varsity'],
  );
  assert.equal(getOpponent('bryan')?.elo, 1800);
  assert.equal(getOpponent('senior')?.elo, 2000);
  assert.ok(SOPHOMORE.elo > 1800 && SOPHOMORE.elo < 2000);
  assert.equal(
    PERSONALITY_OPPONENTS.filter((opponent) => opponent.category === 'big-4').length,
    4,
    'the featured row still holds exactly four',
  );
  assert.equal(
    PERSONALITY_OPPONENTS.some((opponent) => opponent.id === 'brandon-varsity' && opponent.category === 'big-4'),
    false,
  );
});

test('his portrait is a separate file and the other two are untouched', () => {
  assert.equal(SOPHOMORE.portraitPath, 'opponents/brandon-varsity.webp');
  assert.equal(fs.existsSync('public/opponents/brandon-varsity.webp'), true);
  assert.notEqual(SOPHOMORE.portraitPath, FRESHMAN.portraitPath);
  assert.notEqual(SOPHOMORE.portraitPath, PRIME.portraitPath);
  assert.equal(FRESHMAN.portraitPath, 'opponents/brandon-freshman.webp');
  assert.equal(PRIME.portraitPath, 'opponents/brandon.webp');
  assert.equal(fs.existsSync('public/opponents/brandon.webp'), true);
  assert.equal(fs.existsSync('public/opponents/brandon-freshman.webp'), true);
  for (const other of PERSONALITY_OPPONENTS) {
    if (other.id === 'brandon-varsity') continue;
    assert.notEqual(other.portraitPath, SOPHOMORE.portraitPath, `${other.id} keeps its portrait`);
  }
  /* The monogram is the fallback whenever the file cannot load. */
  assert.equal(SOPHOMORE.initials.length, 2);
});

/* --------------------- 3. strength between the others -------------------- */

test('his tendency table is the requested funky attacker', () => {
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
      risk: 80,
      positional: 65,
      tactical: 85,
      defensive: 45,
      initiative: 90,
      simplification: 30,
      complexity: 85,
      kingSafety: 55,
      material: 40,
    },
  );
  assert.ok((STYLE.openingBias.sharp ?? 0) > 0);
  assert.ok((STYLE.openingBias.initiative ?? 0) > 0);
  assert.ok((STYLE.openingBias.solid ?? 0) < 0, 'he does not seek solidity');
});

test('he is more developed than the Freshman and less refined than the Prime', () => {
  /* More developed than Freshman. */
  assert.ok(STYLE.tactical > FRESH_STYLE.tactical);
  assert.ok(STYLE.positional > FRESH_STYLE.positional);
  assert.ok(STYLE.defensive > FRESH_STYLE.defensive);
  assert.ok(STYLE.material > FRESH_STYLE.material);
  assert.ok(STYLE.sacrifice > FRESH_STYLE.sacrifice);
  assert.ok(STYLE.complexity < FRESH_STYLE.complexity, 'he does not chase chaos for its own sake');

  /* Less refined than Prime. */
  assert.ok(STYLE.aggression < PRIME_STYLE.aggression);
  assert.ok(STYLE.tactical < PRIME_STYLE.tactical);
  assert.ok(STYLE.initiative < PRIME_STYLE.initiative);
  assert.ok(STYLE.complexity < PRIME_STYLE.complexity);
  assert.ok(STYLE.sacrifice < PRIME_STYLE.sacrifice);
  assert.ok(STYLE.positional > PRIME_STYLE.positional, 'he is more positional than the Prime');

  /* Rating sits between the two, and strength is the rating dial. */
  assert.ok(SOPHOMORE.elo > FRESHMAN.elo && SOPHOMORE.elo < PRIME.elo);
  assert.equal(STYLE.accuracy, accuracyForElo(STYLE.planElo ?? 1850));
  assert.ok(STYLE.accuracy > FRESH_STYLE.accuracy);
  assert.ok(STYLE.accuracy < PRIME_STYLE.accuracy);
  assert.ok(candidateGapForElo(1850) < candidateGapForElo(1600), 'smaller gap than the Freshman');
  assert.ok(candidateGapForElo(1850) > candidateGapForElo(2350), 'larger gap than the Prime');
  assert.ok(blunderChance(1850) < blunderChance(1600));
  assert.ok(blunderChance(1850) > blunderChance(2350));
  assert.equal(STYLE.depthCap, undefined);
  assert.equal(STYLE.mistakeChance, undefined);
  assert.equal(STYLE.searchFactor, undefined);
});

test('on equal moves he attacks, and taste still cannot outvote the engine', () => {
  const italian = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 6';
  /* A capture-ish, forward move of equal evaluation is the one he wants. */
  const forward = choosePersonalityMove({
    fen: italian,
    candidates: [
      { uci: 'f3g5', scoreCp: 20, mate: null },
      { uci: 'h2h3', scoreCp: 20, mate: null },
    ],
    style: STYLE,
    elo: 1850,
    random: () => 0.9,
  });
  assert.equal(forward?.uci, 'f3g5');

  /* A clearly better move still wins, and a losing one is never taken. */
  const refuted = choosePersonalityMove({
    fen: italian,
    candidates: [
      { uci: 'f3g5', scoreCp: -150, mate: null },
      { uci: 'e1g1', scoreCp: 15, mate: null },
    ],
    style: STYLE,
    elo: 1850,
    random: () => 0.1,
  });
  assert.equal(refuted?.uci, 'e1g1');
});

/* --------------------------- 4. the Vienna ------------------------------ */

test('White plays the Vienna, and the Sophomore plays the sharp gambit', () => {
  assert.ok(BRANDON_VARSITY_REPERTOIRE.asWhite.length >= 2);
  for (const line of BRANDON_VARSITY_REPERTOIRE.asWhite) {
    assert.equal(line.san[0], 'e4', `${line.id} starts 1.e4`);
    assert.equal(line.san[2], 'Nc3', `${line.id} is a Vienna`);
    assert.ok(line.san.includes('f4') || line.san.includes('Ng5'), `${line.id} seeks the initiative`);
    assert.ok(line.id.startsWith('brandon-varsity-'));
  }
  assert.ok(
    BRANDON_VARSITY_REPERTOIRE.asWhite.some((line) => line.san.includes('f4')),
    'the Vienna Gambit is in the book',
  );

  assert.deepEqual(
    legalBookMoves(personalityBookFor('brandon-varsity', 'w'), new Chess()).map(
      (move) => move.san,
    ),
    ['e4'],
  );
  assert.deepEqual(
    legalBookMoves(personalityBookFor('brandon-varsity', 'w'), position('e4', 'e5')).map(
      (move) => move.san,
    ),
    ['Nc3'],
  );
  assert.ok(
    legalBookMoves(
      personalityBookFor('brandon-varsity', 'w'),
      position('e4', 'e5', 'Nc3', 'Nf6'),
    ).some((move) => move.san === 'f4'),
    'the gambit is his choice, not a quiet set-up',
  );
});

/* --------------------------- 5. the French ------------------------------ */

test('Black answers 1.e4 with 1...e6 and counterattacks in the French', () => {
  assert.deepEqual(
    legalBookMoves(personalityBookFor('brandon-varsity', 'b'), position('e4')).map(
      (move) => move.san,
    ),
    ['e6'],
  );
  assert.deepEqual(
    legalBookMoves(
      personalityBookFor('brandon-varsity', 'b'),
      position('e4', 'e6', 'd4', 'd5', 'Nc3'),
    ).map((move) => move.san),
    ['Bb4'],
    'the Winawer counterattack',
  );
  assert.deepEqual(
    legalBookMoves(
      personalityBookFor('brandon-varsity', 'b'),
      position('e4', 'e6', 'd4', 'd5', 'Nd2'),
    ).map((move) => move.san),
    ['c5'],
    'the open Tarrasch',
  );
  assert.ok(
    BRANDON_VARSITY_REPERTOIRE.asBlack.some((line) => line.san.includes('Bxc3+')),
    'he is ready to give the bishop to open the position',
  );
});

/* ------------------- 6. 1...d5 against 1.d4, no Grünfeld ----------------- */

test('Black answers 1.d4 with 1...d5 and never a Grünfeld', () => {
  assert.deepEqual(
    legalBookMoves(personalityBookFor('brandon-varsity', 'b'), position('d4')).map(
      (move) => move.san,
    ),
    ['d5'],
  );
  assert.deepEqual(
    legalBookMoves(
      personalityBookFor('brandon-varsity', 'b'),
      position('d4', 'd5', 'c4'),
    ).map((move) => move.san),
    ['dxc4'],
    'Queen’s Gambit Accepted, not a Grünfeld',
  );
  assert.equal(kidPlan(position('d4').fen(), ['d4'], STYLE, 'b'), null);

  /* No Grünfeld: no ...g6/...Bg7 block, and his book never offers ...g6 after
     1.d4 d5. */
  for (const line of BRANDON_VARSITY_REPERTOIRE.asBlack) {
    assert.doesNotMatch(line.name, /gr[üu]nfeld/i, `${line.id} is not a Grünfeld`);
  }
  assert.equal(
    legalBookMoves(
      personalityBookFor('brandon-varsity', 'b'),
      position('d4', 'd5', 'c4', 'Nf6'),
    ).some((move) => move.san === 'g6'),
    false,
  );
  /* And the Prime's book stays his own. */
  assert.notEqual(
    personalityBookFor('brandon-varsity', 'b'),
    personalityBookFor('brandon', 'b'),
  );
});

test('outside his book he falls back to legal, sensible moves', async () => {
  const reti = position('Nf3', 'Nf6');
  assert.deepEqual(legalBookMoves(personalityBookFor('brandon-varsity', 'w'), reti), []);

  const chosen = await chooseBotMove({
    game: reti,
    fen: reti.fen(),
    history: ['Nf3', 'Nf6'],
    botColor: 'w',
    style: STYLE,
    elo: 1850,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: engineWith([
      { uci: 'c2c4', scoreCp: 24 },
      { uci: 'g2g3', scoreCp: 18 },
      { uci: 'd2d4', scoreCp: 12 },
    ]),
    random: () => 0.5,
  });
  assert.ok(chosen);
  assert.equal(chosen.bookMove, false);
  assert.equal(chosen.source, 'engine');
  assertLegal(reti.fen(), chosen.uci);

  assert.deepEqual(
    legalBookMoves(personalityBookFor('brandon-varsity', 'w'), position('e4')).map(
      (move) => move.san,
    ),
    [],
    'his Black answers do not become White moves',
  );
});

test('his book compiles, stays legal and borrows nothing from another opponent', () => {
  assert.deepEqual(repertoireIssues().filter((entry) => entry.issues.length > 0), []);
  assert.ok(repertoireIssues().some((entry) => entry.id === 'brandon-varsity'));

  for (const color of ['w', 'b'] as const) {
    for (const [key, moves] of personalityBooks('brandon-varsity')[color].book) {
      assert.equal(key.split(' ')[1], color, `${color} book only holds ${color} turns`);
      for (const entry of moves) {
        assertLegal(`${key} - 0 1`, entry.uci);
        assert.ok(entry.lineIds.every((id) => id.startsWith('brandon-varsity-')));
      }
    }
  }

  const foreign = Object.entries(PERSONALITY_REPERTOIRES)
    .filter(([id]) => id !== 'brandon-varsity')
    .flatMap(([, repertoire]) => [...repertoire.asWhite, ...repertoire.asBlack]);
  for (const line of [...BRANDON_VARSITY_REPERTOIRE.asWhite, ...BRANDON_VARSITY_REPERTOIRE.asBlack]) {
    assert.equal(foreign.includes(line), false, `${line.id} is a line of his own`);
    assert.equal(
      foreign.some((other) => other.san.join(' ') === line.san.join(' ')),
      false,
      `${line.id} is not copied from another opponent`,
    );
  }
});

/* --------------------------- 7. dialogue -------------------------------- */

test('he sounds exactly like the other Brandons', () => {
  assert.equal(
    DIALOGUE_BANKS['brandon-varsity'],
    DIALOGUE_BANKS.brandon,
    'one immutable Brandon voice, shared',
  );
  assert.equal(DIALOGUE_BANKS['brandon-varsity'], DIALOGUE_BANKS['brandon-freshman']);

  const spoken = Object.values(DIALOGUE_BANKS['brandon-varsity']).flat().join(' | ');
  for (const line of [
    'Alright, let’s make this interesting.',
    'Hope you brought your calculator.',
    'Material is temporary, right?',
    'Okay, respect.',
    'Haha, that was fun.',
  ]) {
    assert.ok(spoken.includes(line), `missing his voice: ${line}`);
  }
  for (const lines of Object.values(DIALOGUE_BANKS['brandon-varsity'])) {
    for (const line of lines) {
      assert.ok(!/[0-9]/.test(line), line);
      assert.ok(
        !/\b(eval|evaluation|centipawn|engine|stockfish|depth|pv|score)\b/i.test(line),
        `no engine internals: ${line}`,
      );
    }
  }
});

test('his remarks are event-driven, spaced out and never repeat', () => {
  const state = createDialogueState();
  /* The default cadence: no ordinary remark inside the quiet gap, and the same
     event waits for the longer repeat gap. */
  assert.ok(maybeReact('brandon-varsity', 'strong', { ply: 20, state, random: () => 0 }));
  assert.equal(maybeReact('brandon-varsity', 'strong', { ply: 24, state, random: () => 0 }), null);
  assert.ok(maybeReact('brandon-varsity', 'strong', { ply: 29, state, random: () => 0 }));
  assert.equal(maybeReact('brandon-varsity', 'mistake', { ply: 30, state, random: () => 0 }), null);
  assert.ok(maybeReact('brandon-varsity', 'mistake', { ply: 33, state, random: () => 0 }));

  /* Once-per-game remarks stay once per game. */
  const once = createDialogueState();
  assert.ok(maybeReact('brandon-varsity', 'losing', { ply: 10, state: once, random: () => 0 }));
  assert.equal(
    maybeReact('brandon-varsity', 'losing', { ply: 90, state: once, random: () => 0 }),
    null,
  );

  /* No line repeats while unused ones remain in the bank. */
  const fresh = createDialogueState();
  const seen = new Set<string>();
  let ply = 40;
  while (seen.size < DIALOGUE_BANKS['brandon-varsity'].strong.length) {
    ply += 20;
    const line = maybeReact('brandon-varsity', 'strong', { ply, state: fresh, random: () => 0.99 });
    assert.ok(line);
    assert.equal(seen.has(line.text), false);
    seen.add(line.text);
  }

  /* A finished game always gets a line. */
  const closing = createDialogueState();
  const win = maybeReact('brandon-varsity', 'win', {
    ply: 2,
    state: closing,
    force: true,
    random: () => 0,
  });
  assert.ok(win);
});

/* ------------------- 8. Normal Play and Bot vs. Bot --------------------- */

test('Normal Play: his first move is 1.e4 from the Vienna book, with no search', async () => {
  const game = new Chess();
  const chosen = await chooseBotMove({
    game,
    fen: game.fen(),
    history: [],
    botColor: 'w',
    style: STYLE,
    elo: 1850,
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

test('Bot vs. Bot: he plays both colours through the same selection', async () => {
  const french = await chooseBotMove({
    game: position('e4'),
    fen: position('e4').fen(),
    history: ['e4'],
    botColor: 'b',
    style: STYLE,
    elo: 1850,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: noEngine,
    random: () => 0.99,
  });
  assert.equal(french?.uci, 'e7e6');

  const vsD4 = await chooseBotMove({
    game: position('d4'),
    fen: position('d4').fen(),
    history: ['d4'],
    botColor: 'b',
    style: STYLE,
    elo: 1850,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: noEngine,
    random: () => 0.99,
  });
  assert.equal(vsD4?.uci, 'd7d5');
});

test('he works with the existing time controls in every phase', () => {
  for (const clockMs of [180_000, 300_000, 600_000]) {
    for (const fen of [
      new Chess().fen(),
      position('e4', 'e6', 'd4', 'd5', 'Nc3').fen(),
      '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',
    ]) {
      const plan = computeThinkingPlan({
        fen,
        style: STYLE,
        clockMs,
        incrementMs: 2_000,
        initialMs: clockMs,
        ply: 12,
        bookMove: false,
      });
      assert.ok(plan.searchMs > 0);
      assert.ok(plan.budgetMs <= clockMs);
      assert.ok(plan.deliberationMs >= 1000 && plan.deliberationMs <= 6000);
    }
  }
});

/* ------------------------ 8. history and PGN identity ------------------- */

test('a saved game and its PGN keep the Sophomore apart from the other two', () => {
  const pgn = buildPgn(
    {
      white: opponentFullName(SOPHOMORE),
      black: opponentFullName(getOpponent('bryan')!),
      result: '1-0',
      date: Date.UTC(2026, 10, 21),
      timeControl: '300+0',
      whiteElo: SOPHOMORE.elo,
      blackElo: getOpponent('bryan')!.elo,
      event: 'Bot vs. Bot',
    },
    ['e4', 'e6', 'd4', 'd5'],
  );
  assert.match(pgn, /\[White "Brandon Tran \(Sophomore\)"\]/);
  assert.match(pgn, /\[WhiteElo "1850"\]/);
  assert.doesNotMatch(pgn, /Freshman|Prime/);

  for (const [id, label] of [
    ['brandon-varsity', 'Sophomore'],
    ['brandon-freshman', 'Freshman'],
    ['brandon', 'Prime'],
  ] as const) {
    const profile = profileFromRecord({
      opponent_id: id,
      opponent_name: opponentFullName(getOpponent(id)!),
      opponent_elo: getOpponent(id)!.elo,
      opponent_kind: 'personality',
    });
    assert.equal(profile.id, id);
    assert.equal(profile.title, label);
    assert.equal(profile.name, 'Brandon Tran');
  }
  assert.equal(
    new Set(
      ['brandon-varsity', 'brandon-freshman', 'brandon'].map((id) => getOpponent(id)!.elo),
    ).size,
    3,
    'the three saved records can never resolve to the same strength',
  );
});

/* ---------------------------- 9. regressions ---------------------------- */

test('both other Brandons and every other opponent are untouched', () => {
  assert.equal(PERSONALITY_OPPONENTS.length, 23);
  assert.equal(ALL_OPPONENTS.length, 24);

  /* The two existing Brandons keep their identity, Elo, portrait and dials. */
  assert.equal(FRESHMAN.elo, 1600);
  assert.equal(FRESHMAN.title, 'Freshman');
  assert.equal(FRESHMAN.portraitPath, 'opponents/brandon-freshman.webp');
  assert.equal(PRIME.elo, 2350);
  assert.equal(PRIME.title, 'Prime');
  assert.equal(PRIME.portraitPath, 'opponents/brandon.webp');
  assert.equal(PERSONALITY_STYLES['brandon-freshman'].aggression, 90);
  assert.equal(PERSONALITY_STYLES['brandon-freshman'].sacrifice, 80);
  assert.equal(PERSONALITY_STYLES.brandon.aggression, 95);
  assert.equal(PERSONALITY_STYLES.brandon.sacrifice, 95);
  assert.equal(PERSONALITY_STYLES.brandon.tactical, 98);

  const expected: Array<[string, string, string | undefined, number, string]> = [
    ['emmanuel', 'Emmanuel Domah', 'Senior', 150, 'beginner'],
    ['edward', 'Edward Chen', 'Senior', 800, 'beginner'],
    ['faadi', 'Faadi Granillo Garcia', 'Prime', 700, 'beginner'],
    ['nina-freshman', 'Nina Yang', 'Freshman', 1200, 'novice'],
    ['freshman', 'Johnfer Quispe', 'Freshman', 1250, 'novice'],
    ['alex-tang', 'Alex Tang', 'Sophomore', 1100, 'novice'],
    ['erik-wiessmann', 'Erik Wiessmann', 'Teacher', 1100, 'novice'],
    ['sophia-kuan', 'Sophia Kuan', 'Senior', 1300, 'novice'],
    ['bryan-sophomore', 'Bryan Martinez-Hernandez', 'Sophomore', 1350, 'intermediate'],
    ['bryan-widjaja', 'Bryan Widjaja', 'Prime', 1400, 'intermediate'],
    ['sophomore', 'Johnfer Quispe', 'Sophomore', 1450, 'intermediate'],
    ['nina', 'Nina Yang', 'Sophomore', 1550, 'intermediate'],
    ['brandon-freshman', 'Brandon Tran', 'Freshman', 1600, 'intermediate'],
    ['jonah-pachikara', 'Jonah Pachikara', undefined, 1400, 'intermediate'],
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
  }
  assert.equal(GENERAL_BOT.id, 'general');
  assert.equal(GENERAL_BOT.elo, 1500);

  /* Other profiles' tendency anchors are exactly as they were. */
  assert.equal(PERSONALITY_STYLES['bryan-widjaja'].defensive, 98);
  assert.equal(PERSONALITY_STYLES['erik-wiessmann'].positional, 75);
  assert.equal(PERSONALITY_STYLES['jonah-pachikara'].tactical, 85);
  assert.equal(PERSONALITY_STYLES['sophia-kuan'].simplification, 95);
  assert.equal(PERSONALITY_STYLES['alex-tang'].complexity, 30);

  for (const id of ['freshman', 'edward', 'bryan-widjaja', 'alex-tang', 'erik-wiessmann', 'jonah-pachikara', 'sophia-kuan', 'brandon', 'brandon-freshman']) {
    assert.ok(
      personalityBookFor(id, 'w').size + personalityBookFor(id, 'b').size > 0,
      `${id} still has a book`,
    );
  }
});
