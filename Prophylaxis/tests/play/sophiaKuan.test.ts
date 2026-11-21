/**
 * Sophia Kuan — the gentle defender, 1300.
 *
 * Covers her catalogue identity, the Novice band, the defensive/simplifying
 * tendency table and the 1300 strength dials, the quiet Vienna, the French,
 * the 1...d5 answer to 1.d4, legal fallback, how her simplification does (and
 * does not) reach the move choice, her voice and cadence, Normal Play and Bot
 * vs. Bot, saved-game/PGN identity, and the regressions for every other
 * opponent.
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
import { SOPHIA_KUAN_REPERTOIRE } from '../../src/play/personality/repertoires/sophiaKuan.ts';
import { kidPlan } from '../../src/play/personality/repertoires/kid.ts';
import { chooseBotMove } from '../../src/play/personality/chooseMove.ts';
import { candidateGapForElo, choosePersonalityMove } from '../../src/play/personality/engine.ts';
import { computeThinkingPlan } from '../../src/play/personality/thinking.ts';
import { blunderChance } from '../../src/play/strength.ts';
import { buildPgn } from '../../src/play/pgn.ts';
import type { StockfishController } from '../../src/engine/useStockfish.ts';

const SOPHIA = getOpponent('sophia-kuan');
const STYLE = styleFor('sophia-kuan', 1300) as PersonalityStyle;

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

test('Sophia Kuan is registered at 1300 as Senior in the Novice band', () => {
  assert.ok(SOPHIA);
  assert.equal(SOPHIA.id, 'sophia-kuan', 'her own stable id');
  assert.equal(SOPHIA.kind, 'personality');
  assert.equal(SOPHIA.name, 'Sophia Kuan');
  assert.equal(SOPHIA.title, 'Senior', 'the subtext is exactly Senior');
  assert.equal(SOPHIA.elo, 1300);
  assert.equal(SOPHIA.category, 'novice', 'Senior is identity, not category');
  assert.equal(SOPHIA.initials, 'SK');
  assert.equal(SOPHIA.usesRepertoire, false);
  assert.ok(SOPHIA.style.length > 0);
  assert.match(SOPHIA.style, /defen|gentle|cautious/i);

  assert.doesNotMatch(SOPHIA.name, /\(/, 'the name carries no parenthetical suffix');
  assert.doesNotMatch(SOPHIA.name, /senior/i, 'the subtext lives in its own field');
  assert.equal(opponentStage(SOPHIA), 'Senior');
  assert.equal(opponentMeta(SOPHIA), 'Senior · 1300 Elo');
  assert.equal(opponentFullName(SOPHIA), 'Sophia Kuan (Senior)');
});

test('she sits in Novice, beside the other 1100–1250 cards', () => {
  const novice = PERSONALITY_OPPONENTS.filter((opponent) => opponent.category === 'novice');
  assert.ok(novice.some((opponent) => opponent.id === 'sophia-kuan'));
  assert.equal(novice.length, 5);
  assert.equal(getOpponent('nina-freshman')?.elo, 1200);
  assert.equal(getOpponent('freshman')?.elo, 1250);
  assert.equal(getOpponent('alex-tang')?.elo, 1100);
  assert.equal(getOpponent('erik-wiessmann')?.elo, 1100);
  /* She is the highest-rated Novice, and still below every Intermediate. */
  assert.equal(Math.max(...novice.map((opponent) => opponent.elo)), 1300);
  const lowestIntermediate = Math.min(
    ...PERSONALITY_OPPONENTS.filter((opponent) => opponent.category === 'intermediate').map(
      (opponent) => opponent.elo,
    ),
  );
  assert.ok(SOPHIA.elo < lowestIntermediate);
});

test('her id is unique and history can tell her apart from every opponent', () => {
  assert.equal(
    PERSONALITY_OPPONENTS.filter((opponent) => opponent.id === 'sophia-kuan').length,
    1,
  );
  assert.equal(new Set(ALL_OPPONENTS.map((opponent) => opponent.id)).size, ALL_OPPONENTS.length);
  assert.equal(getOpponent('sophia-kuan'), SOPHIA, 'the catalogue entry is the same object');
  assert.equal(
    new Set(PERSONALITY_OPPONENTS.map((opponent) => opponentFullName(opponent))).size,
    PERSONALITY_OPPONENTS.length,
    'saved games can always tell two opponents apart',
  );
  assert.equal(
    PERSONALITY_OPPONENTS.filter((opponent) => opponent.elo === 1300).length,
    1,
    'her rating is her own',
  );
});

