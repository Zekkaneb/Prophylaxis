/**
 * Mabinti Mansaray (Junior) — the enthusiast, 1550.
 *
 * Covers her catalogue entry and card identity, the tendency table, the
 * Queen's Gambit repertoire and her 1...e5 / 1...d5 answers, legal fallback
 * outside the book, her voice and its cadence, Normal Play and Bot vs. Bot
 * selection, saved-game/PGN identity, and the regressions that keep every other
 * opponent and the General Bot unchanged.
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
import { MABINTI_REPERTOIRE } from '../../src/play/personality/repertoires/mabinti.ts';
import { chooseBotMove } from '../../src/play/personality/chooseMove.ts';
import {
  candidateGapForElo,
  choosePersonalityMove,
} from '../../src/play/personality/engine.ts';
import { computeThinkingPlan } from '../../src/play/personality/thinking.ts';
import { blunderChance } from '../../src/play/strength.ts';
import { buildPgn } from '../../src/play/pgn.ts';
import type { StockfishController } from '../../src/engine/useStockfish.ts';

const MABINTI = getOpponent('mabinti');
const STYLE = styleFor('mabinti', 1550) as PersonalityStyle;

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

/** Engine stub for the positions where she has to improvise. */
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

/* ------------------------- 1-3. identity and card ------------------------- */

test('Mabinti Mansaray is on the roster as Junior, 1550, in the Strong group', () => {
  assert.ok(MABINTI);
  assert.equal(MABINTI.id, 'mabinti', 'her own stable id');
  assert.equal(MABINTI.kind, 'personality');
  assert.equal(MABINTI.name, 'Mabinti Mansaray');
  assert.equal(MABINTI.title, 'Junior', 'the subtext is exactly Junior');
  assert.equal(MABINTI.elo, 1550);
  assert.equal(MABINTI.category, 'strong');
  assert.equal(MABINTI.initials, 'MM');
  assert.equal(MABINTI.usesRepertoire, false);

  /* Two display fields, never one combined name. */
  assert.doesNotMatch(MABINTI.name, /\(/, 'the name carries no parenthetical suffix');
  assert.doesNotMatch(MABINTI.name, /junior/i, 'the subtext lives in its own field');
  assert.equal(opponentStage(MABINTI), 'Junior');
  assert.equal(opponentMeta(MABINTI), 'Junior · 1550 Elo');
  assert.equal(opponentFullName(MABINTI), 'Mabinti Mansaray (Junior)');
  assert.ok(MABINTI.style.length > 0);
});

test('her id is unique across the whole roster and stable across lookups', () => {
  assert.equal(PERSONALITY_OPPONENTS.filter((opponent) => opponent.id === 'mabinti').length, 1);
  assert.equal(new Set(ALL_OPPONENTS.map((opponent) => opponent.id)).size, ALL_OPPONENTS.length);
  assert.equal(getOpponent('mabinti')?.id, 'mabinti');
  assert.equal(getOpponent('mabinti'), MABINTI, 'the catalogue entry is the same object');
  /* Nobody else answers to her name. */
  assert.equal(
    PERSONALITY_OPPONENTS.filter((opponent) => opponent.name === 'Mabinti Mansaray').length,
    1,
  );
  assert.notEqual(opponentFullName(MABINTI), opponentFullName(getOpponent('bryan')!));
});

test('she is listed in the Strong section beside the other 1550', () => {
  const strong = PERSONALITY_OPPONENTS.filter((opponent) => opponent.category === 'strong');
  assert.ok(strong.some((opponent) => opponent.id === 'mabinti'));
  assert.equal(getOpponent('nina')?.elo, 1550);
  /* Same rating, different character: both cards exist, both are selectable. */
  assert.equal(strong.filter((opponent) => opponent.elo === 1550).length, 2);
});

test('her portrait is her own file, with the monogram kept as the fallback', () => {
  assert.equal(MABINTI.portraitPath, 'opponents/mabinti.webp');
  assert.equal(MABINTI.initials, 'MM');
  assert.equal(fs.existsSync('public/opponents/mabinti.webp'), true);
  for (const other of PERSONALITY_OPPONENTS) {
    if (other.id === 'mabinti') continue;
    assert.notEqual(other.portraitPath, MABINTI.portraitPath, `${other.id} keeps its own portrait`);
  }
});

/* --------------------------- 8. personality shape ------------------------- */

test('her tendency table is the balanced enthusiast as specified', () => {
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
      aggression: 50,
      risk: 45,
      positional: 70,
      tactical: 65,
      defensive: 65,
      initiative: 50,
      simplification: 55,
      complexity: 45,
      kingSafety: 75,
      material: 65,
    },
  );
  assert.equal(STYLE.id, 'mabinti');
  /* Strength comes from the rating, never from the tendencies. */
  assert.equal(STYLE.accuracy, accuracyForElo(1550));
  assert.equal(STYLE.depthCap, undefined, 'no artificial search ceiling');
  assert.ok(STYLE.sacrifice < 50, 'no taste for handing over material');
  assert.ok((STYLE.openingBias.positional ?? 0) > 0);
  assert.ok((STYLE.openingBias.sharp ?? 0) < 0, 'she avoids unnecessary complications');
});

