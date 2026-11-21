/**
 * Faadi Granillo Garcia — the wildcard.
 *
 * Covers his catalogue entry, his English / Caro-Kann / Slav repertoire, the
 * opening-memory curve that lets him forget a line without blundering, the
 * mistake guard that keeps obvious hangs off the board, his tendency profile,
 * his dialogue bank and its cadence, and the regression guarantees for the
 * other eight opponents.
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
} from '../../src/play/opponents.ts';
import { blunderChance } from '../../src/play/strength.ts';
import {
  DIALOGUE_BANKS,
  DIALOGUE_TIMING,
  createDialogueState,
  maybeReact,
} from '../../src/play/personality/dialogue.ts';
import { chooseBookMove } from '../../src/play/personality/engine.ts';
import {
  chooseFaadiBookMove,
  faadiAllowsMistake,
  faadiForgetChance,
} from '../../src/play/personality/faadi.ts';
import {
  PERSONALITY_REPERTOIRES,
  personalityBookFor,
  personalityBooks,
  repertoireIssues,
} from '../../src/play/personality/repertoires/index.ts';
import {
  booksForRepertoire,
  legalBookMoves,
  type BookMove,
} from '../../src/play/personality/repertoires/book.ts';
import { PERSONALITY_STYLES, accuracyForElo, styleFor } from '../../src/play/personality/styles.ts';
import { computeThinkingPlan } from '../../src/play/personality/thinking.ts';

const FAADI = getOpponent('faadi');
const STYLE = styleFor('faadi', 1100);
const REPERTOIRE = PERSONALITY_REPERTOIRES.faadi;

/** Small deterministic PRNG so forgetting rates are reproducible. */
function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

/* ------------------------------- registration ------------------------------ */

test('Faadi is registered once, in the Beginner band, with his own id', () => {
  assert.ok(FAADI, 'the catalogue knows him');
  assert.equal(FAADI.id, 'faadi');
  assert.equal(FAADI.kind, 'personality');
  assert.equal(FAADI.name, 'Faadi Granillo Garcia');
  assert.equal(FAADI.title, 'Prime');
  assert.equal(opponentStage(FAADI), 'Prime', 'the card prints the subtext on its own line');
  assert.equal(FAADI.elo, 700);
  assert.equal(FAADI.category, 'beginner');
  assert.equal(FAADI.portraitPath, 'opponents/faadi.webp');
  assert.ok(fs.existsSync('public/opponents/faadi.webp'), 'the supplied portrait is installed');
  assert.equal(FAADI.initials, 'FG', 'monogram fallback if the portrait file is missing');
  assert.equal(FAADI.usesRepertoire, false, 'his own book, not the user’s courses');
  assert.match(FAADI.style, /wildcard/i);

  assert.equal(opponentFullName(FAADI), 'Faadi Granillo Garcia (Prime)');
  assert.equal(opponentMeta(FAADI), 'Prime · 700 Elo');

  assert.equal(PERSONALITY_OPPONENTS.filter((opponent) => opponent.id === 'faadi').length, 1);
  assert.equal(
    PERSONALITY_OPPONENTS.filter(
      (opponent) => opponentFullName(opponent) === 'Faadi Granillo Garcia (Prime)',
    ).length,
    1,
    'no other opponent shares his stored-game label',
  );
  assert.equal(
    PERSONALITY_OPPONENTS.filter((opponent) => opponent.category === 'beginner')
      .map((opponent) => opponent.id)
      .includes('faadi'),
    true,
    'New Game and Bot vs. Bot both read this list',
  );
  assert.equal(PERSONALITY_OPPONENTS.length, 21);
  assert.equal(ALL_OPPONENTS.length, 22);
  assert.equal(new Set(ALL_OPPONENTS.map((opponent) => opponent.id)).size, ALL_OPPONENTS.length);
});

