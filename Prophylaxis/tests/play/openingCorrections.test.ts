/**
 * Post-audit opening corrections (21 November).
 *
 * Four behaviours are pinned here:
 *
 * 1. The King's Indian plan needs White's c/d centre on the board, not merely
 *    an `Nf3` or `g3` first move, while real transpositions still work.
 * 2. Play and Watch Bots share one theory window (`src/play/theory.ts`), so the
 *    same bot at the same rating is eligible for the same opening knowledge in
 *    both modes — and no principle layer can outlive it.
 * 3. Chapters compiled from a mid-line FEN carry the depth they started at and
 *    cannot answer a shallower game.
 * 4. The book key includes en passant exactly when it changes the legal moves,
 *    so an entry requiring an en passant capture can never match a board where
 *    that capture does not exist — and no such entry is dead.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { Chess } from 'chess.js';
import type { StockfishController } from '../../src/engine/useStockfish.ts';
import { chooseBotMove } from '../../src/play/personality/chooseMove.ts';
import { ninaPlan } from '../../src/play/personality/nina.ts';
import { styleFor, PERSONALITY_STYLES } from '../../src/play/personality/styles.ts';
import {
  capturableEnPassant,
  bookKey,
  legalBookMoves,
  type PersonalityBook,
} from '../../src/play/personality/repertoires/book.ts';
import { isKidOpening, kidPlan } from '../../src/play/personality/repertoires/kid.ts';
import { BRANDON_BOOK } from '../../src/play/personality/repertoires/brandonBook.ts';
import { NINA_BOOK } from '../../src/play/personality/repertoires/ninaBook.ts';
import { PERSONALITY_REPERTOIRES } from '../../src/play/personality/repertoires/index.ts';
import { bookPlyLimit, theoryOpen, theoryWindow } from '../../src/play/theory.ts';

const SOPHOMORE = PERSONALITY_STYLES.sophomore;
const JUNIOR = PERSONALITY_STYLES.junior;
const KID_STYLES = [
  SOPHOMORE,
  JUNIOR,
  PERSONALITY_STYLES.bryan,
  PERSONALITY_STYLES['bryan-prime'],
  PERSONALITY_STYLES['bryan-sophomore'],
  PERSONALITY_STYLES['bryan-widjaja'],
  PERSONALITY_STYLES['alex-tang'],
];

function position(...sans: string[]): { fen: string; history: string[] } {
  const game = new Chess();
  for (const san of sans) game.move(san);
  return { fen: game.fen(), history: sans };
}

/* ------------------------------ 1. KID centre ----------------------------- */

test('1.Nf3 and 1.g3 are not King’s Indian evidence on their own', () => {
  const nf3h4 = position('Nf3', 'Nf6', 'h4');
  const g3h4 = position('g3', 'e6', 'h4');

  for (const style of KID_STYLES) {
    assert.equal(
      kidPlan(nf3h4.fen, nf3h4.history, style, 'b'),
      null,
      `${style.id}: no KID shell after 1.Nf3 Nf6 2.h4`,
    );
    assert.equal(
      kidPlan(g3h4.fen, g3h4.history, style, 'b'),
      null,
      `${style.id}: no KID shell after 1.g3 e6 2.h4`,
    );
  }

  assert.equal(isKidOpening(nf3h4.fen, nf3h4.history), false);
  assert.equal(isKidOpening(g3h4.fen, g3h4.history), false);
});

test('legitimate King’s Indian setups are still recognised', () => {
  const afterNc3 = position('d4', 'Nf6', 'c4', 'g6', 'Nc3');
  const afterNf3 = position('d4', 'Nf6', 'c4', 'g6', 'Nf3');

  for (const setup of [afterNc3, afterNf3]) {
    assert.equal(isKidOpening(setup.fen, setup.history), true);
    const plan = kidPlan(setup.fen, setup.history, JUNIOR, 'b');
    assert.ok(plan, `Junior still plans after ${setup.history.join(' ')}`);
    assert.ok(plan.moves.length > 0, 'the plan still names the setup moves');
  }
});