test('she is not a copy of any other profile at or near her rating', () => {
  const keys = [
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
  const mine = keys.map((key) => STYLE[key]);
  for (const other of Object.values(PERSONALITY_STYLES)) {
    if (other.id === 'mabinti') continue;
    assert.notDeepEqual(mine, keys.map((key) => other[key]), `${other.id} is a different character`);
  }
  /* Balanced, not extreme: nothing sits at the top or bottom of the table. */
  assert.ok(mine.every((value) => value >= 35 && value <= 80));
});

test('1550 is the strength dial, and it is a genuine 1550', () => {
  assert.equal(candidateGapForElo(1550), candidateGapForElo(1550));
  assert.ok(candidateGapForElo(1550) <= candidateGapForElo(1450));
  assert.ok(candidateGapForElo(1550) >= candidateGapForElo(2000));
  assert.ok(blunderChance(1550) > 0 && blunderChance(1550) < 0.1);
  /* The same profile at another rating keeps its taste but not its strength. */
  const at2000 = styleFor('mabinti', 2000) as PersonalityStyle;
  assert.equal(at2000.positional, STYLE.positional);
  assert.notEqual(at2000.accuracy, STYLE.accuracy);
});

test('on equal moves she takes the sound one, and taste cannot outvote a clear best', () => {
  /* Italian Game: castle (sound) or throw the knight forward (loose). */
  const quietOrActive = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 6';
  const choice = choosePersonalityMove({
    fen: quietOrActive,
    candidates: [
      { uci: 'e1g1', scoreCp: 15, mate: null },
      { uci: 'f3g5', scoreCp: 15, mate: null },
    ],
    style: STYLE,
    elo: 1550,
    random: () => 0.9,
  });
  assert.equal(choice?.uci, 'e1g1');

  const sane = choosePersonalityMove({
    fen: quietOrActive,
    candidates: [
      { uci: 'e1g1', scoreCp: 15, mate: null },
      { uci: 'f3g5', scoreCp: -120, mate: null },
    ],
    style: STYLE,
    elo: 1550,
    random: () => 0.9,
  });
  assert.equal(sane?.uci, 'e1g1');
});

/* ------------------------- 4-6. opening repertoire ------------------------ */

test('her White repertoire is the Queen’s Gambit and nothing invented', () => {
  assert.equal(MABINTI_REPERTOIRE.asWhite.length, 3);
  for (const line of MABINTI_REPERTOIRE.asWhite) {
    assert.ok(line.san[0] === 'd4', `${line.id} starts 1.d4`);
    assert.ok(line.san.includes('c4'), `${line.id} is a Queen's Gambit`);
    assert.ok(line.san.length <= 18, `${line.id} stays a short, principled line`);
    assert.ok(line.id.startsWith('mabinti-'));
  }

  const start = new Chess();
  assert.deepEqual(
    legalBookMoves(personalityBookFor('mabinti', 'w'), start).map((move) => move.san),
    ['d4'],
  );
  /* 1.d4 d5 2.c4 is the gambit itself, and it is offered from the book. */
  assert.deepEqual(
    legalBookMoves(personalityBookFor('mabinti', 'w'), position('d4', 'd5')).map(
      (move) => move.san,
    ),
    ['c4'],
  );
  /* Normal development after the gambit, not a memorised offshoot. */
  const declined = position('d4', 'd5', 'c4', 'e6');
  assert.deepEqual(
    legalBookMoves(personalityBookFor('mabinti', 'w'), declined).map((move) => move.san),
    ['Nc3'],
  );
});

test('as Black she answers 1.e4 with 1...e5 and 1.d4 with 1...d5', () => {
  const e4 = position('e4');
  assert.deepEqual(
    legalBookMoves(personalityBookFor('mabinti', 'b'), e4).map((move) => move.san),
    ['e5'],
  );
  const d4 = position('d4');
  assert.deepEqual(
    legalBookMoves(personalityBookFor('mabinti', 'b'), d4).map((move) => move.san),
    ['d5'],
  );
  /* The same answers by transposition, because the book is keyed by position. */
  assert.ok(
    legalBookMoves(personalityBookFor('mabinti', 'b'), position('Nf3')).some(
      (move) => move.san === 'd5',
    ),
  );
  assert.ok(
    legalBookMoves(personalityBookFor('mabinti', 'b'), position('c4')).some(
      (move) => move.san === 'd5' || move.san === 'e6',
    ),
  );
});

test('her book compiles, stays legal, and borrows nothing from another opponent', () => {
  assert.deepEqual(repertoireIssues().filter((entry) => entry.issues.length > 0), []);
  assert.ok(repertoireIssues().some((entry) => entry.id === 'mabinti'));

  for (const color of ['w', 'b'] as const) {
    const entries = [...personalityBooks('mabinti')[color].book.entries()];
    assert.ok(entries.length > 0);
    for (const [key, moves] of entries) {
      assert.equal(key.split(' ')[1], color, `${color} book only holds ${color} turns`);
      const fen = `${key} - 0 1`;
      for (const entry of moves) {
        assertLegal(fen, entry.uci);
        assert.ok(entry.lineIds.every((id) => id.startsWith('mabinti-')));
      }
    }
  }

  /* Her lines are her own entries: nothing is imported from another
     character's repertoire object, and no id is shared with one. (Two
     characters can independently play the same ordinary mainline; what must
     never happen is one reading the other's book.) */
  const foreignIds = new Set(
    Object.entries(PERSONALITY_REPERTOIRES)
      .filter(([id]) => id !== 'mabinti')
      .flatMap(([, repertoire]) =>
        [...repertoire.asWhite, ...repertoire.asBlack].map((line) => line.id),
      ),
  );
  const ids = [...MABINTI_REPERTOIRE.asWhite, ...MABINTI_REPERTOIRE.asBlack].map(
    (line) => line.id,
  );
  for (const id of ids) {
    assert.equal(foreignIds.has(id), false, `${id} is not another character's line`);
  }
  assert.equal(new Set(ids).size, ids.length, 'unique line ids');
  /* She is not registered as a repertoire-less profile. */
  assert.equal(STYLE.id, 'mabinti');
  assert.ok(personalityBookFor('mabinti', 'w').size > 0);
});

/* --------------------------- 7. legal fallback ---------------------------- */

test('outside her repertoire she improvises legally, never an illegal lookup', async () => {
  /* 1.e4 as White is not her opening: nothing in the book, so the engine
     decides. (Her White book is the Queen's Gambit only.) */
  const openGame = position('e4', 'e5', 'Nf3', 'Nc6');
  assert.deepEqual(legalBookMoves(personalityBookFor('mabinti', 'w'), openGame), []);

  const chosen = await chooseBotMove({
    game: openGame,
    fen: openGame.fen(),
    history: ['e4', 'e5', 'Nf3', 'Nc6'],
    botColor: 'w',
    style: STYLE,
    elo: 1550,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: engineWith([
      { uci: 'f1b5', scoreCp: 30 },
      { uci: 'f1c4', scoreCp: 22 },
      { uci: 'd2d4', scoreCp: 18 },
      { uci: 'b1c3', scoreCp: 10 },
      { uci: 'c2c3', scoreCp: 0 },
    ]),
    random: () => 0.5,
  });
  assert.ok(chosen);
  assert.equal(chosen.bookMove, false);
  assert.equal(chosen.source, 'engine');
  assertLegal(openGame.fen(), chosen.uci);
});

test('the book exits as soon as the position leaves it, and never leaks into a colour', () => {
  assert.deepEqual(
    legalBookMoves(personalityBookFor('mabinti', 'w'), position('e4')).map((move) => move.san),
    [],
    'her Black answers do not become White moves',
  );
  assert.deepEqual(
    legalBookMoves(
      personalityBookFor('mabinti', 'b'),
      position('d4', 'd5', 'c4', 'e6', 'Nc3'),
    ).map((move) => move.san),
    ['Nf6'],
    'a Black turn is answered from the Black book',
  );
});

/* ---------------------------- 9-10. dialogue ------------------------------ */

test('her voice is cheerful, warm and free of written accents', () => {
  const bank = DIALOGUE_BANKS.mabinti;
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
      /* Her voice is punctuation and vocabulary — never phonetic spelling. */
      assert.doesNotMatch(line, /\b(ya|dont|gonna|wanna|ain't|da|de|ze)\b/i, line);
    }
  }

  const spoken = Object.values(bank).flat().join(' | ');
  for (const line of [
    'Alright guys, let’s do this!',
    'Okay, I’m ready. Right guys?',
    'YES! That’s what I’m talking about!',
    'Hmmmm, what do we have here?',
    'Ahhhhhh, I blundereddd!',
    'It’s okay guys, we’re still in this!',
    'We’re cooking, right guys?',
    'YESSS! What a game!',
  ]) {
    assert.ok(spoken.includes(line), `missing her voice: ${line}`);
  }
  /* Enthusiasm comes from exclamation, not from shouting in every line. */
  const all = Object.values(bank).flat();
  const excited = all.filter((line) => line.includes('!')).length;
  assert.ok(excited > all.length / 3);
  assert.ok(excited < all.length, 'some lines are calm');
});

test('she never borrows another character’s register', () => {
  const mine = Object.values(DIALOGUE_BANKS.mabinti).flat().join(' ').toLowerCase();
  for (const phrase of ['chat', 'lowkey', 'walahi', 'bro', 'light work', 'cooking chat']) {
    assert.equal(mine.includes(phrase), false, `no borrowed slang: ${phrase}`);
  }
  assert.notEqual(DIALOGUE_BANKS.mabinti, DIALOGUE_BANKS.faadi);
  assert.notEqual(DIALOGUE_BANKS.mabinti, DIALOGUE_BANKS.bryan);
  /* Losing is acknowledged, never pretended away. */
  assert.ok(DIALOGUE_BANKS.mabinti.loss.length >= 3);
});

test('her lines respect the quiet gap, the repeat gap and never repeat a line', () => {
  const state = createDialogueState();
  const first = maybeReact('mabinti', 'strong', { ply: 20, state, random: () => 0 });
  assert.ok(first);

  /* Inside her ordinary gap (five plies) she stays quiet. */
  assert.equal(maybeReact('mabinti', 'strong', { ply: 23, state, random: () => 0 }), null);
  assert.equal(maybeReact('mabinti', 'defense', { ply: 24, state, random: () => 0 }), null);
  /* Past the gap a different event may speak. */
  assert.ok(maybeReact('mabinti', 'defense', { ply: 26, state, random: () => 0 }));
  /* The same event waits for the longer repeat gap. */
  assert.equal(maybeReact('mabinti', 'strong', { ply: 30, state, random: () => 0 }), null);

  /* With the gap satisfied, a used line is not chosen again while the bank lasts. */
  const fresh = createDialogueState();
  const seen = new Set<string>();
  let ply = 40;
  while (seen.size < DIALOGUE_BANKS.mabinti.strong.length) {
    ply += 20;
    const line = maybeReact('mabinti', 'strong', { ply, state: fresh, random: () => 0.99 });
    assert.ok(line);
    assert.equal(seen.has(line.text), false, 'a line is not repeated until the bank runs out');
    seen.add(line.text);
  }

  /* A game ending always gets a line, whatever the clock of the conversation. */
  const closing = createDialogueState();
  const loss = maybeReact('mabinti', 'loss', { ply: 2, state: closing, force: true, random: () => 0 });
  assert.ok(loss);
  assert.ok(DIALOGUE_BANKS.mabinti.loss.includes(loss.text));
});

test('her dialogue never decides a move: the same position picks the same move', () => {
  const fen = position('d4', 'd5', 'c4', 'e6').fen();
  const candidates = [
    { uci: 'b1c3', scoreCp: 25, mate: null },
    { uci: 'g1f3', scoreCp: 20, mate: null },
    { uci: 'c1g5', scoreCp: 18, mate: null },
  ];
  const one = choosePersonalityMove({ fen, candidates, style: STYLE, elo: 1550, random: () => 0.3 });
  const two = choosePersonalityMove({ fen, candidates, style: STYLE, elo: 1550, random: () => 0.3 });
  assert.equal(one?.uci, two?.uci);
  assert.ok(candidates.some((candidate) => candidate.uci === one?.uci));
});

/* ---------------------- 11-12. Normal Play and Bot vs. Bot --------------- */

test('Normal Play: her first move comes from the book with no search at all', async () => {
  const game = new Chess();
  const chosen = await chooseBotMove({
    game,
    fen: game.fen(),
    history: [],
    botColor: 'w',
    style: STYLE,
    elo: 1550,
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

test('she can play both colours, and Bot vs. Bot drives the same selection', async () => {
  const asBlack = await chooseBotMove({
    game: position('e4'),
    fen: position('e4').fen(),
    history: ['e4'],
    botColor: 'b',
    style: STYLE,
    elo: 1550,
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
    elo: 1550,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: noEngine,
    random: () => 0.99,
  });
  assert.equal(vsD4?.uci, 'd7d5');
});

test('she thinks for an ordinary, unhurried beat in every phase', () => {
  for (const fen of [
    new Chess().fen(),
    position('d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7').fen(),
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

/* ------------------------ 13. history and PGN identity ------------------- */

test('a saved game and its PGN keep her name, subtext, colour and rating', () => {
  const pgn = buildPgn(
    {
      white: opponentFullName(getOpponent('brandon')!),
      black: opponentFullName(MABINTI),
      result: '0-1',
      date: Date.UTC(2026, 10, 19),
      timeControl: '300+0',
      whiteElo: getOpponent('brandon')!.elo,
      blackElo: MABINTI.elo,
      event: 'Bot vs. Bot',
    },
    ['d4', 'd5', 'c4', 'e6'],
  );
  assert.match(pgn, /\[Black "Mabinti Mansaray \(Junior\)"\]/);
  assert.match(pgn, /\[BlackElo "1550"\]/);

  /* History rebuilds her live card from the stored fields. */
  const profile = profileFromRecord({
    opponent_id: MABINTI.id,
    opponent_name: opponentFullName(MABINTI),
    opponent_elo: MABINTI.elo,
    opponent_kind: MABINTI.kind,
  });
  assert.equal(profile.id, 'mabinti');
  assert.equal(profile.name, 'Mabinti Mansaray');
  assert.equal(profile.title, 'Junior');
  assert.equal(profile.elo, 1550);
  assert.equal(profile.category, 'strong');
  assert.equal(opponentMeta(profile), 'Junior · 1550 Elo');
});

/* ---------------------------- 14. regressions ---------------------------- */

test('every other opponent and the General Bot are untouched', () => {
  assert.equal(PERSONALITY_OPPONENTS.length, 17);
  assert.equal(ALL_OPPONENTS.length, 18);
  const expected: Array<[string, string, string, number, string]> = [
    ['freshman', 'Johnfer Quispe', 'Freshman', 1250, 'beginners'],
    ['sophomore', 'Johnfer Quispe', 'Sophomore', 1450, 'intermediate'],
    ['nina', 'Nina Yang', 'Sophomore', 1550, 'strong'],
    ['bryan', 'Bryan Martinez-Hernandez', 'Junior', 1800, 'strong'],
    ['senior', 'Johnfer Quispe', 'Senior', 2000, 'strong'],
    ['brandon', 'Brandon Tran', 'Prime', 2350, 'big-3'],
    ['junior', 'Johnfer Quispe', 'Junior', 2150, 'big-3'],
    ['bryan-prime', 'Bryan Martinez-Hernandez', 'Prime', 2000, 'big-3'],
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
  assert.equal(GENERAL_BOT.kind, 'general');
  assert.equal(GENERAL_BOT.usesRepertoire, false);

  /* Tendency anchors elsewhere are exactly as they were. */
  assert.equal(PERSONALITY_STYLES['bryan-sophomore'].defensive, 95);
  assert.equal(PERSONALITY_STYLES.faadi.complexity, 85);
  assert.equal(PERSONALITY_STYLES.freshman.aggression, 25);
  assert.equal(PERSONALITY_STYLES.brandon.sacrifice, 95);
  assert.ok(
    Object.values(PERSONALITY_STYLES).every(
      (style) => typeof style.accuracy === 'number' && style.id !== undefined,
    ),
  );
});
