import assert from 'node:assert/strict';
import test from 'node:test';
import { Chess } from 'chess.js';
import { PERSONALITY_OPPONENTS, getOpponent } from '../../src/play/opponents.ts';
import {
  BRANDON_BOOK_STATS,
  PERSONALITY_REPERTOIRES,
  personalityBookFor,
  personalityBooks,
  repertoireIssues,
} from '../../src/play/personality/repertoires/index.ts';
import { legalBookMoves } from '../../src/play/personality/repertoires/book.ts';
import { PERSONALITY_STYLES, styleFor } from '../../src/play/personality/styles.ts';
import { DIALOGUE_BANKS } from '../../src/play/personality/dialogue.ts';

const BRANDON = getOpponent('brandon');

test('Brandon is registered as the fifth personality at 2350', () => {
  assert.ok(BRANDON);
  assert.equal(BRANDON.name, 'Brandon Tran');
  assert.equal(BRANDON.title, 'Prime');
  assert.equal(BRANDON.elo, 2350);
  assert.equal(BRANDON.portraitPath, 'opponents/brandon.webp');
  assert.equal(BRANDON.usesRepertoire, false);
  assert.equal(PERSONALITY_OPPONENTS.length, 17);
  assert.equal(new Set(PERSONALITY_OPPONENTS.map((opponent) => opponent.id)).size, 17);
  assert.equal(PERSONALITY_OPPONENTS.filter((opponent) => opponent.id === 'brandon').length, 1);
});

test('Brandon’s tendency profile is the requested one', () => {
  const style = styleFor('brandon', 2350);
  assert.ok(style);
  assert.equal(style.aggression, 95);
  assert.equal(style.risk, 90);
  assert.equal(style.positional, 55);
  assert.equal(style.tactical, 98);
  assert.equal(style.defensive, 65);
  assert.equal(style.initiative, 98);
  assert.equal(style.simplification, 20);
  assert.equal(style.complexity, 100);
  assert.equal(style.kingSafety, 60);
  assert.equal(style.material, 25);
  assert.ok(style.sacrifice > PERSONALITY_STYLES.senior.sacrifice);
});

test('all five supplied sources compiled without an illegal move', () => {
  assert.equal(
    BRANDON_BOOK_STATS.sources.length,
    5,
    'Vienna, Sicilian 2.Ne2, Austrian Attack, French and Grünfeld were supplied',
  );
  assert.deepEqual(BRANDON_BOOK_STATS.issues, []);
  assert.ok(BRANDON_BOOK_STATS.chapters > 100, `${BRANDON_BOOK_STATS.chapters} chapters`);
  assert.ok(BRANDON_BOOK_STATS.variations > 1000, `${BRANDON_BOOK_STATS.variations} variations`);
  assert.ok(BRANDON_BOOK_STATS.positions > 1000, `${BRANDON_BOOK_STATS.positions} positions`);
  assert.deepEqual(repertoireIssues().filter((entry) => entry.issues.length > 0), []);
});