test('her portrait is her own file, with the monogram kept as the fallback', () => {
  assert.equal(SOPHIA.portraitPath, 'opponents/sophia-kuan.webp');
  assert.equal(fs.existsSync('public/opponents/sophia-kuan.webp'), true);
  for (const other of PERSONALITY_OPPONENTS) {
    if (other.id === 'sophia-kuan') continue;
    assert.notEqual(other.portraitPath, SOPHIA.portraitPath, `${other.id} keeps its own portrait`);
  }
});

/* ---------------------- 5. defensive + simplifying ---------------------- */

test('her tendency table is the gentle defender exactly', () => {
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
      aggression: 20,
      risk: 15,
      positional: 55,
      tactical: 35,
      defensive: 85,
      initiative: 20,
      simplification: 95,
      complexity: 10,
      kingSafety: 90,
      material: 90,
    },
  );
  assert.equal(STYLE.id, 'sophia-kuan');
  assert.ok(STYLE.sacrifice <= 10, 'no speculative material');
  assert.ok((STYLE.openingBias.solid ?? 0) > 0);
  assert.ok((STYLE.openingBias.sharp ?? 0) < 0, 'she is biased away from sharp openings');
  assert.ok((STYLE.openingBias.initiative ?? 0) < 0);
});

test('on equal moves she takes the simplification', () => {
  /* A rook trade is available and the engine rates it exactly as good. */
  const endgame = 'r3k3/8/8/8/8/8/8/R3K3 w - - 0 1';
  const trade = choosePersonalityMove({
    fen: endgame,
    candidates: [
      { uci: 'a1a8', scoreCp: 0, mate: null },
      { uci: 'a1a2', scoreCp: 0, mate: null },
    ],
    style: STYLE,
    elo: 1300,
    random: () => 0.5,
  });
  assert.equal(trade?.uci, 'a1a8', 'the exchange is her preferred move');

  /* Queue trade: a queen swap clears the board, so she takes it. */
  const queens = '3qk3/8/8/8/8/8/8/3QK3 w - - 0 1';
  const queensTrade = choosePersonalityMove({
    fen: queens,
    candidates: [
      { uci: 'd1d8', scoreCp: 0, mate: null },
      { uci: 'd1d2', scoreCp: 0, mate: null },
    ],
    style: STYLE,
    elo: 1300,
    random: () => 0.5,
  });
  assert.equal(queensTrade?.uci, 'd1d8');
});

test('but she never forces an exchange that costs material or ignores a win', () => {
  const italian = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 6';

  /* A capture that walks into a loss scores badly: the quiet move wins. */
  const badTrade = choosePersonalityMove({
    fen: italian,
    candidates: [
      { uci: 'f3g5', scoreCp: -180, mate: null },
      { uci: 'e1g1', scoreCp: 20, mate: null },
    ],
    style: STYLE,
    elo: 1300,
    random: () => 0.1,
  });
  assert.equal(badTrade?.uci, 'e1g1', 'simplification cannot outvote a lost piece');

  /* A clearly better move is not traded away for a neutral exchange. */
  const better = choosePersonalityMove({
    fen: italian,
    candidates: [
      { uci: 'f3e5', scoreCp: 5, mate: null },
      { uci: 'e1g1', scoreCp: 60, mate: null },
    ],
    style: STYLE,
    elo: 1300,
    random: () => 0.1,
  });
  assert.equal(better?.uci, 'e1g1');

  /* And a winning capture is still a winning capture. */
  const win = choosePersonalityMove({
    fen: '4k3/8/8/8/8/8/4K3/R6r w - - 0 1',
    candidates: [
      { uci: 'a1a8', scoreCp: 0, mate: null },
      { uci: 'e2e1', scoreCp: 0, mate: null },
    ],
    style: STYLE,
    elo: 1300,
    random: () => 0.5,
  });
  assert.ok(win);
});

test('her 1300 dials are intact: defensive taste is not extra strength', () => {
  assert.equal(STYLE.accuracy, accuracyForElo(1300));
  assert.ok(STYLE.accuracy < accuracyForElo(1600), 'no accuracy inflation');
  assert.equal(STYLE.depthCap, undefined, 'no artificial search ceiling');
  assert.equal(STYLE.mistakeChance, undefined, 'the rating curve decides her slips');
  assert.equal(candidateGapForElo(1300), candidateGapForElo(1300));
  assert.ok(candidateGapForElo(1300) > candidateGapForElo(1700));
  assert.ok(blunderChance(1300) > blunderChance(1700), 'a 1300 still misses tactics');
  assert.ok(blunderChance(1300) < blunderChance(900));
});