test('his tendencies are the agreed wildcard profile', () => {
  assert.ok(STYLE);
  assert.deepEqual(
    [
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
    ],
    [70, 75, 35, 45, 35, 75, 35, 85, 45, 40],
  );
  assert.equal(STYLE.accuracy, accuracyForElo(1100), 'accuracy is the rating dial');

  /* Below 1300 the accuracy table is one tier, so the ladder difference is the
     mistake rate: more deliberate errors than Freshman, still inside beginner
     territory rather than a throw-moves bot. */
  const freshman = styleFor('freshman', 1250);
  assert.ok(freshman);
  assert.ok(STYLE.accuracy <= freshman.accuracy);
  assert.ok(blunderChance(1100) > blunderChance(1250));
  assert.ok(blunderChance(1100) > 0.15 && blunderChance(1100) < 0.25);
});

/* -------------------------------- repertoire ------------------------------- */

test('English as White, Caro-Kann against 1.e4, Slav against 1.d4', () => {
  assert.ok(REPERTOIRE, 'the declared repertoire is registered under his id');
  assert.ok(REPERTOIRE.asWhite.length >= 3);
  assert.ok(REPERTOIRE.asBlack.length >= 3);

  for (const line of REPERTOIRE.asWhite) {
    assert.equal(line.san[0], 'c4', `${line.id} is an English Opening`);
    assert.ok(line.id.startsWith('faadi-english-'), `${line.id} is labelled as his English`);
  }

  const caro = REPERTOIRE.asBlack.filter((line) => line.san[0] === 'e4' && line.san[1] === 'c6');
  const slav = REPERTOIRE.asBlack.filter(
    (line) =>
      line.san[0] === 'd4' &&
      line.san[1] === 'd5' &&
      line.san[2] === 'c4' &&
      line.san[3] === 'c6',
  );
  assert.ok(caro.length >= 2, 'Caro-Kann lines exist');
  assert.ok(slav.length >= 2, 'Slav lines exist');
  assert.ok(caro.every((line) => line.id.startsWith('faadi-caro-')));
  assert.ok(slav.every((line) => line.id.startsWith('faadi-slav-')));

  /* Every declaration replays cleanly through the shared book builder. */
  const issues = repertoireIssues().find((entry) => entry.id === 'faadi');
  assert.deepEqual(issues?.issues, []);
});

test('the book answers the first moves with his own openings', () => {
  const white = legalBookMoves(personalityBookFor('faadi', 'w'), new Chess());
  assert.deepEqual(white.map((move) => move.san), ['c4']);

  const afterE4 = new Chess();
  afterE4.move('e4');
  assert.deepEqual(
    legalBookMoves(personalityBookFor('faadi', 'b'), afterE4).map((move) => move.san),
    ['c6'],
    '1.e4 meets the Caro-Kann',
  );

  const afterD4 = new Chess();
  afterD4.move('d4');
  assert.deepEqual(
    legalBookMoves(personalityBookFor('faadi', 'b'), afterD4).map((move) => move.san),
    ['d5'],
    '1.d4 meets the Slav',
  );

  const afterC4 = new Chess();
  afterC4.move('c4');
  assert.equal(
    legalBookMoves(personalityBookFor('faadi', 'b'), afterC4).length,
    0,
    'no preference against 1.c4 — he falls through to his own play',
  );
});

test('no line, id or book is borrowed from another opponent', () => {
  const ids = [...REPERTOIRE.asWhite, ...REPERTOIRE.asBlack].map((line) => line.id);
  assert.equal(new Set(ids).size, ids.length);

  const otherSan = new Set(
    Object.entries(PERSONALITY_REPERTOIRES)
      .filter(([id]) => id !== 'faadi')
      .flatMap(([, repertoire]) =>
        [...repertoire.asWhite, ...repertoire.asBlack].map((line) => line.san.join(' ')),
      ),
  );
  for (const line of [...REPERTOIRE.asWhite, ...REPERTOIRE.asBlack]) {
    assert.equal(otherSan.has(line.san.join(' ')), false, `${line.id} is not copied`);
  }

  for (const id of [
    'freshman',
    'sophomore',
    'junior',
    'senior',
    'brandon',
    'nina',
    'bryan',
    'bryan-prime',
  ] as const) {
    const books = personalityBooks(id);
    const entries = [
      ...[...books.w.book.values()].flat(),
      ...[...books.b.book.values()].flat(),
    ];
    assert.equal(
      entries.some((move) => move.lineIds.some((lineId) => lineId.startsWith('faadi-'))),
      false,
      `${id} still only uses its own opening knowledge`,
    );
  }
  assert.notEqual(personalityBooks('faadi').b.book, personalityBooks('nina').b.book);
});

