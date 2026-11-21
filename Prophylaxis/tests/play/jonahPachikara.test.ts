/**
 * Jonah Pachikara — the silent threat, 1400.
 *
 * Covers the catalogue identity (including the deliberately blank subtext),
 * the Intermediate band, the positional/tactical tendency table and the 1400
 * strength dials, the Jobava London, the Scandinavian, the 1...d5 answer to
 * 1.d4, legal fallback, his voice and cadence, Normal Play and Bot vs. Bot,
 * saved-game/PGN identity, and the regressions for every other opponent.
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
import { JONAH_PACHIKARA_REPERTOIRE } from '../../src/play/personality/repertoires/jonahPachikara.ts';
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

const JONAH = getOpponent('jonah-pachikara');
const STYLE = styleFor('jonah-pachikara', 1400) as PersonalityStyle;

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

test('Jonah Pachikara is registered at 1400 in the Intermediate band', () => {
  assert.ok(JONAH);
  assert.equal(JONAH.id, 'jonah-pachikara', 'his own stable id');
  assert.equal(JONAH.kind, 'personality');
  assert.equal(JONAH.name, 'Jonah Pachikara');
  assert.equal(JONAH.elo, 1400);
  assert.equal(JONAH.category, 'intermediate');
  assert.equal(JONAH.initials, 'JP');
  assert.equal(JONAH.usesRepertoire, false);
  assert.ok(JONAH.style.length > 0);
  assert.match(JONAH.style, /silent|quiet|pressure/i, 'a card description that matches him');

  const intermediate = PERSONALITY_OPPONENTS.filter(
    (opponent) => opponent.category === 'intermediate',
  );
  assert.ok(intermediate.some((opponent) => opponent.id === 'jonah-pachikara'));
});

test('his subtext is genuinely unspecified: no title and no invented stage', () => {
  assert.equal(JONAH.title, undefined, 'no school-year label was invented');
  assert.equal(opponentStage(JONAH), null, 'the card prints no subtext');
  assert.equal(opponentFullName(JONAH), 'Jonah Pachikara', 'stored games carry the bare name');
  assert.equal(opponentMeta(JONAH), '1400 Elo', 'the meta line is the rating alone');
  assert.doesNotMatch(JONAH.name, /\(/, 'no parenthetical suffix');
});

test('his id is unique and history can tell him apart from every opponent', () => {
  assert.equal(PERSONALITY_OPPONENTS.filter((opponent) => opponent.id === 'jonah-pachikara').length, 1);
  assert.equal(new Set(ALL_OPPONENTS.map((opponent) => opponent.id)).size, ALL_OPPONENTS.length);
  assert.equal(getOpponent('jonah-pachikara'), JONAH, 'the catalogue entry is the same object');
  assert.equal(
    new Set(PERSONALITY_OPPONENTS.map((opponent) => opponentFullName(opponent))).size,
    PERSONALITY_OPPONENTS.length,
    'saved games can always tell two opponents apart',
  );
  /* Another 1400 exists (Bryan Widjaja): the ids and full labels keep them apart. */
  const sameRating = PERSONALITY_OPPONENTS.filter((opponent) => opponent.elo === 1400);
  assert.equal(sameRating.length, 2);
  assert.equal(new Set(sameRating.map((opponent) => opponent.id)).size, 2);
  assert.equal(new Set(sameRating.map((opponent) => opponentFullName(opponent))).size, 2);
});

test('his portrait is his own file, with the monogram kept as the fallback', () => {
  assert.equal(JONAH.portraitPath, 'opponents/jonah-pachikara.webp');
  assert.equal(fs.existsSync('public/opponents/jonah-pachikara.webp'), true);
  for (const other of PERSONALITY_OPPONENTS) {
    if (other.id === 'jonah-pachikara') continue;
    assert.notEqual(other.portraitPath, JONAH.portraitPath, `${other.id} keeps its own portrait`);
  }
});

/* ------------------------- 5. positional + tactical --------------------- */

