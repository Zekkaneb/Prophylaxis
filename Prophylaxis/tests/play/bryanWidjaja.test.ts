/**
 * Bryan Widjaja (Prime) — the Wall, 1400.
 *
 * Covers his catalogue entry and card identity, the defensive tendency table,
 * the guard that stops his deliberate slips from hanging material or walking
 * into mate, his 1400 strength dials (accuracy, gap and blunder curve), the
 * Queen's Gambit / Caro-Kann / King's Indian repertoire and its principle-based
 * layer, legal fallback outside the book, his voice and cadence, Normal Play and
 * Bot vs. Bot selection, saved-game/PGN identity, and the regressions that keep
 * every other opponent unchanged.
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
import { BRYAN_WIDJAJA_REPERTOIRE } from '../../src/play/personality/repertoires/bryanWidjaja.ts';
import { kidPlan } from '../../src/play/personality/repertoires/kid.ts';
import { bryanWidjajaAllowsMistake } from '../../src/play/personality/bryanWidjaja.ts';
import { chooseBotMove } from '../../src/play/personality/chooseMove.ts';
import {
  candidateGapForElo,
  choosePersonalityMove,
} from '../../src/play/personality/engine.ts';
import { computeThinkingPlan } from '../../src/play/personality/thinking.ts';
import { blunderChance } from '../../src/play/strength.ts';
import { buildPgn } from '../../src/play/pgn.ts';
import type { StockfishController } from '../../src/engine/useStockfish.ts';

const WIDJAJA = getOpponent('bryan-widjaja');
const STYLE = styleFor('bryan-widjaja', 1400) as PersonalityStyle;

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

/** Engine stub for the positions where he has to improvise. */
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

/* ------------------------ 1-4. identity and card ------------------------- */

test('Bryan Widjaja is on the roster as Prime, 1400, in the Intermediate group', () => {
  assert.ok(WIDJAJA);
  assert.equal(WIDJAJA.id, 'bryan-widjaja', 'his own stable id');
  assert.equal(WIDJAJA.kind, 'personality');
  assert.equal(WIDJAJA.name, 'Bryan Widjaja');
  assert.equal(WIDJAJA.title, 'Prime', 'the subtext is exactly Prime');
  assert.equal(WIDJAJA.elo, 1400);
  assert.equal(WIDJAJA.category, 'intermediate', 'Prime is identity, not category');
  assert.equal(WIDJAJA.initials, 'BW');
  assert.equal(WIDJAJA.usesRepertoire, false);

  /* Two display fields, never one combined name. */
  assert.doesNotMatch(WIDJAJA.name, /\(/, 'the name carries no parenthetical suffix');
  assert.doesNotMatch(WIDJAJA.name, /prime/i, 'the subtext lives in its own field');
  assert.equal(opponentStage(WIDJAJA), 'Prime');
  assert.equal(opponentMeta(WIDJAJA), 'Prime · 1400 Elo');
  assert.equal(opponentFullName(WIDJAJA), 'Bryan Widjaja (Prime)');
  assert.ok(WIDJAJA.style.length > 0);
});

test('his id is unique and never resolves to another Bryan', () => {
  assert.equal(
    PERSONALITY_OPPONENTS.filter((opponent) => opponent.id === 'bryan-widjaja').length,
    1,
  );
  assert.equal(new Set(ALL_OPPONENTS.map((opponent) => opponent.id)).size, ALL_OPPONENTS.length);
  assert.equal(getOpponent('bryan-widjaja'), WIDJAJA, 'the catalogue entry is the same object');

  /* Three Martinez-Hernandez profiles plus him: four distinct cards, four
     distinct stored labels. */
  const bryans = PERSONALITY_OPPONENTS.filter((opponent) => /^Bryan/.test(opponent.name));
  assert.equal(bryans.length, 4);
  assert.equal(new Set(bryans.map((opponent) => opponentFullName(opponent))).size, 4);
  for (const other of bryans) {
    if (other.id === 'bryan-widjaja') continue;
    assert.notEqual(opponentFullName(other), opponentFullName(WIDJAJA));
    assert.notEqual(other.title, undefined);
  }
  assert.equal(
    PERSONALITY_OPPONENTS.filter((opponent) => opponent.name === 'Bryan Widjaja').length,
    1,
  );
});

test('he sits in Intermediate at exactly 1400, beside the other defenders', () => {
  const intermediate = PERSONALITY_OPPONENTS.filter(
    (opponent) => opponent.category === 'intermediate',
  );
  assert.ok(intermediate.some((opponent) => opponent.id === 'bryan-widjaja'));
  assert.equal(getOpponent('sophomore')?.elo, 1450);
  assert.equal(getOpponent('bryan-sophomore')?.elo, 1350);
  /* The group is not rating-sorted, and his rating is his own. */
  assert.equal(WIDJAJA.elo, 1400);
  assert.equal(
    PERSONALITY_OPPONENTS.filter(
      (opponent) => opponent.elo === 1400 && opponent.id === 'bryan-widjaja',
    ).length,
    1,
    'his own rating is recorded once',
  );
  assert.equal(
    PERSONALITY_OPPONENTS.filter((opponent) => opponent.elo === 1400).length,
    2,
    'only the other declared 1400 shares his rating',
  );
});

test('his portrait is his own file, with the monogram kept as the fallback', () => {
  assert.equal(WIDJAJA.portraitPath, 'opponents/bryan-widjaja.webp');
  assert.equal(fs.existsSync('public/opponents/bryan-widjaja.webp'), true);
  for (const other of PERSONALITY_OPPONENTS) {
    if (other.id === 'bryan-widjaja') continue;
    assert.notEqual(other.portraitPath, WIDJAJA.portraitPath, `${other.id} keeps its own portrait`);
  }
});

/* --------------------------- 5-7. personality --------------------------- */

test('his tendency table is the Wall as specified', () => {
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
      aggression: 30,
      risk: 20,
      positional: 75,
      tactical: 35,
      defensive: 98,
      initiative: 40,
      simplification: 80,
      complexity: 25,
      kingSafety: 98,
      material: 90,
    },
  );
  assert.equal(STYLE.id, 'bryan-widjaja');
  assert.ok(STYLE.sacrifice <= 15, 'he does not hand over material on speculation');
  assert.ok((STYLE.openingBias.sharp ?? 0) < 0, 'he avoids unnecessary complications');
  assert.ok((STYLE.openingBias.solid ?? 0) > 0);
});