test('Brandon has a White Vienna/Sicilian/Austrian book and a Black French/Grünfeld book', () => {
  assert.ok(personalityBooks('brandon').w.book.size > 0);
  assert.ok(personalityBooks('brandon').b.book.size > 0);

  const start = new Chess();
  const white = legalBookMoves(personalityBookFor('brandon', 'w'), start);
  assert.deepEqual(
    white.map((move) => move.san),
    ['e4'],
    'the White repertoire starts with the Vienna move order',
  );

  const sicilian = new Chess();
  sicilian.move('e4');
  sicilian.move('c5');
  assert.deepEqual(
    legalBookMoves(personalityBookFor('brandon', 'w'), sicilian).map((move) => move.san),
    ['Ne2'],
    'the supplied 2.Ne2 move order is in the White book',
  );

  const pirc = new Chess();
  for (const san of ['e4', 'd6']) pirc.move(san);
  assert.deepEqual(
    legalBookMoves(personalityBookFor('brandon', 'w'), pirc).map((move) => move.san),
    ['d4'],
    'the Austrian Attack answers 1...d6 with 2.d4',
  );

  const austrian = new Chess();
  for (const san of ['e4', 'd6', 'd4', 'Nf6', 'Nc3', 'g6']) austrian.move(san);
  assert.ok(
    legalBookMoves(personalityBookFor('brandon', 'w'), austrian).some((move) => move.san === 'f4'),
    'the Austrian Attack tabiya continues with 4.f4',
  );

  const modern = new Chess();
  for (const san of ['e4', 'g6', 'd4', 'Bg7', 'Nc3', 'd6']) modern.move(san);
  assert.ok(
    legalBookMoves(personalityBookFor('brandon', 'w'), modern).some((move) => move.san === 'f4'),
    'the Pseudo-Austrian move order against 1...g6 is book too',
  );

  const beyondSupplied = new Chess();
  for (const san of ['e4', 'c5', 'Ne2', 'Nc6']) beyondSupplied.move(san);
  assert.equal(
    legalBookMoves(personalityBookFor('brandon', 'w'), beyondSupplied).length,
    0,
    'nothing was supplied after 2.Ne2, so the engine continues',
  );

  const afterE4 = new Chess();
  afterE4.move('e4');
  assert.ok(
    legalBookMoves(personalityBookFor('brandon', 'b'), afterE4).some((move) => move.san === 'e6'),
    'the French Defence answers 1.e4',
  );

  const afterD4 = new Chess();
  afterD4.move('d4');
  assert.ok(
    legalBookMoves(personalityBookFor('brandon', 'b'), afterD4).some((move) => move.san === 'Nf6'),
    'the Grünfeld answers 1.d4',
  );
});

test('Brandon’s book keeps branching positions and exits when the line ends', () => {
  const choices = [...personalityBooks('brandon').w.book.values()].filter(
    (moves) => moves.length > 1,
  );
  assert.ok(choices.length > 0, 'variations should survive as alternative book moves');

  const game = new Chess();
  for (const san of ['e4', 'e5', 'Nc3', 'Nf6', 'f4', 'd5', 'fxe5', 'Nxe4']) {
    game.move(san);
  }
  assert.ok(
    legalBookMoves(personalityBookFor('brandon', 'w'), game).some((move) => move.san === 'Nf3'),
    'the Vienna Gambit main line is still book at White’s fifth move',
  );

  const left = new Chess();
  left.move('a4');
  assert.equal(
    legalBookMoves(personalityBookFor('brandon', 'b'), left).length,
    0,
    'an uncovered first move must fall through to the engine',
  );
});

test('Brandon’s book is independent of Senior’s and of the user courses', () => {
  assert.ok(!('brandon' in PERSONALITY_REPERTOIRES), 'Brandon has no declared SAN lines');

  const seniorBlack = personalityBookFor('senior', 'b');
  const brandonBlack = personalityBookFor('brandon', 'b');
  assert.notEqual(seniorBlack.size, brandonBlack.size);

  const vienna = new Chess();
  vienna.move('e4');
  assert.ok(
    legalBookMoves(brandonBlack, vienna).some((move) => move.san === 'e6'),
    'Brandon meets 1.e4 with his French Defence, not Senior’s Pirc',
  );
  assert.ok(
    !legalBookMoves(brandonBlack, vienna).some((move) => move.san === 'd6'),
    'Senior’s Pirc must not leak into Brandon’s book',
  );

  /* No bot is wired to the imported courses, and the General Bot has no
     personality book of its own. */
  assert.equal(personalityBookFor('general', 'w').size, 0);
  assert.equal(personalityBookFor('general', 'b').size, 0);
});

test('Brandon has a full, non-repeating dialogue bank with a sacrifice line', () => {
  const bank = DIALOGUE_BANKS.brandon;
  for (const [event, lines] of Object.entries(bank)) {
    assert.ok(lines.length >= 2, `brandon/${event} needs at least two lines`);
    for (const line of lines) {
      assert.ok(line.length > 0 && line.length <= 100, `${event}: ${line}`);
      assert.ok(!/\b(eval|centipawn|engine|stockfish|depth)\b/i.test(line));
      assert.ok(!/[0-9]/.test(line));
    }
  }
  assert.equal(bank.sacrifice.length, 3);
  assert.match(bank.sacrifice[0], /love this/i);
  assert.equal(new Set([bank.attack[0], DIALOGUE_BANKS.senior.attack[0]]).size, 2);
});