test('his tendency table pairs positional 90 with tactical 85', () => {
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
      aggression: 55,
      risk: 40,
      positional: 90,
      tactical: 85,
      defensive: 75,
      initiative: 55,
      simplification: 60,
      complexity: 55,
      kingSafety: 80,
      material: 70,
    },
  );
  assert.equal(STYLE.id, 'jonah-pachikara');
  /* No indiscriminate aggression: not the attacker of the roster. */
  assert.ok(STYLE.aggression < PERSONALITY_STYLES.faadi.aggression);
  assert.ok(STYLE.sacrifice <= 25, 'no speculative material');
  assert.ok((STYLE.openingBias.positional ?? 0) > (STYLE.openingBias.sharp ?? 0));
});

test('positional taste improves the position; a clear tactic still gets taken', () => {
  /* Italian Game: two equal moves, the castle improves the king and the rook. */
  const italian = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 6';
  const quiet = choosePersonalityMove({
    fen: italian,
    candidates: [
      { uci: 'e1g1', scoreCp: 15, mate: null },
      { uci: 'a1b1', scoreCp: 15, mate: null },
    ],
    style: STYLE,
    elo: 1400,
    random: () => 0.9,
  });
  assert.equal(quiet?.uci, 'e1g1');

  /* Equal scores, and the tactical option is the better-looking one. */
  const endgame = '4k3/8/8/8/8/8/4K3/R7 w - - 0 1';
  const tactical = choosePersonalityMove({
    fen: endgame,
    candidates: [
      { uci: 'a1a8', scoreCp: 0, mate: null },
      { uci: 'a1a7', scoreCp: 0, mate: null },
    ],
    style: STYLE,
    elo: 1400,
    random: () => 0.9,
  });
  assert.equal(tactical?.uci, 'a1a8', 'the check is the move his tactical eye likes');

  /* But a clearly worse tactic is never played for style. */
  const refuted = choosePersonalityMove({
    fen: italian,
    candidates: [
      { uci: 'f3g5', scoreCp: -140, mate: null },
      { uci: 'e1g1', scoreCp: 10, mate: null },
    ],
    style: STYLE,
    elo: 1400,
    random: () => 0.1,
  });
  assert.equal(refuted?.uci, 'e1g1');
});

test('his tactical ambition does not become tactical accuracy', () => {
  assert.equal(STYLE.accuracy, accuracyForElo(1400));
  assert.equal(STYLE.accuracy, 1.05, 'the 1400 dial, not a master curve');
  assert.equal(STYLE.depthCap, undefined);
  assert.equal(STYLE.mistakeChance, undefined);
  assert.ok(candidateGapForElo(1400) > candidateGapForElo(2000));
  assert.ok(blunderChance(1400) > blunderChance(2000), 'he still makes 1400 mistakes');
  /* Tactical ambition is the second-highest dial, and it is only ambition. */
  assert.ok(STYLE.tactical > STYLE.defensive);
  assert.ok(STYLE.accuracy < accuracyForElo(1800));
});

/* --------------------------- 3. Jobava London --------------------------- */

test('White plays the Jobava London: 1.d4, Bf4 and Nc3', () => {
  assert.ok(JONAH_PACHIKARA_REPERTOIRE.asWhite.length >= 2);
  for (const line of JONAH_PACHIKARA_REPERTOIRE.asWhite) {
    assert.equal(line.san[0], 'd4', `${line.id} starts 1.d4`);
    assert.ok(line.san.includes('Bf4'), `${line.id} develops the bishop to f4`);
    assert.ok(line.san.includes('Nc3'), `${line.id} brings the queenside knight out`);
    assert.ok(line.san.includes('e3'), `${line.id} supports the centre`);
    assert.ok(line.san.length <= 16, `${line.id} stays a short, sound line`);
    assert.ok(line.id.startsWith('jonah-pachikara-'));
  }

  assert.deepEqual(
    legalBookMoves(personalityBookFor('jonah-pachikara', 'w'), new Chess()).map(
      (move) => move.san,
    ),
    ['d4'],
  );
  const afterD5 = legalBookMoves(
    personalityBookFor('jonah-pachikara', 'w'),
    position('d4', 'd5'),
  ).map((move) => move.san);
  assert.ok(afterD5.includes('Nc3'), 'the Jobava knight');
  assert.ok(afterD5.includes('Bf4'), 'the Jobava bishop');
});