test('his defence is the strongest on the roster, and his tactics are not', () => {
  /* The claim in the brief: better defending than anyone else on the team. */
  for (const other of Object.values(PERSONALITY_STYLES)) {
    if (other.id === 'bryan-widjaja') continue;
    assert.ok(STYLE.defensive > other.defensive, `${other.id} defends better than the Wall`);
    assert.ok(STYLE.kingSafety >= other.kingSafety, `${other.id} watches its king more`);
  }
  assert.equal(STYLE.defensive, 98);
  assert.equal(STYLE.kingSafety, 98);

  /* Defensive 98 is a taste dial, not tactical accuracy: his tactical
     awareness sits below every other profile at his rating. */
  assert.equal(STYLE.tactical, 35);
  assert.ok(STYLE.tactical < PERSONALITY_STYLES.sophomore.tactical);
  assert.ok(STYLE.tactical < PERSONALITY_STYLES['bryan-sophomore'].defensive / 2);
});

test('1400 is the strength dial: the Wall does not play like a 2000', () => {
  assert.equal(STYLE.accuracy, accuracyForElo(1400));
  assert.ok(STYLE.accuracy < accuracyForElo(1800), 'no accuracy inflation');
  assert.equal(STYLE.depthCap, undefined, 'no artificial search ceiling');
  assert.equal(STYLE.mistakeChance, undefined, 'the rating curve decides his slips');
  assert.equal(candidateGapForElo(1400), 115);
  assert.equal(candidateGapForElo(1400), candidateGapForElo(1400));
  assert.ok(candidateGapForElo(1400) > candidateGapForElo(2000));

  /* Same strength dials whichever card he is compared with: his neighbour at
     1350 and the 1450 Sophomore keep their own. */
  assert.equal(styleFor('bryan-sophomore', 1350)?.accuracy, accuracyForElo(1350));
  assert.equal(styleFor('sophomore', 1450)?.accuracy, accuracyForElo(1450));

  assert.ok(blunderChance(1400) > 0, 'he still makes realistic tactical mistakes');
});