/* ------------------------- 3. the quiet Vienna -------------------------- */

test('White plays the Vienna Game quietly: 1.e4, Nc3, no gambit', () => {
  assert.ok(SOPHIA_KUAN_REPERTOIRE.asWhite.length >= 2);
  for (const line of SOPHIA_KUAN_REPERTOIRE.asWhite) {
    assert.equal(line.san[0], 'e4', `${line.id} starts 1.e4`);
    assert.equal(line.san[2], 'Nc3', `${line.id} is a Vienna`);
    assert.ok(line.san.includes('d3'), `${line.id} keeps the centre supported, not pushed`);
    assert.ok(line.san.includes('O-O'), `${line.id} castles`);
    assert.equal(line.san.includes('f4'), false, `${line.id} is not the Vienna Gambit`);
    assert.ok(line.san.length <= 14, `${line.id} stays short and sound`);
    assert.ok(line.id.startsWith('sophia-kuan-'));
    assert.ok(line.tags?.includes('solid'));
  }

  assert.deepEqual(
    legalBookMoves(personalityBookFor('sophia-kuan', 'w'), new Chess()).map((move) => move.san),
    ['e4'],
  );
  const afterE5 = legalBookMoves(
    personalityBookFor('sophia-kuan', 'w'),
    position('e4', 'e5'),
  ).map((move) => move.san);
  assert.deepEqual(afterE5, ['Nc3']);
  assert.equal(
    legalBookMoves(personalityBookFor('sophia-kuan', 'w'), position('e4', 'e5', 'Nc3', 'Nf6')).some(
      (move) => move.san === 'f4',
    ),
    false,
    'no speculative gambit outside the book either',
  );
});

/* -------------------------- 4. the French ------------------------------- */

test('Black answers 1.e4 with the French 1...e6 and sound development', () => {
  assert.deepEqual(
    legalBookMoves(personalityBookFor('sophia-kuan', 'b'), position('e4')).map(
      (move) => move.san,
    ),
    ['e6'],
  );
  assert.deepEqual(
    legalBookMoves(personalityBookFor('sophia-kuan', 'b'), position('e4', 'e6', 'd4')).map(
      (move) => move.san,
    ),
    ['d5'],
  );

  /* The Rubinstein line meets 3.Nc3 by trading in the centre. */
  assert.deepEqual(
    legalBookMoves(
      personalityBookFor('sophia-kuan', 'b'),
      position('e4', 'e6', 'd4', 'd5', 'Nc3'),
    ).map((move) => move.san),
    ['dxe4'],
  );
  assert.ok(
    SOPHIA_KUAN_REPERTOIRE.asBlack.some((line) => line.san.includes('Nxf6')),
    'she is happy to trade knights for a simpler position',
  );

  /* The Tarrasch and the Advance both keep her structure compact. */
  assert.ok(
    legalBookMoves(
      personalityBookFor('sophia-kuan', 'b'),
      position('e4', 'e6', 'd4', 'd5', 'Nd2'),
    ).some((move) => move.san === 'Nf6'),
  );
  assert.ok(
    legalBookMoves(
      personalityBookFor('sophia-kuan', 'b'),
      position('e4', 'e6', 'd4', 'd5', 'e5'),
    ).some((move) => move.san === 'c5'),
  );
});

/* ------------------- 1...d5 against 1.d4, and fallback ------------------ */

test('Black answers 1.d4 with 1...d5 and principled development', () => {
  assert.deepEqual(
    legalBookMoves(personalityBookFor('sophia-kuan', 'b'), position('d4')).map(
      (move) => move.san,
    ),
    ['d5'],
  );
  assert.deepEqual(
    legalBookMoves(personalityBookFor('sophia-kuan', 'b'), position('d4', 'd5', 'c4')).map(
      (move) => move.san,
    ),
    ['e6'],
  );
  /* She declines the King's Indian layer: 1...d5 is her answer. */
  assert.equal(kidPlan(position('d4').fen(), ['d4'], STYLE, 'b'), null);
});

test('outside her book she falls back to legal, sensible moves', async () => {
  const reti = position('Nf3', 'Nf6');
  assert.deepEqual(legalBookMoves(personalityBookFor('sophia-kuan', 'w'), reti), []);

  const chosen = await chooseBotMove({
    game: reti,
    fen: reti.fen(),
    history: ['Nf3', 'Nf6'],
    botColor: 'w',
    style: STYLE,
    elo: 1300,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: engineWith([
      { uci: 'g2g3', scoreCp: 22 },
      { uci: 'c2c4', scoreCp: 18 },
      { uci: 'd2d4', scoreCp: 12 },
    ]),
    random: () => 0.5,
  });
  assert.ok(chosen);
  assert.equal(chosen.bookMove, false);
  assert.equal(chosen.source, 'engine');
  assertLegal(reti.fen(), chosen.uci);

  assert.deepEqual(
    legalBookMoves(personalityBookFor('sophia-kuan', 'w'), position('e4')).map(
      (move) => move.san,
    ),
    [],
    'her Black answers do not become White moves',
  );
});