test('a genuine transposition keeps the plan, a missing centre does not', () => {
  /* 1.Nf3 with ...d4/...c4 to follow is a real King's Indian move order. */
  const transposed = position('Nf3', 'Nf6', 'c4', 'g6', 'd4');
  assert.equal(isKidOpening(transposed.fen, transposed.history), true);
  assert.ok(kidPlan(transposed.fen, transposed.history, JUNIOR, 'b'));

  /* 1.g3 followed by the centre is equally real. */
  const english = position('g3', 'Nf6', 'c4', 'g6', 'd4');
  assert.equal(isKidOpening(english.fen, english.history), true);

  /* The same board with White's c- and d-pawns gone has no centre at all, so
     the plan must stop rather than keep generating a shell. */
  const board = new Chess('rnbqkb1r/pppppppp/5n2/8/8/5N2/PP2PPPP/RNBQKB1R b KQkq - 1 2');
  assert.equal(
    isKidOpening(board.fen(), []),
    false,
    'no c/d pawn means no King’s Indian, whatever the first move was',
  );
  const withD = new Chess('rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq d3 0 1');
  assert.equal(isKidOpening(withD.fen(), []), true, 'a pawn on d4 is enough');
});

/* --------------------------- 2. shared theory window ---------------------- */

test('the theory window counts plies, not full moves', () => {
  assert.deepEqual(theoryWindow(1000, 0), { open: true, limit: 3, plies: 0 });
  assert.equal(theoryOpen(1000, 2), true);
  assert.equal(theoryOpen(1000, 3), false);
  assert.equal(theoryOpen(1500, 6), true);
  assert.equal(theoryOpen(1500, 7), false);
  assert.equal(theoryOpen(2000, 13), true);
  assert.equal(theoryOpen(2000, 14), false);
  assert.equal(theoryOpen(2400, 13), true);
  assert.equal(theoryOpen(2400, 14), false);

  /* The USCF class owns the book depth: E 3, D 5, C 7, B 9, A 11, Expert+ 14.
     Below 1000 the beginner's four plies stay. */
  assert.equal(bookPlyLimit(400), 4);
  assert.equal(bookPlyLimit(1000), 3);
  assert.equal(bookPlyLimit(1199), 3);
  assert.equal(bookPlyLimit(1200), 5);
  assert.equal(bookPlyLimit(1400), 7);
  assert.equal(bookPlyLimit(1600), 9);
  assert.equal(bookPlyLimit(1800), 11);
  assert.equal(bookPlyLimit(2001), 14);

  /* Below the random floor there is no theory at all, at any depth. */
  assert.equal(theoryOpen(300, 0), false);
});

