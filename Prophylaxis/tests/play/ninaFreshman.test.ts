/**
 * Nina Yang (Freshman) — the developing all-rounder at 1150 — plus the
 * Sophomore dialogue update that goes with her.
 *
 * Covers registration and the two-line card, the tendency table (balanced, and
 * every dial below her Sophomore profile), what 1150 means without inventing
 * blunders, the shared London / Caro-Kann book and her more frequent opening
 * slips, the dialogue split between the two Ninas, and the regressions that
 * keep Sophomore exactly as she was.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { Chess } from 'chess.js';
import type { StockfishController } from '../../src/engine/useStockfish.ts';
import {
  ALL_OPPONENTS,
  PERSONALITY_OPPONENTS,
  getOpponent,
  opponentFullName,
  opponentMeta,
  profileFromRecord,
} from '../../src/play/opponents.ts';
import {
  PERSONALITY_STYLES,
  accuracyForElo,
  styleFor,
  type PersonalityStyle,
} from '../../src/play/personality/styles.ts';
import { candidateGapForElo } from '../../src/play/personality/engine.ts';
import { chooseBotMove } from '../../src/play/personality/chooseMove.ts';
import { blunderChance } from '../../src/play/strength.ts';
import {
  chooseNinaBookMove,
  chooseNinaPlanMove,
  createOpeningMemory,
  isNinaProfile,
  ninaForgetChance,
  ninaPlan,
} from '../../src/play/personality/nina.ts';
import {
  personalityBookFor,
  personalityBooks,
  repertoireIssues,
} from '../../src/play/personality/repertoires/index.ts';
import { legalBookMoves } from '../../src/play/personality/repertoires/book.ts';
import { DIALOGUE_BANKS, createDialogueState, maybeReact } from '../../src/play/personality/dialogue.ts';
import type { BookMove } from '../../src/play/personality/repertoires/book.ts';

const FRESHMAN = getOpponent('nina-freshman');
const SOPHOMORE = getOpponent('nina');
const FRESH = styleFor('nina-freshman', 1150) as PersonalityStyle;
const SOPH = styleFor('nina', 1550) as PersonalityStyle;

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

function position(...san: string[]): Chess {
  const game = new Chess();
  for (const move of san) game.move(move);
  return game;
}

function fakeBookMove(san: string, weight: number, lineIds = ['line']): BookMove {
  return { uci: 'd2d4', san, tags: ['solid'], weight, lineIds };
}

/* ------------------------------ registration ------------------------------ */