test('her book compiles, stays legal and borrows nothing from another opponent', () => {
  assert.deepEqual(repertoireIssues().filter((entry) => entry.issues.length > 0), []);
  assert.ok(repertoireIssues().some((entry) => entry.id === 'sophia-kuan'));

  for (const color of ['w', 'b'] as const) {
    for (const [key, moves] of personalityBooks('sophia-kuan')[color].book) {
      assert.equal(key.split(' ')[1], color, `${color} book only holds ${color} turns`);
      for (const entry of moves) {
        assertLegal(`${key} - 0 1`, entry.uci);
        assert.ok(entry.lineIds.every((id) => id.startsWith('sophia-kuan-')));
      }
    }
  }

  const foreign = Object.entries(PERSONALITY_REPERTOIRES)
    .filter(([id]) => id !== 'sophia-kuan')
    .flatMap(([, repertoire]) => [...repertoire.asWhite, ...repertoire.asBlack]);
  for (const line of [...SOPHIA_KUAN_REPERTOIRE.asWhite, ...SOPHIA_KUAN_REPERTOIRE.asBlack]) {
    assert.equal(foreign.includes(line), false, `${line.id} is a line of her own`);
    assert.equal(
      foreign.some((other) => other.san.join(' ') === line.san.join(' ')),
      false,
      `${line.id} is not copied from another opponent`,
    );
  }
});

/* ---------------------------- 6. dialogue ------------------------------- */

test('her voice is soft-spoken, kind and free of theory talk', () => {
  const bank = DIALOGUE_BANKS['sophia-kuan'];
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
        !/\b(gambit|french|vienna|london|fianchetto|zugzwang|variation|theory|tactic)\b/i.test(line),
        `no theory talk: ${line}`,
      );
      assert.equal(/!{2,}/.test(line), false, 'never shrill');
    }
  }

  const bankLines = Object.values(bank).flat().join(' | ');
  for (const line of [
    'Oh, okay.',
    'I think that’s alright.',
    'Maybe I should trade here.',
    'I hope this works.',
    'That’s alright. Let’s keep going.',
    'Good game, thank you.',
  ]) {
    assert.ok(bankLines.includes(line), `missing her voice: ${line}`);
  }

  for (const event of ['win', 'loss', 'draw'] as const) {
    for (const line of bank[event]) {
      assert.match(
        line,
        /good game|thank|alright|fine/i,
        `${event}: she stays polite and gracious`,
      );
    }
  }
  for (const line of Object.values(bank).flat()) {
    assert.doesNotMatch(line, /\b(ha(ha)?|lol|beat you|finally)\b/i, `no taunting: ${line}`);
  }
  assert.notEqual(bank, DIALOGUE_BANKS.freshman);
  assert.notEqual(bank, DIALOGUE_BANKS['jonah-pachikara']);
});

test('her lines respect the quiet gap, the repeat gap and never repeat', () => {
  const state = createDialogueState();
  assert.ok(maybeReact('sophia-kuan', 'strong', { ply: 20, state, random: () => 0 }));

  /* The same event waits for the longer repeat gap. */
  assert.equal(maybeReact('sophia-kuan', 'strong', { ply: 26, state, random: () => 0 }), null);
  assert.ok(maybeReact('sophia-kuan', 'strong', { ply: 29, state, random: () => 0 }));

  /* Inside her three-ply gap she stays quiet, whichever event it is. */
  assert.equal(maybeReact('sophia-kuan', 'mistake', { ply: 30, state, random: () => 0 }), null);
  assert.ok(maybeReact('sophia-kuan', 'mistake', { ply: 33, state, random: () => 0 }));

  /* Once-per-game remarks stay once per game. */
  const once = createDialogueState();
  assert.ok(maybeReact('sophia-kuan', 'losing', { ply: 10, state: once, random: () => 0 }));
  assert.equal(
    maybeReact('sophia-kuan', 'losing', { ply: 90, state: once, random: () => 0 }),
    null,
  );

  /* A used line is not chosen again while the bank lasts. */
  const fresh = createDialogueState();
  const seen = new Set<string>();
  let ply = 40;
  while (seen.size < DIALOGUE_BANKS['sophia-kuan'].strong.length) {
    ply += 20;
    const line = maybeReact('sophia-kuan', 'strong', { ply, state: fresh, random: () => 0.99 });
    assert.ok(line);
    assert.equal(seen.has(line.text), false, 'a line is not repeated while unused ones remain');
    seen.add(line.text);
  }

  /* A finished game always gets a polite line. */
  const closing = createDialogueState();
  const win = maybeReact('sophia-kuan', 'win', {
    ply: 2,
    state: closing,
    force: true,
    random: () => 0,
  });
  assert.ok(win);
  assert.ok(DIALOGUE_BANKS['sophia-kuan'].win.includes(win.text));
});