/* --------------------------- 4. Scandinavian ---------------------------- */

test('Black answers 1.e4 with the Scandinavian 1...d5 and the supplied mains', () => {
  assert.deepEqual(
    legalBookMoves(personalityBookFor('jonah-pachikara', 'b'), position('e4')).map(
      (move) => move.san,
    ),
    ['d5'],
  );
  /* The declared ...Qa5 main line came from the supplied theory. */
  const afterQa5 = position(
    'e4',
    'd5',
    'exd5',
    'Qxd5',
    'Nc3',
    'Qa5',
    'd4',
    'Nf6',
    'Nf3',
    'Bg4',
    'h3',
  );
  assert.deepEqual(
    legalBookMoves(personalityBookFor('jonah-pachikara', 'b'), afterQa5).map(
      (move) => move.san,
    ),
    ['Bh5'],
  );
  assert.ok(
    JONAH_PACHIKARA_REPERTOIRE.asBlack.some(
      (line) => line.san.join(' ').includes('O-O-O') && line.san.includes('Qa5'),
    ),
    'the long castle of the ...Qa5 main line is preserved',
  );
  /* A different second move keeps him in familiar territory. */
  assert.ok(
    legalBookMoves(
      personalityBookFor('jonah-pachikara', 'b'),
      position('e4', 'd5', 'exd5', 'Nf6', 'd4'),
    ).some((move) => move.san === 'Nxd5'),
  );
});

/* ------------------- 1...d5 against 1.d4, and fallback ------------------ */

test('Black answers 1.d4 with 1...d5 and principled development', () => {
  assert.deepEqual(
    legalBookMoves(personalityBookFor('jonah-pachikara', 'b'), position('d4')).map(
      (move) => move.san,
    ),
    ['d5'],
  );
  const afterD5 = legalBookMoves(
    personalityBookFor('jonah-pachikara', 'b'),
    position('d4', 'd5', 'c4'),
  ).map((move) => move.san);
  assert.ok(afterD5.includes('e6'), 'Queen’s Gambit Declined structure');
  /* He never reaches for the King's Indian layer: 1...d5 is his answer. */
  assert.equal(kidPlan(position('d4').fen(), ['d4'], STYLE), null);
});

test('outside his book he falls back to legal, principled moves', async () => {
  const reti = position('Nf3', 'Nf6');
  assert.deepEqual(legalBookMoves(personalityBookFor('jonah-pachikara', 'w'), reti), []);

  const chosen = await chooseBotMove({
    game: reti,
    fen: reti.fen(),
    history: ['Nf3', 'Nf6'],
    botColor: 'w',
    style: STYLE,
    elo: 1400,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: engineWith([
      { uci: 'c2c4', scoreCp: 25 },
      { uci: 'd2d4', scoreCp: 18 },
      { uci: 'g2g3', scoreCp: 12 },
    ]),
    random: () => 0.5,
  });
  assert.ok(chosen);
  assert.equal(chosen.bookMove, false);
  assert.equal(chosen.source, 'engine');
  assertLegal(reti.fen(), chosen.uci);

  assert.deepEqual(
    legalBookMoves(personalityBookFor('jonah-pachikara', 'w'), position('e4')).map(
      (move) => move.san,
    ),
    [],
    'his Black answers do not become White moves',
  );
});