test('on equal moves he takes the safe one, and taste cannot outvote a clear best', () => {
  /* Italian Game: castle (safe) or throw the knight forward (loose). */
  const quietOrActive = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 6';
  const equal = choosePersonalityMove({
    fen: quietOrActive,
    candidates: [
      { uci: 'e1g1', scoreCp: 15, mate: null },
      { uci: 'f3g5', scoreCp: 15, mate: null },
    ],
    style: STYLE,
    elo: 1400,
    random: () => 0.9,
  });
  assert.equal(equal?.uci, 'e1g1');

  const clearlyBetter = choosePersonalityMove({
    fen: quietOrActive,
    candidates: [
      { uci: 'e1g1', scoreCp: 15, mate: null },
      { uci: 'f3g5', scoreCp: -120, mate: null },
    ],
    style: STYLE,
    elo: 1400,
    random: () => 0.9,
  });
  assert.equal(clearlyBetter?.uci, 'e1g1');
});

test('his defensive guard refuses self-inflicted material loss and mate in one', () => {
  /* Ng1-f3 steps next to the g4 pawn with nothing defending f3: a free piece. */
  const hang = '4k3/8/8/8/6p1/8/1P6/4K1N1 w - - 0 1';
  assert.equal(bryanWidjajaAllowsMistake(hang, 'g1f3', STYLE), false);
  assert.equal(bryanWidjajaAllowsMistake(hang, 'e1d1', STYLE), true);

  /* f2f3 walks into ...Qh4#: a direct mating threat is answered, not ignored. */
  const mate = 'rnbqkbnr/pppp1ppp/8/4p3/6P1/8/PPPPPP1P/RNBQKBNR w KQkq - 0 1';
  assert.equal(bryanWidjajaAllowsMistake(mate, 'f2f3', STYLE), false);
  assert.equal(bryanWidjajaAllowsMistake(mate, 'h2h3', STYLE), true);

  /* Per-character: another profile's mistake budget is untouched. */
  assert.equal(
    bryanWidjajaAllowsMistake(hang, 'g1f3', PERSONALITY_STYLES.faadi),
    true,
  );
  assert.equal(bryanWidjajaAllowsMistake(hang, 'g1f3', null), true);
});

/* ------------------------- 8-10. opening repertoire ---------------------- */

test('his White repertoire is the Queen’s Gambit and nothing deeper', () => {
  assert.ok(BRYAN_WIDJAJA_REPERTOIRE.asWhite.length >= 2);
  for (const line of BRYAN_WIDJAJA_REPERTOIRE.asWhite) {
    assert.equal(line.san[0], 'd4', `${line.id} starts 1.d4`);
    assert.ok(line.san.includes('c4'), `${line.id} is a Queen's Gambit`);
    assert.ok(line.san.length <= 18, `${line.id} stays a short, sound line`);
    assert.ok(line.id.startsWith('bryan-widjaja-'));
  }

  const start = new Chess();
  assert.deepEqual(
    legalBookMoves(personalityBookFor('bryan-widjaja', 'w'), start).map((move) => move.san),
    ['d4'],
  );
  assert.deepEqual(
    legalBookMoves(personalityBookFor('bryan-widjaja', 'w'), position('d4', 'd5')).map(
      (move) => move.san,
    ),
    ['c4'],
    'the gambit itself, offered from the book',
  );
  const declined = position('d4', 'd5', 'c4', 'e6');
  assert.ok(
    legalBookMoves(personalityBookFor('bryan-widjaja', 'w'), declined).some(
      (move) => move.san === 'Nc3',
    ),
    'normal development after 1...e6',
  );
});

test('as Black he answers 1.e4 with the Caro-Kann', () => {
  assert.deepEqual(
    legalBookMoves(personalityBookFor('bryan-widjaja', 'b'), position('e4')).map(
      (move) => move.san,
    ),
    ['c6'],
  );
  const bookAfter = (...san: string[]) =>
    legalBookMoves(personalityBookFor('bryan-widjaja', 'b'), position(...san)).map(
      (move) => move.san,
    );
  assert.ok(bookAfter('e4', 'c6', 'd4', 'd5', 'Nc3').includes('dxe4'), 'Classical');
  assert.ok(bookAfter('e4', 'c6', 'd4', 'd5', 'e5').includes('Bf5'), 'Advance');
  assert.ok(bookAfter('e4', 'c6', 'd4', 'd5', 'exd5').includes('cxd5'), 'Exchange');
  /* A non-Caro first move stays out of his book entirely. */
  assert.deepEqual(
    legalBookMoves(personalityBookFor('bryan-widjaja', 'b'), position('d4')).map(
      (move) => move.san,
    ),
    ['Nf6'],
    '1.d4 gets the King’s Indian knight, not a Caro-Kann pawn',
  );
});