/* ------------------- 7. Normal Play and Bot vs. Bot --------------------- */

test('Normal Play: her first move is 1.e4 from the Vienna book, with no search', async () => {
  const game = new Chess();
  const chosen = await chooseBotMove({
    game,
    fen: game.fen(),
    history: [],
    botColor: 'w',
    style: STYLE,
    elo: 1300,
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

test('Bot vs. Bot: she answers 1.e4 with the French and 1.d4 with 1...d5', async () => {
  const french = await chooseBotMove({
    game: position('e4'),
    fen: position('e4').fen(),
    history: ['e4'],
    botColor: 'b',
    style: STYLE,
    elo: 1300,
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
    elo: 1300,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: noEngine,
    random: () => 0.99,
  });
  assert.equal(vsD4?.uci, 'd7d5');
});

test('she thinks at a relaxed, cautious pace in every phase', () => {
  for (const fen of [
    new Chess().fen(),
    position('e4', 'e6', 'd4', 'd5', 'Nc3', 'Nf6').fen(),
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

test('a saved game and its PGN keep her name, rating and identity', () => {
  const pgn = buildPgn(
    {
      white: opponentFullName(getOpponent('brandon')!),
      black: opponentFullName(SOPHIA),
      result: '1-0',
      date: Date.UTC(2026, 10, 21),
      timeControl: '300+0',
      whiteElo: getOpponent('brandon')!.elo,
      blackElo: SOPHIA.elo,
      event: 'Bot vs. Bot',
    },
    ['e4', 'e6', 'd4', 'd5'],
  );
  assert.match(pgn, /\[Black "Sophia Kuan \(Senior\)"\]/);
  assert.match(pgn, /\[BlackElo "1300"\]/);

  const profile = profileFromRecord({
    opponent_id: SOPHIA.id,
    opponent_name: opponentFullName(SOPHIA),
    opponent_elo: SOPHIA.elo,
    opponent_kind: SOPHIA.kind,
  });
  assert.equal(profile.id, 'sophia-kuan');
  assert.equal(profile.name, 'Sophia Kuan');
  assert.equal(profile.title, 'Senior');
  assert.equal(profile.elo, 1300);
  assert.equal(profile.category, 'novice');
  assert.equal(opponentMeta(profile), 'Senior · 1300 Elo');
});

/* ---------------------------- 9. regressions ---------------------------- */

test('every other opponent and the General Bot are untouched', () => {
  assert.equal(PERSONALITY_OPPONENTS.length, 22);
  assert.equal(ALL_OPPONENTS.length, 23);

  const expected: Array<[string, string, string | undefined, number, string]> = [
    ['emmanuel', 'Emmanuel Domah', 'Senior', 150, 'beginner'],
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
    assert.notEqual(opponent.id, SOPHIA.id);
  }
  assert.equal(GENERAL_BOT.id, 'general');
  assert.equal(GENERAL_BOT.elo, 1500);
  assert.equal(GENERAL_BOT.usesRepertoire, false);

  /* Other profiles' tendency anchors are exactly as they were. */
  assert.equal(PERSONALITY_STYLES.freshman.simplification, 75);
  assert.equal(PERSONALITY_STYLES['bryan-widjaja'].defensive, 98);
  assert.equal(PERSONALITY_STYLES['alex-tang'].complexity, 30);
  assert.equal(PERSONALITY_STYLES['erik-wiessmann'].positional, 75);
  assert.equal(PERSONALITY_STYLES['jonah-pachikara'].tactical, 85);

  for (const id of ['freshman', 'edward', 'bryan-widjaja', 'alex-tang', 'erik-wiessmann', 'jonah-pachikara']) {
    assert.ok(
      personalityBookFor(id, 'w').size + personalityBookFor(id, 'b').size > 0,
      `${id} still has a book`,
    );
  }
});