test('his book compiles, stays legal and borrows nothing from another opponent', () => {
  assert.deepEqual(repertoireIssues().filter((entry) => entry.issues.length > 0), []);
  assert.ok(repertoireIssues().some((entry) => entry.id === 'jonah-pachikara'));

  for (const color of ['w', 'b'] as const) {
    for (const [key, moves] of personalityBooks('jonah-pachikara')[color].book) {
      assert.equal(key.split(' ')[1], color, `${color} book only holds ${color} turns`);
      for (const entry of moves) {
        assertLegal(`${key} - 0 1`, entry.uci);
        assert.ok(entry.lineIds.every((id) => id.startsWith('jonah-pachikara-')));
      }
    }
  }

  const foreign = Object.entries(PERSONALITY_REPERTOIRES)
    .filter(([id]) => id !== 'jonah-pachikara')
    .flatMap(([, repertoire]) => [...repertoire.asWhite, ...repertoire.asBlack]);
  for (const line of [
    ...JONAH_PACHIKARA_REPERTOIRE.asWhite,
    ...JONAH_PACHIKARA_REPERTOIRE.asBlack,
  ]) {
    assert.equal(foreign.includes(line), false, `${line.id} is a line of his own`);
    assert.equal(
      foreign.some((other) => other.san.join(' ') === line.san.join(' ')),
      false,
      `${line.id} is not copied from another opponent`,
    );
  }
});

/* ---------------------------- 6. dialogue ------------------------------- */

test('his voice is understated, casual and free of theory talk', () => {
  const bank = DIALOGUE_BANKS['jonah-pachikara'];
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
        !/\b(gambit|scandinavian|jobava|london|fianchetto|zugzwang|variation|theory|tactic)\b/i.test(line),
        `no theory talk: ${line}`,
      );
    }
  }

  const spoken = Object.values(bank).flat().join(' | ');
  for (const line of [
    'Oh, okay.',
    'That’s interesting.',
    'Yeah, I see it.',
    'I think there’s something here.',
    'That’s not ideal.',
    'Good game.',
  ]) {
    assert.ok(spoken.includes(line), `missing his voice: ${line}`);
  }

  const all = Object.values(bank).flat();
  assert.equal(all.filter((line) => line === line.toUpperCase()).length, 0, 'no shouting');
  assert.ok(all.filter((line) => line.includes('!')).length <= 1, 'understated, not gushing');
  assert.notEqual(bank, DIALOGUE_BANKS.edward, 'not a copy of Edward’s stoicism');
  assert.notEqual(bank, DIALOGUE_BANKS.freshman);
});

test('his lines respect the quiet gap, the repeat gap and never repeat', () => {
  const state = createDialogueState();
  assert.ok(maybeReact('jonah-pachikara', 'strong', { ply: 20, state, random: () => 0 }));

  /* Inside his six-ply gap he stays quiet, whichever event it is. */
  assert.equal(maybeReact('jonah-pachikara', 'mistake', { ply: 24, state, random: () => 0 }), null);
  assert.ok(maybeReact('jonah-pachikara', 'mistake', { ply: 26, state, random: () => 0 }));

  /* The same event waits for the longer repeat gap. */
  assert.equal(maybeReact('jonah-pachikara', 'strong', { ply: 32, state, random: () => 0 }), null);
  assert.ok(maybeReact('jonah-pachikara', 'strong', { ply: 35, state, random: () => 0 }));

  /* Once-per-game remarks stay once per game. */
  const once = createDialogueState();
  assert.ok(maybeReact('jonah-pachikara', 'losing', { ply: 10, state: once, random: () => 0 }));
  assert.equal(
    maybeReact('jonah-pachikara', 'losing', { ply: 80, state: once, random: () => 0 }),
    null,
  );

  /* A used line is not chosen again while the bank lasts. */
  const fresh = createDialogueState();
  const seen = new Set<string>();
  let ply = 40;
  while (seen.size < DIALOGUE_BANKS['jonah-pachikara'].strong.length) {
    ply += 20;
    const line = maybeReact('jonah-pachikara', 'strong', { ply, state: fresh, random: () => 0.99 });
    assert.ok(line);
    assert.equal(seen.has(line.text), false, 'a line is not repeated while unused ones remain');
    seen.add(line.text);
  }

  /* A finished game always gets a line. */
  const closing = createDialogueState();
  const loss = maybeReact('jonah-pachikara', 'loss', {
    ply: 2,
    state: closing,
    force: true,
    random: () => 0,
  });
  assert.ok(loss);
  assert.ok(DIALOGUE_BANKS['jonah-pachikara'].loss.includes(loss.text));
});