test('he can follow his book as either colour, and every move is legal', () => {
  assert.ok(STYLE);
  for (const color of ['w', 'b'] as const) {
    const books = booksForRepertoire(REPERTOIRE)[color];
    assert.deepEqual(books.issues, [], `${color} book compiles`);
    assert.ok(books.book.size > 0);

    const lines = color === 'w' ? REPERTOIRE.asWhite : REPERTOIRE.asBlack;
    let checked = 0;
    for (const line of lines) {
      const game = new Chess();
      for (const san of line.san) {
        if (game.turn() === color) {
          const moves = legalBookMoves(books.book, game);
          assert.ok(
            moves.some((entry) => entry.san === san),
            `${line.id}: ${san} is in the ${color} book`,
          );
          assert.ok(game.moves().includes(san), `${line.id}: ${san} is legal`);
          assert.ok(chooseBookMove(moves, STYLE, () => 0));
          checked += 1;
        }
        game.move(san);
      }
    }
    assert.ok(checked >= 10, `${color} book replays its lines (${checked} moves)`);
  }
});

/* ---------------------------- opening improvisation ------------------------ */

test('forgetting is depth- and familiarity-dependent, and never a forfeit', () => {
  assert.ok(STYLE);
  const main: BookMove = {
    uci: 'c2c4',
    san: 'c4',
    lineIds: ['faadi-english-symmetrical'],
    tags: [],
    weight: 3,
  };
  const offshoot: BookMove = {
    uci: 'c2c4',
    san: 'c4',
    lineIds: ['faadi-english-symmetrical-b3'],
    tags: [],
    weight: 1,
  };

  assert.ok(faadiForgetChance(main, 4) < faadiForgetChance(main, 12), 'recall fades with depth');
  assert.ok(faadiForgetChance(offshoot, 8) > faadiForgetChance(main, 8), 'branches are hazier');
  assert.ok(faadiForgetChance(main, 0) >= 0);
  assert.ok(faadiForgetChance(main, 200) <= 0.3, 'never a certainty');

  const moves = legalBookMoves(personalityBookFor('faadi', 'w'), new Chess());
  const forgetful = chooseFaadiBookMove({ moves, style: STYLE, ply: 40, random: () => 0 });
  assert.deepEqual(forgetful, { move: null, forgotten: true }, 'the roll can lose the line');
  const remembered = chooseFaadiBookMove({ moves, style: STYLE, ply: 0, random: () => 0.99 });
  assert.equal(remembered.forgotten, false);
  assert.equal(remembered.move?.san, 'c4');
  assert.deepEqual(
    chooseFaadiBookMove({ moves: [], style: STYLE, ply: 8, random: () => 0 }),
    { move: null, forgotten: false },
    'out of book already: nothing to forget',
  );

  /* Aggregate behaviour: he leaves the book sometimes, not every game, and the
     main lines survive more often than the offshoots. */
  const rate = (move: BookMove, ply: number) => {
    const random = seeded(1100 + ply);
    let forgotten = 0;
    for (let trial = 0; trial < 400; trial += 1) {
      if (chooseFaadiBookMove({ moves: [move], style: STYLE, ply, random }).forgotten) {
        forgotten += 1;
      }
    }
    return forgotten / 400;
  };
  const earlyMain = rate(main, 6);
  assert.ok(earlyMain > 0 && earlyMain < 0.25, `early main-line recall is imperfect but solid (${earlyMain})`);
  assert.ok(rate(offshoot, 14) > rate(main, 14), 'deeper offshoots are forgotten more');
});