test('against 1.d4 he builds the King’s Indian setup as a principle', () => {
  assert.deepEqual(
    legalBookMoves(personalityBookFor('bryan-widjaja', 'b'), position('d4')).map(
      (move) => move.san,
    ),
    ['Nf6'],
  );
  assert.deepEqual(
    legalBookMoves(personalityBookFor('bryan-widjaja', 'b'), position('d4', 'Nf6', 'c4')).map(
      (move) => move.san,
    ),
    ['g6'],
  );

  /* The plan starts with ...Nf6, then the fianchetto, and only commits once the
     structure is built. */
  const start = kidPlan(position('d4').fen(), ['d4'], STYLE);
  assert.ok(start);
  assert.equal(start.moves[0]?.uci, 'g8f6');

  const built = position(
    'd4',
    'Nf6',
    'c4',
    'g6',
    'Nc3',
    'Bg7',
    'e4',
    'd6',
    'Nf3',
    'O-O',
    'Be2',
  );
  const plan = kidPlan(
    built.fen(),
    ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3', 'O-O', 'Be2'],
    STYLE,
  );
  assert.ok(plan);
  assert.equal(plan.setupComplete, true);
  assert.equal(plan.breakPlan, 'e5', 'White’s e4 centre asks for ...e5');
  assert.equal(plan.moves[0]?.uci, 'e7e5');

  /* It is a preference, never a script: after 1.e4 a King’s Indian is wrong, so
     the layer declines and ordinary selection takes over. */
  assert.equal(kidPlan(position('e4').fen(), ['e4'], STYLE), null);
});

test('his book compiles, stays legal, and borrows nothing from another opponent', () => {
  assert.deepEqual(repertoireIssues().filter((entry) => entry.issues.length > 0), []);
  assert.ok(repertoireIssues().some((entry) => entry.id === 'bryan-widjaja'));

  for (const color of ['w', 'b'] as const) {
    const entries = [...personalityBooks('bryan-widjaja')[color].book.entries()];
    assert.ok(entries.length > 0);
    for (const [key, moves] of entries) {
      assert.equal(key.split(' ')[1], color, `${color} book only holds ${color} turns`);
      const fen = `${key} - 0 1`;
      for (const entry of moves) {
        assertLegal(fen, entry.uci);
        assert.ok(entry.lineIds.every((id) => id.startsWith('bryan-widjaja-')));
      }
    }
  }

  const foreignIds = new Set(
    Object.entries(PERSONALITY_REPERTOIRES)
      .filter(([id]) => id !== 'bryan-widjaja')
      .flatMap(([, repertoire]) =>
        [...repertoire.asWhite, ...repertoire.asBlack].map((line) => line.id),
      ),
  );
  const ids = [...BRYAN_WIDJAJA_REPERTOIRE.asWhite, ...BRYAN_WIDJAJA_REPERTOIRE.asBlack].map(
    (line) => line.id,
  );
  assert.equal(new Set(ids).size, ids.length, 'unique line ids');
  for (const id of ids) assert.equal(foreignIds.has(id), false, `${id} is not another character's line`);

  /* His lines are his own objects, not references into another repertoire. */
  const foreignLines = Object.entries(PERSONALITY_REPERTOIRES)
    .filter(([id]) => id !== 'bryan-widjaja')
    .flatMap(([, repertoire]) => [...repertoire.asWhite, ...repertoire.asBlack]);
  for (const line of [...BRYAN_WIDJAJA_REPERTOIRE.asWhite, ...BRYAN_WIDJAJA_REPERTOIRE.asBlack]) {
    assert.equal(foreignLines.includes(line), false, `${line.id} is a line of his own`);
  }
});

/* --------------------------- 11. legal fallback -------------------------- */