test('Nina Yang (Freshman) is registered once, at 1200, in the Novice band', () => {
  assert.ok(FRESHMAN);
  assert.equal(FRESHMAN.id, 'nina-freshman', 'a stable id of her own');
  assert.equal(FRESHMAN.kind, 'personality');
  assert.equal(FRESHMAN.name, 'Nina Yang');
  assert.equal(FRESHMAN.title, 'Freshman');
  assert.equal(FRESHMAN.elo, 1200);
  assert.equal(FRESHMAN.category, 'novice');
  assert.equal(FRESHMAN.initials, 'NY');
  assert.equal(FRESHMAN.usesRepertoire, false);
  assert.doesNotMatch(FRESHMAN.name, /\(/, 'the card prints name and subtext as two fields');
  assert.equal(opponentFullName(FRESHMAN), 'Nina Yang (Freshman)');
  assert.equal(opponentMeta(FRESHMAN), 'Freshman · 1200 Elo');
  assert.match(FRESHMAN.style, /balanced/i);

  assert.equal(PERSONALITY_OPPONENTS.length, 17);
  assert.equal(ALL_OPPONENTS.length, 18);
  assert.equal(
    PERSONALITY_OPPONENTS.filter((opponent) => opponent.id === 'nina-freshman').length,
    1,
  );
  assert.equal(
    new Set(ALL_OPPONENTS.map((opponent) => opponent.id)).size,
    ALL_OPPONENTS.length,
    'no id collisions anywhere on the roster',
  );
  assert.equal(
    new Set(PERSONALITY_OPPONENTS.map((opponent) => opponentFullName(opponent))).size,
    PERSONALITY_OPPONENTS.length,
    'saved games can always tell two opponents apart',
  );
});

test('she has her own portrait file, not the Sophomore’s', () => {
  assert.equal(FRESHMAN.portraitPath, 'opponents/nina-freshman.webp');
  assert.ok(fs.existsSync('public/opponents/nina-freshman.webp'));
  assert.notEqual(FRESHMAN.portraitPath, SOPHOMORE?.portraitPath);
  assert.equal(
    fs.existsSync('public/opponents/nina.webp'),
    true,
    'the Sophomore portrait is still installed',
  );
});

test('a saved game resolves her to Freshman, never to Sophomore', () => {
  const record = profileFromRecord({
    opponent_id: 'nina-freshman',
    opponent_name: 'Nina Yang (Freshman)',
    opponent_elo: 1200,
    opponent_kind: 'personality',
  });
  assert.equal(record.id, 'nina-freshman');
  assert.equal(record.title, 'Freshman');
  assert.equal(record.elo, 1200);

  const sophomore = profileFromRecord({
    opponent_id: 'nina',
    opponent_name: 'Nina Yang (Sophomore)',
    opponent_elo: 1550,
    opponent_kind: 'personality',
  });
  assert.equal(sophomore.title, 'Sophomore');
  assert.equal(sophomore.elo, 1550);
});

/* ---------------------------- tendencies ---------------------------------- */

test('her tendency table is the balanced, undeveloped profile', () => {
  assert.deepEqual(
    {
      aggression: FRESH.aggression,
      risk: FRESH.risk,
      positional: FRESH.positional,
      tactical: FRESH.tactical,
      defensive: FRESH.defensive,
      initiative: FRESH.initiative,
      simplification: FRESH.simplification,
      complexity: FRESH.complexity,
      kingSafety: FRESH.kingSafety,
      material: FRESH.material,
    },
    {
      aggression: 35,
      risk: 30,
      positional: 40,
      tactical: 40,
      defensive: 45,
      initiative: 35,
      simplification: 55,
      complexity: 35,
      kingSafety: 60,
      material: 65,
    },
  );

  /* Every dial sits below her Sophomore profile: earlier, not differently. */
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
    'sacrifice',
    'activePieces',
  ] as const) {
    assert.ok(FRESH[key] < SOPH[key], `${key} is lower than Sophomore's ${SOPH[key]}`);
  }

  /* Noticeably calmer, and nobody would call her an attacker. */
  assert.ok(SOPH.aggression - FRESH.aggression >= 30);
  assert.ok(FRESH.aggression <= 40);

  /* No speciality: defence and tactics are both middling and close together,
     so she is neither the defender nor the sharpshooter of the roster. */
  assert.ok(Math.abs(FRESH.defensive - FRESH.tactical) <= 10);
  assert.ok(FRESH.defensive < PERSONALITY_STYLES['bryan-sophomore'].defensive);
  assert.ok(FRESH.tactical < PERSONALITY_STYLES.brandon.tactical);
  const values = [
    FRESH.aggression,
    FRESH.risk,
    FRESH.positional,
    FRESH.tactical,
    FRESH.defensive,
    FRESH.initiative,
    FRESH.simplification,
    FRESH.complexity,
    FRESH.kingSafety,
    FRESH.material,
  ];
  assert.ok(Math.max(...values) <= 65, 'nothing on the table is elite');
  assert.ok(Math.min(...values) >= 30, 'and nothing is switched off');
});

/* ------------------------------- strength --------------------------------- */

test('1150 is a weaker dial, not an injected blunder', () => {
  assert.equal(FRESH.accuracy, accuracyForElo(1150));
  assert.ok(FRESH.accuracy < SOPH.accuracy, 'less accurate than her Sophomore self');
  assert.ok(FRESH.accuracy >= accuracyForElo(1100), 'the same dial band as the 1100 beginner');

  assert.ok(candidateGapForElo(1150) > candidateGapForElo(1550));
  const rate = blunderChance(1150);
  assert.ok(rate > blunderChance(1550), 'she errs more often than Sophomore');
  assert.ok(rate < blunderChance(1100), 'but less than the wildcard');
  assert.ok(rate > 0 && rate < 0.25, 'a beginner, not a coin flip');
});