/* ------------------- 7. Normal Play and Bot vs. Bot --------------------- */

test('Normal Play: his first move is 1.d4 from the Jobava book, with no search', async () => {
  const game = new Chess();
  const chosen = await chooseBotMove({
    game,
    fen: game.fen(),
    history: [],
    botColor: 'w',
    style: STYLE,
    elo: 1400,
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
    game: position('e4'),
    fen: position('e4').fen(),
    history: ['e4'],
    botColor: 'b',
    style: STYLE,
    elo: 1400,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: noEngine,
    random: () => 0.99,
  });
  assert.equal(asBlack?.uci, 'd7d5');

  const vsD4 = await chooseBotMove({
    game: position('d4'),
    fen: position('d4').fen(),
    history: ['d4'],
    botColor: 'b',
    style: STYLE,
    elo: 1400,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: noEngine,
    random: () => 0.99,
  });
  assert.equal(vsD4?.uci, 'd7d5');
});

test('he thinks for a relaxed, patient beat in every phase', () => {
  for (const fen of [
    new Chess().fen(),
    position('d4', 'd5', 'Nc3', 'Nf6', 'Bf4', 'e6').fen(),
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

test('a saved game and its PGN keep his name, rating and identity', () => {
  const pgn = buildPgn(
    {
      white: opponentFullName(getOpponent('brandon')!),
      black: opponentFullName(JONAH),
      result: '0-1',
      date: Date.UTC(2026, 10, 21),
      timeControl: '300+0',
      whiteElo: getOpponent('brandon')!.elo,
      blackElo: JONAH.elo,
      event: 'Bot vs. Bot',
    },
    ['d4', 'd5', 'Nc3', 'Nf6'],
  );
  assert.match(pgn, /\[Black "Jonah Pachikara"\]/, 'no invented subtext in the header');
  assert.match(pgn, /\[BlackElo "1400"\]/);

  const profile = profileFromRecord({
    opponent_id: JONAH.id,
    opponent_name: opponentFullName(JONAH),
    opponent_elo: JONAH.elo,
    opponent_kind: JONAH.kind,
  });
  assert.equal(profile.id, 'jonah-pachikara');
  assert.equal(profile.name, 'Jonah Pachikara');
  assert.equal(profile.title, undefined);
  assert.equal(profile.elo, 1400);
  assert.equal(profile.category, 'intermediate');
  assert.equal(opponentMeta(profile), '1400 Elo');
});

/* ---------------------------- 9. regressions ---------------------------- */

test('every other opponent and the General Bot are untouched', () => {
  assert.equal(PERSONALITY_OPPONENTS.length, 20);
  assert.equal(ALL_OPPONENTS.length, 21);

  const expected: Array<[string, string, string, number, string]> = [
    ['emmanuel', 'Emmanuel Domah', 'Senior', 400, 'beginner'],
    ['edward', 'Edward Chen', 'Senior', 800, 'beginner'],
    ['faadi', 'Faadi Granillo Garcia', 'Prime', 700, 'beginner'],
    ['nina-freshman', 'Nina Yang', 'Freshman', 1200, 'novice'],
    ['freshman', 'Johnfer Quispe', 'Freshman', 1250, 'novice'],
    ['alex-tang', 'Alex Tang', 'Sophomore', 1100, 'novice'],
    ['erik-wiessmann', 'Erik Wiessmann', 'Teacher', 1100, 'novice'],
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
    assert.notEqual(opponent.id, JONAH.id);
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
  assert.equal(PERSONALITY_STYLES['erik-wiessmann'].positional, 75);

  /* Other books still build; his registration gives no one his lines. */
  for (const id of ['freshman', 'edward', 'bryan-widjaja', 'alex-tang', 'erik-wiessmann']) {
    assert.ok(
      personalityBookFor(id, 'w').size + personalityBookFor(id, 'b').size > 0,
      `${id} still has a book`,
    );
  }
});