test('outside his repertoire he improvises legally, never an illegal lookup', async () => {
  /* 1.e4 as White is not his opening: nothing in the book. */
  const openGame = position('e4', 'e5', 'Nf3', 'Nc6');
  assert.deepEqual(legalBookMoves(personalityBookFor('bryan-widjaja', 'w'), openGame), []);

  const chosen = await chooseBotMove({
    game: openGame,
    fen: openGame.fen(),
    history: ['e4', 'e5', 'Nf3', 'Nc6'],
    botColor: 'w',
    style: STYLE,
    elo: 1400,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: engineWith([
      { uci: 'f1b5', scoreCp: 30 },
      { uci: 'f1c4', scoreCp: 22 },
      { uci: 'd2d4', scoreCp: 18 },
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
    legalBookMoves(personalityBookFor('bryan-widjaja', 'w'), position('e4')).map(
      (move) => move.san,
    ),
    [],
    'his Caro-Kann answers do not become White moves',
  );
  assert.deepEqual(
    legalBookMoves(
      personalityBookFor('bryan-widjaja', 'b'),
      position('d4', 'Nf6', 'c4', 'g6', 'Nc3'),
    ).map((move) => move.san),
    ['Bg7'],
    'a Black turn is answered from the Black book',
  );
});

/* ---------------------------- 12. dialogue ------------------------------ */

test('his voice is reserved, chill and free of exaggerated slang', () => {
  const bank = DIALOGUE_BANKS['bryan-widjaja'];
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
    }
  }

  const spoken = Object.values(bank).flat().join(' | ');
  for (const line of [
    'Do I got this?',
    'Alright, let’s see.',
    'We good.',
    'Ah, I ain’t see that.',
    'Nah, there’s a way out.',
    'Alr, that’s game.',
    'Good game.',
  ]) {
    assert.ok(spoken.includes(line), `missing his voice: ${line}`);
  }

  /* He is not a catchphrase machine: no line is shouted, and the bank never
     reads like another character's register. */
  const all = Object.values(bank).flat();
  assert.equal(all.filter((line) => line.includes('!')).length, 0, 'no shouting');
  const mine = all.join(' ').toLowerCase();
  for (const phrase of ['chat', 'walahi', 'right guys', 'light work', 'cooking', 'lowkey']) {
    assert.equal(mine.includes(phrase), false, `no borrowed slang: ${phrase}`);
  }
  assert.notEqual(bank, DIALOGUE_BANKS.faadi);
  assert.notEqual(bank, DIALOGUE_BANKS.bryan);
  assert.ok(bank.loss.length >= 3);
  assert.ok(bank.defense.length >= 3);
});

test('his lines respect the quiet gap, the repeat gap and never repeat a line', () => {
  const state = createDialogueState();
  assert.ok(maybeReact('bryan-widjaja', 'strong', { ply: 20, state, random: () => 0 }));

  /* Inside his eight-ply gap he stays quiet. */
  assert.equal(maybeReact('bryan-widjaja', 'strong', { ply: 23, state, random: () => 0 }), null);
  assert.equal(maybeReact('bryan-widjaja', 'defense', { ply: 26, state, random: () => 0 }), null);
  /* Past the gap a different event may speak. */
  assert.ok(maybeReact('bryan-widjaja', 'defense', { ply: 28, state, random: () => 0 }));
  /* The same event waits for the longer repeat gap. */
  assert.equal(maybeReact('bryan-widjaja', 'strong', { ply: 30, state, random: () => 0 }), null);
  assert.ok(maybeReact('bryan-widjaja', 'strong', { ply: 38, state, random: () => 0 }));

  /* A used line is not chosen again while the bank lasts. */
  const fresh = createDialogueState();
  const seen = new Set<string>();
  let ply = 40;
  while (seen.size < DIALOGUE_BANKS['bryan-widjaja'].strong.length) {
    ply += 20;
    const line = maybeReact('bryan-widjaja', 'strong', { ply, state: fresh, random: () => 0.99 });
    assert.ok(line);
    assert.equal(seen.has(line.text), false, 'a line is not repeated until the bank runs out');
    seen.add(line.text);
  }

  /* A game ending always gets a line, whatever the clock of the conversation. */
  const closing = createDialogueState();
  const loss = maybeReact('bryan-widjaja', 'loss', {
    ply: 2,
    state: closing,
    force: true,
    random: () => 0,
  });
  assert.ok(loss);
  assert.ok(DIALOGUE_BANKS['bryan-widjaja'].loss.includes(loss.text));
});

test('his dialogue never decides a move: the same position picks the same move', () => {
  const fen = position('d4', 'Nf6', 'c4', 'g6').fen();
  const candidates = [
    { uci: 'b1c3', scoreCp: 25, mate: null },
    { uci: 'g1f3', scoreCp: 20, mate: null },
    { uci: 'c1g5', scoreCp: 18, mate: null },
  ];
  const one = choosePersonalityMove({ fen, candidates, style: STYLE, elo: 1400, random: () => 0.3 });
  const two = choosePersonalityMove({ fen, candidates, style: STYLE, elo: 1400, random: () => 0.3 });
  assert.equal(one?.uci, two?.uci);
  assert.ok(candidates.some((candidate) => candidate.uci === one?.uci));
});

/* --------------------- 13-14. Normal Play and Bot vs. Bot ---------------- */

test('Normal Play: his first move comes from the book with no search at all', async () => {
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

test('he can play both colours, and Bot vs. Bot drives the same selection', async () => {
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
  assert.equal(asBlack?.uci, 'c7c6');

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
  assert.equal(vsD4?.uci, 'g8f6');
});

test('he thinks for an ordinary, unhurried beat in every phase', () => {
  for (const fen of [
    new Chess().fen(),
    position('d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7').fen(),
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

/* ------------------------ 15. history and PGN identity ------------------- */

test('a saved game and its PGN keep his name, subtext, colour and rating', () => {
  const pgn = buildPgn(
    {
      white: opponentFullName(getOpponent('brandon')!),
      black: opponentFullName(WIDJAJA),
      result: '0-1',
      date: Date.UTC(2026, 10, 21),
      timeControl: '300+0',
      whiteElo: getOpponent('brandon')!.elo,
      blackElo: WIDJAJA.elo,
      event: 'Bot vs. Bot',
    },
    ['d4', 'Nf6', 'c4', 'g6'],
  );
  assert.match(pgn, /\[Black "Bryan Widjaja \(Prime\)"\]/);
  assert.match(pgn, /\[BlackElo "1400"\]/);

  const profile = profileFromRecord({
    opponent_id: WIDJAJA.id,
    opponent_name: opponentFullName(WIDJAJA),
    opponent_elo: WIDJAJA.elo,
    opponent_kind: WIDJAJA.kind,
  });
  assert.equal(profile.id, 'bryan-widjaja');
  assert.equal(profile.name, 'Bryan Widjaja');
  assert.equal(profile.title, 'Prime');
  assert.equal(profile.elo, 1400);
  assert.equal(profile.category, 'intermediate');
  assert.equal(opponentMeta(profile), 'Prime · 1400 Elo');
});

/* ---------------------------- 16. regressions ---------------------------- */

test('every other opponent and the General Bot are untouched', () => {
  assert.equal(PERSONALITY_OPPONENTS.length, 19);
  assert.equal(ALL_OPPONENTS.length, 20);
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
  ];
  for (const [id, name, title, elo, category] of expected) {
    const opponent = getOpponent(id);
    assert.ok(opponent, `${id} is still on the roster`);
    assert.equal(opponent.name, name);
    assert.equal(opponent.title, title);
    assert.equal(opponent.elo, elo);
    assert.equal(opponent.category, category);
    assert.notEqual(opponent.id, WIDJAJA.id);
  }
  assert.equal(GENERAL_BOT.id, 'general');
  assert.equal(GENERAL_BOT.kind, 'general');
  assert.equal(GENERAL_BOT.elo, 1500);
  assert.equal(GENERAL_BOT.usesRepertoire, false);

  /* Tendency anchors elsewhere are exactly as they were before he was added. */
  assert.equal(PERSONALITY_STYLES['bryan-sophomore'].defensive, 95);
  assert.equal(PERSONALITY_STYLES.junior.defensive, 95);
  assert.equal(PERSONALITY_STYLES.mabinti.defensive, 65);
  assert.equal(PERSONALITY_STYLES.faadi.complexity, 85);
  assert.equal(PERSONALITY_STYLES.edward.tactical, 20);
  assert.equal(PERSONALITY_STYLES.sophomore.tactical, 65);

  /* The other defenders' books are untouched by his registration. */
  assert.equal(personalityBookFor('bryan-sophomore', 'b').size > 0, true);
  assert.equal(personalityBookFor('bryan-prime', 'w').size > 0, true);
  assert.equal(personalityBookFor('edward', 'b').size > 0, true);
  assert.ok(Object.values(PERSONALITY_STYLES).filter((style) => style.defensive === 95).length >= 2);
});