test('a forgotten continuation still leaves him a legal, ordinary move', () => {
  assert.ok(STYLE);
  const game = new Chess();
  game.move('c4');
  game.move('c5');
  const moves = legalBookMoves(personalityBookFor('faadi', 'w'), game);
  assert.ok(moves.length > 0);
  const choice = chooseFaadiBookMove({ moves, style: STYLE, ply: 6, random: () => 0 });
  assert.equal(choice.forgotten, true);

  /* The caller's normal path is the engine/personality selection: whatever it
     returns must be a legal move in this position. */
  const legal = new Set(game.moves({ verbose: true }).map((move) => move.san));
  const fallback = chooseBookMove(
    legalBookMoves(personalityBookFor('faadi', 'w'), game),
    STYLE,
    seeded(7),
  );
  assert.ok(fallback);
  assert.ok(legal.has(fallback.san));
});

/* ------------------------------- mistake guard ----------------------------- */

test('his deliberate mistakes are ideas he missed, not a queen left hanging', () => {
  assert.ok(STYLE);
  /* White queen can swing to h5, where a g6 pawn simply takes it. */
  const looseQueen = '4k3/8/6p1/8/8/8/8/3QK3 w - - 0 1';
  assert.equal(faadiAllowsMistake(looseQueen, 'd1h5', STYLE), false, 'a free queen is not an error');
  assert.equal(faadiAllowsMistake(looseQueen, 'd1d2', STYLE), true, 'quiet slips are allowed');

  /* Every other character keeps the unchanged behaviour. */
  assert.equal(faadiAllowsMistake(looseQueen, 'd1h5', PERSONALITY_STYLES.senior), true);
  assert.equal(faadiAllowsMistake(looseQueen, 'd1h5', PERSONALITY_STYLES.freshman), true);
  assert.equal(faadiAllowsMistake(looseQueen, 'd1h5', null), true);
});

test('his thinking fits the shared adaptive planner in both colours', () => {
  assert.ok(STYLE);
  const caro = new Chess();
  caro.move('e4');
  caro.move('c6');
  caro.move('d4');
  caro.move('d5');
  for (const fen of [new Chess().fen(), caro.fen()]) {
    const plan = computeThinkingPlan({
      fen,
      style: STYLE,
      clockMs: 300_000,
      incrementMs: 2_000,
      initialMs: 300_000,
      ply: 6,
      bookMove: false,
    });
    assert.ok(plan.searchMs > 0, 'a real search, not a fixed low depth');
    assert.ok(plan.budgetMs >= plan.searchMs + plan.pauseMs);
    assert.ok(plan.deliberationMs <= plan.budgetMs);
  }
  const bookPlan = computeThinkingPlan({
    fen: new Chess().fen(),
    style: STYLE,
    clockMs: 300_000,
    incrementMs: 2_000,
    initialMs: 300_000,
    ply: 0,
    bookMove: true,
  });
  assert.equal(bookPlan.searchMs, 0);
});

/* --------------------------------- dialogue -------------------------------- */