function stubEngine(candidates: Array<{ uci: string; scoreCp: number }>): StockfishController {
  const none = () => {
    throw new Error('this position must not search');
  };
  return {
    status: 'ready',
    error: null,
    evaluatePosition: none,
    evaluateWithin: async (fen: string, depth: number, multipv: number) => ({
      fen,
      depth,
      multipv,
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
    stop: () => {},
    terminate: () => {},
  } as StockfishController;
}

async function watchBot(sans: string[], elo: number, candidates: string[]) {
  const game = new Chess();
  for (const san of sans) game.move(san);
  return chooseBotMove({
    game,
    fen: game.fen(),
    history: sans,
    botColor: game.turn(),
    style: styleFor('brandon', elo)!,
    elo,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: stubEngine(candidates.map((uci, index) => ({ uci, scoreCp: 20 - index }))),
    random: () => 0.99,
  });
}

test('Watch Bots stops following the book exactly when Play does', async () => {
  /* Ply 0 is inside every rating's window, so the repertoire answers. */
  const fresh = await watchBot([], 1000, ['e2e4', 'd2d4']);
  assert.equal(fresh?.bookMove, true);
  assert.equal(fresh?.source, 'repertoire');

  /* Four plies in, an 1000 has exhausted four plies of memory. The book still
     has `f2f4` here (Brandon's Vienna), so a closed window is the only reason
     it is not played. */
  const deep = await watchBot(['e4', 'e5', 'Nc3', 'Nf6'], 1000, ['f2f4', 'f1c4', 'd2d4']);
  assert.ok(deep);
  assert.equal(deep.bookMove, false);
  assert.notEqual(deep.source, 'repertoire');
  assert.equal(theoryOpen(1000, 4), false);

  /* At 2400 the same bot in the same position still has the book — the rule is
     the rating, not the mode. */
  const master = await watchBot(['e4', 'e5', 'Nc3', 'Nf6'], 2400, ['f2f4', 'f1c4']);
  assert.equal(master?.bookMove, true);
  assert.equal(master?.source, 'repertoire');
});

test('the King’s Indian plan cannot outlive the theory window', async () => {
  /* Bryan as Black in a KID, five plies in: an 800's window closed at four. */
  const game = new Chess();
  for (const san of ['d4', 'Nf6', 'c4', 'g6', 'Nc3']) game.move(san);
  const chosen = await chooseBotMove({
    game,
    fen: game.fen(),
    history: ['d4', 'Nf6', 'c4', 'g6', 'Nc3'],
    botColor: 'b',
    style: styleFor('bryan', 800)!,
    elo: 800,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: stubEngine([
      { uci: 'f8g7', scoreCp: -20 },
      { uci: 'd7d6', scoreCp: -25 },
      { uci: 'b8c6', scoreCp: -30 },
    ]),
    random: () => 0.99,
  });

  assert.ok(chosen);
  assert.notEqual(chosen.source, 'kids-indian');
  assert.equal(chosen.bookMove, false);
  assert.equal(theoryOpen(800, 5), false);
});

/* -------------------------- 3. mid-line FEN depth ------------------------- */

test('a chapter that started mid-line cannot answer a shallower game', () => {
  /* The start position is reached again after a four-ply repetition, and after
     eight — a real case where the same board appears at two depths. */
  const four = new Chess();
  for (const san of ['Nf3', 'Nf6', 'Ng1', 'Ng8']) four.move(san);
  const eight = new Chess();
  for (const san of ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']) eight.move(san);
  assert.equal(four.fen().split(' ').slice(0, 3).join(' '), eight.fen().split(' ').slice(0, 3).join(' '));

  const book: PersonalityBook = new Map([
    [
      bookKey(new Chess().fen()),
      [
        {
          uci: 'e2e4',
          san: 'e4',
          lineIds: ['midline-fragment'],
          tags: [],
          weight: 1,
          minPly: 8,
        },
      ],
    ],
  ]);

  assert.equal(legalBookMoves(book, four).length, 0, 'four plies is too early');
  assert.equal(legalBookMoves(book, eight).length, 1, 'eight plies is the chapter’s depth');
});

test('compiled books keep their FEN-started chapters, tagged with their depth', () => {
  const brandonDeep = BRANDON_BOOK.filter((entry) => (entry.minPly ?? 0) > 0);
  assert.ok(brandonDeep.length > 400, 'Brandon keeps his mid-line Grünfeld chapters, with depth');
  for (const entry of brandonDeep) {
    assert.ok((entry.minPly ?? 0) % 1 === 0);
    assert.ok((entry.minPly ?? -1) >= 0);
  }

  /* Nina's study headers reset the move counter, so her FEN chapters carry no
     depth floor; they are kept (never silently dropped) and rely on the exact
     position key, which is why the corpus check below still holds. */
  assert.ok(
    NINA_BOOK.some((entry) => entry.lineIds.some((id) => id.includes('jobava'))),
    'Nina keeps her Jobava chapters',
  );
});

test('every compiled entry is playable in the position its key describes', () => {
  const fenOfKey = (key: string): string => {
    const fields = key.split(' ');
    return fields.length === 4 ? `${key} 0 1` : `${key} - 0 1`;
  };

  let checked = 0;
  for (const entry of [...BRANDON_BOOK, ...NINA_BOOK]) {
    const game = new Chess(fenOfKey(entry.key));
    const legal = game
      .moves({ verbose: true })
      .some((move) => `${move.from}${move.to}${move.promotion ?? ''}` === entry.uci);
    assert.ok(legal, `${entry.lineIds[0]}: ${entry.uci} is not legal in its own key`);
    checked += 1;
  }
  assert.ok(checked > 5000, 'the whole compiled corpus was checked');
});

/* ----------------------------- 4. en passant ----------------------------- */

test('the key carries en passant only when it changes the legal moves', () => {
  const capturable = 'rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
  const sameBoardNoEp = 'rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
  /* A target with no adjoining pawn: the field is irrelevant to the position. */
  const targetWithoutCapture = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
  const plain = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

  assert.equal(capturableEnPassant(capturable), 'e3');
  assert.equal(capturableEnPassant(sameBoardNoEp), null);
  assert.equal(capturableEnPassant(targetWithoutCapture), null);

  assert.notEqual(bookKey(capturable), bookKey(sameBoardNoEp));
  assert.equal(bookKey(targetWithoutCapture), bookKey(plain));
});

test('an en passant entry never matches a board that cannot capture', () => {
  const withEp = 'rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
  const withoutEp = 'rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
  const book: PersonalityBook = new Map([
    [
      bookKey(withEp),
      [{ uci: 'd4e3', san: 'dxe3', lineIds: ['ep'], tags: [], weight: 1 }],
    ],
  ]);

  const right = legalBookMoves(book, new Chess(withEp));
  assert.deepEqual(right.map((move) => move.uci), ['d4e3']);

  const wrong = legalBookMoves(book, new Chess(withoutEp));
  assert.equal(wrong.length, 0, 'no en passant rights, no en passant entry');
});

test('no compiled entry is dead in its own key', () => {
  const fenOfKey = (key: string): string => {
    const fields = key.split(' ');
    return fields.length === 4 ? `${key} 0 1` : `${key} - 0 1`;
  };
  const epEntries = [...BRANDON_BOOK, ...NINA_BOOK].filter((entry) =>
    entry.key.split(' ').length === 4,
  );
  assert.ok(epEntries.length >= 2, 'the en passant positions are still in the corpus');
  for (const entry of epEntries) {
    const fen = fenOfKey(entry.key);
    assert.equal(capturableEnPassant(fen), entry.key.split(' ')[3]);
    const book: PersonalityBook = new Map([
      [entry.key, [{ uci: entry.uci, san: entry.san, lineIds: entry.lineIds, tags: entry.tags, weight: entry.weight }]],
    ]);
    assert.equal(legalBookMoves(book, new Chess(fen)).length, 1, `${entry.san} is live`);
  }
});

/* --------------------------- 5. colour ownership ------------------------- */

test('the principle layers refuse a seat the board does not agree with', () => {
  const afterD4 = position('d4');
  const start = { fen: new Chess().fen(), history: [] as string[] };

  /* Black's plan on Black's turn is fine; claiming White's seat is not. */
  assert.ok(kidPlan(afterD4.fen, afterD4.history, JUNIOR, 'b'));
  assert.equal(kidPlan(afterD4.fen, afterD4.history, JUNIOR, 'w'), null);

  assert.ok(ninaPlan(afterD4.fen, afterD4.history, PERSONALITY_STYLES.nina, 'b'));
  assert.equal(ninaPlan(afterD4.fen, afterD4.history, PERSONALITY_STYLES.nina, 'w'), null);

  assert.ok(ninaPlan(start.fen, start.history, PERSONALITY_STYLES.nina, 'w'));
  assert.equal(ninaPlan(start.fen, start.history, PERSONALITY_STYLES.nina, 'b'), null);
});

/* ------------------------------ 8. regression ---------------------------- */

test('identities and repertoire assignments are untouched', () => {
  assert.equal(Object.keys(PERSONALITY_STYLES).length, 23);
  assert.ok(!('emmanuel' in PERSONALITY_REPERTOIRES), 'Emmanuel still has no repertoire');
  /* Bryan's three strength profiles still share one book and one KID plan. */
  assert.ok(!('bryan' in PERSONALITY_REPERTOIRES));
  assert.ok(!('bryan-prime' in PERSONALITY_REPERTOIRES));
  assert.ok(!('bryan-sophomore' in PERSONALITY_REPERTOIRES));
  assert.equal(BRANDON_BOOK.length, 1908);
  assert.equal(NINA_BOOK.length, 3679);
});