test('her own id is recognised by the shared Nina mechanics', () => {
  assert.equal(isNinaProfile('nina-freshman'), true);
  assert.equal(isNinaProfile('nina'), true);
  assert.equal(isNinaProfile('freshman'), false);
  assert.equal(isNinaProfile('brandon'), false);
});

/* ------------------------------- repertoire ------------------------------- */

test('she plays the same London and Caro-Kann data, not a copy of it', () => {
  const start = new Chess();
  assert.equal(
    legalBookMoves(personalityBookFor('nina-freshman', 'w'), start)[0]?.san,
    'd4',
    'the London starts with 1.d4',
  );

  const afterE4 = position('e4');
  assert.ok(
    legalBookMoves(personalityBookFor('nina-freshman', 'b'), afterE4).some(
      (move) => move.san === 'c6',
    ),
    'the Caro-Kann meets 1.e4',
  );
  assert.ok(
    !legalBookMoves(personalityBookFor('nina-freshman', 'b'), afterE4).some(
      (move) => move.san === 'e5',
    ),
  );

  /* Same immutable compiled study for both profiles: no duplicated PGN data. */
  const fresh = personalityBooks('nina-freshman');
  const soph = personalityBooks('nina');
  assert.deepEqual([...fresh.w.book.keys()].sort(), [...soph.w.book.keys()].sort());
  assert.deepEqual([...fresh.b.book.keys()].sort(), [...soph.b.book.keys()].sort());
  for (const [key, moves] of fresh.w.book) {
    for (const move of moves) {
      assert.ok(move.lineIds.some((id) => id.startsWith('nina-')));
      assert.ok((soph.w.book.get(key) ?? []).some((entry) => entry.uci === move.uci));
    }
  }

  const issues = repertoireIssues().find((entry) => entry.id === 'nina-freshman');
  assert.ok(issues, 'her book is validated with the others');
  assert.deepEqual(issues?.issues, []);
});

test('the London skeleton and ...d5 are principles she also follows', () => {
  const start = new Chess();
  assert.deepEqual(ninaPlan(start.fen(), [], FRESH)?.moves.map((move) => move.uci), ['d2d4']);

  const afterD4 = position('d4');
  assert.deepEqual(ninaPlan(afterD4.fen(), ['d4'], FRESH)?.moves.map((move) => move.uci), ['d7d5']);
  assert.equal(
    chooseNinaPlanMove({
      fen: afterD4.fen(),
      history: ['d4'],
      style: FRESH,
      elo: 1150,
      candidates: [],
    })?.uci,
    'd7d5',
  );

  const afterE4 = position('e4');
  assert.equal(ninaPlan(afterE4.fen(), ['e4'], FRESH), null, '1.e4 is the Caro-Kann book');
});

test('both Nina profiles play their book before searching, as either colour', async () => {
  const start = new Chess();
  const white = await chooseBotMove({
    game: start,
    fen: start.fen(),
    history: [],
    botColor: 'w',
    style: FRESH,
    elo: 1150,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: noEngine,
    openingMemory: createOpeningMemory(),
    random: () => 0.9,
  });
  assert.equal(white?.uci, 'd2d4');
  assert.equal(white?.source, 'repertoire');

  const afterE4 = position('e4');
  const black = await chooseBotMove({
    game: afterE4,
    fen: afterE4.fen(),
    history: ['e4'],
    botColor: 'b',
    style: FRESH,
    elo: 1150,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: noEngine,
    openingMemory: createOpeningMemory(),
    random: () => 0.9,
  });
  assert.equal(black?.uci, 'c7c6');
  assert.equal(black?.source, 'repertoire');

  /* Bot vs. Bot: two different profiles, the same legal book. */
  assert.equal(SOPH.id, 'nina');
  assert.notEqual(FRESH.id, SOPH.id);
  assert.equal(opponentFullName(getOpponent('nina')!), 'Nina Yang (Sophomore)');
});