test('his dialogue bank covers every event, keeps the signature lines and stays clean', () => {
  const bank = DIALOGUE_BANKS.faadi;
  const events = Object.keys(bank) as Array<keyof typeof bank>;
  assert.equal(events.length, 16);

  for (const event of events) {
    assert.ok(bank[event].length >= 2, `${event} has a pool to draw from`);
    for (const line of bank[event]) {
      assert.ok(line.length <= 100, `${line} is a chat message, not a paragraph`);
      assert.doesNotMatch(line, /\d/, 'no numbers');
      assert.doesNotMatch(line, /eval|depth|engine|stockfish|centipawn|score/i, 'no engine talk');
    }
  }

  const all = events.flatMap((event) => bank[event]);
  for (const signature of [
    'We can still win, trust me bro.',
    'Lowkey not cooking chat.',
    'Me no cooking.',
    'Oh shittings chat.',
    'Nah, we’re so back.',
    'It’s fine, it’s fine. We got this.',
    'Chat, that was calculated.',
    'I meant to do that, trust.',
    'BRO, NO WAY.',
    'Vamos, todavía podemos ganar.',
    'We’re actually chilling.',
    'Nah chat, we’re actually cooking.',
    'Wait, wait, wait... hear me out.',
    'Bro, what is this position?',
    'Chat, I might be finished.',
    'No way that actually worked.',
  ]) {
    assert.ok(all.includes(signature), `${signature} is in his bank`);
  }
});

test('the comeback, mistake and forgotten-line voices come from real events', () => {
  const comeback = maybeReact('faadi', 'losing', {
    state: createDialogueState(),
    ply: 20,
    random: () => 0,
  });
  assert.ok(comeback);
  assert.match(comeback.text, /win|back|fine|ganar|finished/i);

  const mistake = maybeReact('faadi', 'mistake', {
    state: createDialogueState(),
    ply: 12,
    random: () => 0,
  });
  assert.equal(mistake?.text, 'Me no cooking.');

  const forgotten = maybeReact('faadi', 'deviation', {
    state: createDialogueState(),
    ply: 8,
    random: () => 0,
  });
  assert.equal(forgotten?.text, 'Wait, what was I supposed to play?');
});

test('cooldowns, once-per-game events and anti-repetition all still apply', () => {
  const state = createDialogueState();
  const first = maybeReact('faadi', 'losing', { state, ply: 20, random: () => 0 });
  assert.ok(first);
  assert.equal(
    maybeReact('faadi', 'losing', { state, ply: 40, random: () => 0.9 }),
    null,
    'losing speaks once per game',
  );

  const mistakes = createDialogueState();
  assert.ok(maybeReact('faadi', 'mistake', { state: mistakes, ply: 12, random: () => 0 }));
  assert.equal(
    maybeReact('faadi', 'mistake', { state: mistakes, ply: 16, random: () => 0.4 }),
    null,
    'the same event waits out its repeat gap',
  );

  const later = maybeReact('faadi', 'mistake', { state: mistakes, ply: 26, random: () => 0.4 });
  assert.ok(later);
  assert.notEqual(later.text, 'Me no cooking.', 'a used line is not repeated straight away');

  const ordinary = createDialogueState();
  assert.ok(maybeReact('faadi', 'strong', { state: ordinary, ply: 10, random: () => 0 }));
  assert.equal(
    maybeReact('faadi', 'attack', { state: ordinary, ply: 11, random: () => 0 }),
    null,
    'the quiet gap still holds between different remarks',
  );
});

test('he speaks more often than a reserved opponent, without changing the game', () => {
  const chatty = createDialogueState();
  assert.ok(maybeReact('faadi', 'strong', { state: chatty, ply: 0, random: () => 0 }));
  assert.ok(
          maybeReact('faadi', 'attack', { state: chatty, ply: DIALOGUE_TIMING.ordinaryGap - 1, random: () => 0 }),
    'his cadence is shorter than the default gap',
  );

  const reserved = createDialogueState();
  assert.ok(maybeReact('freshman', 'strong', { state: reserved, ply: 0, random: () => 0 }));
  assert.equal(
    maybeReact('freshman', 'attack', {
      state: reserved,
      ply: DIALOGUE_TIMING.ordinaryGap - 1,
      random: () => 0,
    }),
    null,
    'everyone else keeps the default gap',
  );

  /* Dialogue is presentation only: it cannot touch the position. */
  const game = new Chess();
  const before = game.fen();
  const line = maybeReact('faadi', 'brilliant', {
    state: createDialogueState(),
    ply: 30,
    random: () => 0,
  });
  assert.ok(line);
  assert.equal(game.fen(), before);
});