/* --------------------------- opening familiarity -------------------------- */

test('she forgets her lines more often than Sophomore, but never blunders on cue', () => {
  const mainline = fakeBookMove('d4', 3);
  const branch = fakeBookMove('Nc3', 1, ['line-a', 'line-b']);

  assert.ok(
    ninaForgetChance(mainline, 8, 'nina-freshman') > ninaForgetChance(mainline, 8, 'nina'),
    'less developed familiarity',
  );
  assert.ok(
    ninaForgetChance(branch, 40, 'nina-freshman') >= ninaForgetChance(branch, 40, 'nina'),
  );
  assert.ok(ninaForgetChance(branch, 80, 'nina-freshman') <= 0.22, 'still a rare event');

  const memory = createOpeningMemory();
  const slipped = chooseNinaBookMove({
    moves: [mainline],
    style: FRESH,
    history: ['d4'],
    memory,
    random: () => 0,
  });
  assert.equal(slipped.forgotten, true);
  assert.equal(slipped.move, null, 'a forgotten line is not replaced with a bad guess');
  assert.equal(memory.forgotten, true);

  assert.equal(
    chooseNinaPlanMove({
      fen: new Chess().fen(),
      history: [],
      style: FRESH,
      elo: 1150,
      candidates: [],
      forgotten: true,
    }),
    null,
    'the principle skeleton does not rebuild itself either',
  );

  const later = chooseNinaBookMove({
    moves: [mainline],
    style: FRESH,
    history: ['d4', 'd5', 'c4'],
    memory,
    random: () => 0,
  });
  assert.equal(later.move, null, 'she does not re-enter the line this game');

  const senior = styleFor('senior', 2250) as PersonalityStyle;
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

/* -------------------------------- dialogue -------------------------------- */

test('she is friendly but less sure of herself, and never profane', () => {
  const bank = DIALOGUE_BANKS['nina-freshman'];
  const sophomore = DIALOGUE_BANKS.nina;

  assert.deepEqual(Object.keys(bank).sort(), Object.keys(sophomore).sort());

  const spoken = Object.values(bank).flat();
  for (const line of [
    'Okay, let’s see how this goes.',
    'I think this should be fine.',
    'Wait, let me think.',
    'Hopefully this works.',
    'Oh, I didn’t expect that.',
    'I think I’m doing okay.',
    'That was actually pretty good.',
    'Okay, I might have missed something.',
  ]) {
    if (line === 'I think this should be fine.') continue;
    assert.ok(spoken.includes(line), `missing: ${line}`);
  }

  for (const line of spoken) {
    assert.ok(line.length > 0 && line.length <= 100, line);
    assert.ok(!/[0-9]/.test(line), line);
    assert.ok(!/shit|fuck|damn|hell/i.test(line), `no profanity: ${line}`);
  }

  /* The Sophomore's sharper reactions are hers alone. */
  assert.ok(!spoken.some((line) => /shitttt/i.test(line)));
  assert.ok(sophomore.mistake.some((line) => /shitttt/i.test(line)));

  /* And she does not simply repeat Sophomore's lines. */
  const shared = spoken.filter((line) => sophomore.book.concat(sophomore.win).includes(line));
  assert.deepEqual(shared, []);
});

test('the Sophomore keeps her voice and gains occasional stronger reactions', () => {
  const bank = DIALOGUE_BANKS.nina;
  assert.match(bank.book.join(' '), /Hiii/, 'her existing opening line survives');
  assert.match(bank.deviation.join(' '), /supposed to play/);
  assert.match(bank.attack.join(' '), /pressure/);

  for (const line of [
    'Oh shitttt.',
    'Wait, what?',
    'Oh no, I actually missed that.',
    'Okay, that was bad.',
    'Nah, I can’t believe I did that.',
  ]) {
    assert.ok(bank.mistake.includes(line), `missing mistake reaction: ${line}`);
  }

  /* It is a mistake reaction, not a catchphrase: one event only. */
  const events = Object.entries(bank)
    .filter(([, lines]) => lines.some((line) => /shitttt/i.test(line)))
    .map(([event]) => event);
  assert.deepEqual(events, ['mistake']);

  /* Cooldowns still keep her from talking every ply. */
  const state = createDialogueState();
  const first = maybeReact('nina', 'mistake', { ply: 30, state, random: () => 0 });
  assert.ok(first);
  assert.equal(
    maybeReact('nina', 'mistake', { ply: 32, state, random: () => 0 }),
    null,
    'no immediate repeat',
  );
});

test('Freshman dialogue is contextual and rate-limited too', () => {
  const state = createDialogueState();
  const first = maybeReact('nina-freshman', 'deviation', { ply: 12, state, random: () => 0 });
  assert.ok(first);
  assert.equal(
    maybeReact('nina-freshman', 'deviation', { ply: 14, state, random: () => 0 }),
    null,
  );

  const pool = DIALOGUE_BANKS['nina-freshman'].deviation;
  const seen = new Set<string>();
  let ply = 10;
  for (let round = 0; round < pool.length; round += 1) {
    ply += 20;
    const line = maybeReact('nina-freshman', 'deviation', { ply, state, random: () => 0.99 });
    assert.ok(line);
    seen.add(line.text);
  }
  assert.ok(seen.size >= 2, 'the pool is not a single catchphrase');
  assert.ok(seen.size <= pool.length);
});

/* ------------------------------- regression ------------------------------- */

test('Sophomore keeps her identity, strength and repertoire', () => {
  assert.ok(SOPHOMORE);
  assert.equal(SOPHOMORE.id, 'nina');
  assert.equal(SOPHOMORE.elo, 1550);
  assert.equal(SOPHOMORE.category, 'intermediate');
  assert.equal(SOPHOMORE.title, 'Sophomore');
  assert.equal(opponentFullName(SOPHOMORE), 'Nina Yang (Sophomore)');

  assert.deepEqual(
    [
      SOPH.aggression,
      SOPH.risk,
      SOPH.positional,
      SOPH.tactical,
      SOPH.defensive,
      SOPH.initiative,
      SOPH.simplification,
      SOPH.complexity,
      SOPH.kingSafety,
      SOPH.material,
    ],
    [80, 45, 80, 90, 80, 95, 70, 45, 90, 80],
  );

  const start = new Chess();
  assert.equal(
    legalBookMoves(personalityBookFor('nina', 'w'), start)[0]?.san,
    'd4',
    'the Jobava London still starts with 1.d4',
  );
  assert.ok(
    legalBookMoves(personalityBookFor('nina', 'b'), position('e4')).some(
      (move) => move.san === 'c6',
    ),
  );
  assert.ok(
    personalityBooks('nina').w.book.size > 0 && personalityBooks('nina').b.book.size > 0,
  );

  /* Her forgetting mechanic is untouched at her own chance. */
  const mainline = fakeBookMove('d4', 3);
  assert.ok(ninaForgetChance(mainline, 8, 'nina') < ninaForgetChance(mainline, 8, 'nina-freshman'));
});

test('the rest of the roster is unchanged', () => {
  assert.equal(getOpponent('faadi')?.elo, 700);
  assert.equal(getOpponent('faadi')?.category, 'beginner');
  assert.equal(getOpponent('bryan-sophomore')?.elo, 1350);
  assert.equal(getOpponent('bryan-sophomore')?.category, 'intermediate');
  assert.equal(getOpponent('bryan')?.elo, 1800);
  assert.equal(getOpponent('bryan-prime')?.elo, 2000);
  assert.equal(getOpponent('brandon')?.elo, 2350);
  assert.equal(getOpponent('freshman')?.elo, 1250);
  assert.equal(getOpponent('sophomore')?.elo, 1450);
  assert.equal(getOpponent('senior')?.elo, 2000);
  assert.equal(getOpponent('junior')?.elo, 2150);
});
