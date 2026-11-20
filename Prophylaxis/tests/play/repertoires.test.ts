import assert from 'node:assert/strict';
import test from 'node:test';
import { Chess } from 'chess.js';
import { GENERAL_BOT, PERSONALITY_OPPONENTS } from '../../src/play/opponents.ts';
import {
  PERSONALITY_REPERTOIRES,
  personalityBookFor,
  personalityBooks,
  repertoireIssues,
} from '../../src/play/personality/repertoires/index.ts';
import {
  buildPersonalityBook,
  findBookMoves,
  legalBookMoves,
} from '../../src/play/personality/repertoires/book.ts';
import type { OpeningLine } from '../../src/play/personality/repertoires/types.ts';
import { chooseBookMove } from '../../src/play/personality/engine.ts';
import { kidPlan } from '../../src/play/personality/repertoires/kid.ts';
import { PERSONALITY_STYLES } from '../../src/play/personality/styles.ts';
import { STANDARD_START_FEN } from '../../src/play/pgn.ts';

const IDS = ['freshman', 'sophomore', 'junior', 'senior'] as const;

test('every personality declares both colours and replays without illegal moves', () => {
  assert.deepEqual(repertoireIssues().filter((entry) => entry.issues.length > 0), []);

  for (const id of IDS) {
    const repertoire = PERSONALITY_REPERTOIRES[id];
    assert.ok(repertoire.asWhite.length >= 3, `${id} needs White lines`);
    assert.ok(repertoire.asBlack.length >= 3, `${id} needs Black lines`);
    assert.ok(personalityBooks(id).w.book.size > 0);
    assert.ok(personalityBooks(id).b.book.size > 0);
  }
});

test('White has a book move from the standard start position', () => {
  for (const id of IDS) {
    const moves = findBookMoves(personalityBookFor(id, 'w'), STANDARD_START_FEN);
    assert.ok(moves.length > 0, `${id} has no first move`);
  }
});

test('every character answers 1.e4 from its supplied repertoire', () => {
  for (const id of IDS) {
    const game = new Chess();
    game.move('e4');
    const moves = legalBookMoves(personalityBookFor(id, 'b'), game);
    assert.ok(moves.length > 0, `${id} has no reply to 1.e4`);
  }
});

test('1.d4 is covered by the book, or by the principle-based King’s Indian', () => {
  const game = new Chess();
  game.move('d4');

  for (const id of ['freshman', 'senior'] as const) {
    assert.ok(
      legalBookMoves(personalityBookFor(id, 'b'), game).length > 0,
      `${id} should answer 1.d4 from its book`,
    );
  }

  for (const id of ['sophomore', 'junior'] as const) {
    assert.equal(
      legalBookMoves(personalityBookFor(id, 'b'), game).length,
      0,
      `${id} must not ship a King’s Indian PGN`,
    );
    const plan = kidPlan(game.fen(), ['d4'], PERSONALITY_STYLES[id]);
    assert.ok(plan, `${id} has no King’s Indian preference`);
    assert.equal(plan.moves[0]?.uci, 'g8f6');
  }
});

test('the four repertoires are different from each other', () => {
  const firstMoves = IDS.map((id) =>
    findBookMoves(personalityBookFor(id, 'w'), STANDARD_START_FEN)
      .map((move) => move.uci)
      .sort()
      .join(','),
  );
  /* Freshman and the three Catalan players start differently. */
  assert.notEqual(firstMoves[0], firstMoves[1]);

  const e4Replies = IDS.map((id) => {
    const game = new Chess();
    game.move('e4');
    return legalBookMoves(personalityBookFor(id, 'b'), game)
      .map((move) => move.uci)
      .sort()
      .join(',');
  });
  assert.notEqual(e4Replies[0], e4Replies[3], 'Freshman meets 1.e4 with ...e5, Senior with the Pirc');

  const d4Book = IDS.map((id) => {
    const game = new Chess();
    game.move('d4');
    return legalBookMoves(personalityBookFor(id, 'b'), game)
      .map((move) => move.uci)
      .sort()
      .join(',');
  });
  assert.notEqual(d4Book[0], d4Book[3], 'Freshman plays a Slav, Senior a Grünfeld');
  assert.equal(d4Book[1], '', 'Sophomore’s King’s Indian is preference-based, not a PGN');
  assert.equal(d4Book[2], '', 'Junior’s King’s Indian is preference-based, not a PGN');
});

test('every declared book move is legal in the position it is stored under', () => {
  for (const id of IDS) {
    for (const color of ['w', 'b'] as const) {
      for (const [key, moves] of personalityBookFor(id, color)) {
        const game = new Chess(`${key} - 0 1`);
        const legal = new Set(
          game.moves({ verbose: true }).map(
            (move) => `${move.from}${move.to}${move.promotion ?? ''}`,
          ),
        );
        for (const move of moves) {
          assert.ok(legal.has(move.uci), `${id}/${color}: ${move.san} illegal in ${key}`);
        }
      }
    }
  }
});

test('every repertoire contains a position with several prepared moves', () => {
  for (const id of IDS) {
    const choices = (['w', 'b'] as const).flatMap((color) =>
      [...personalityBookFor(id, color).values()].filter((moves) => moves.length > 1),
    );
    assert.ok(choices.length > 0, `${id} has no branching positions at all`);
  }
});

test('transpositions merge into one book entry', () => {
  const lines: OpeningLine[] = [
    { id: 'a', name: 'd4 first', san: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6'] },
    { id: 'b', name: 'c4 first', san: ['c4', 'e6', 'd4', 'd5', 'Nc3', 'Nf6'] },
  ];
  const built = buildPersonalityBook(lines, 'w');
  assert.equal(built.issues.length, 0);

  const game = new Chess();
  for (const san of ['d4', 'd5', 'c4', 'e6']) game.move(san);
  const moves = findBookMoves(built.book, game.fen());
  assert.equal(moves.length, 1);
  assert.equal(moves[0].uci, 'b1c3');
  assert.deepEqual([...moves[0].lineIds].sort(), ['a', 'b']);
});

test('leaving the repertoire ends book play', () => {
  for (const id of IDS) {
    const game = new Chess();
    game.move('a4');
    game.move('a5');
    assert.equal(
      legalBookMoves(personalityBookFor(id, 'w'), game).length,
      0,
      `${id} followed the player out of book`,
    );
  }
});

test('personality bots never read the General Bot repertoire', () => {
  assert.equal(GENERAL_BOT.usesRepertoire, true);
  for (const opponent of PERSONALITY_OPPONENTS) {
    assert.equal(opponent.usesRepertoire, false);
    /* Emmanuel Domah is the one personality with no opening book at all: an
       empty White book is the implementation of "no repertoire", never a gap. */
    if (opponent.id === 'emmanuel') {
      assert.equal(personalityBookFor(opponent.id, 'w').size, 0);
      assert.equal(personalityBookFor(opponent.id, 'b').size, 0);
      continue;
    }
    assert.equal(personalityBookFor(opponent.id, 'w').size > 0, true);
  }

  /* No catalogue entry and no course book exists for the General Bot here. */
  assert.equal(personalityBookFor('general', 'w').size, 0);
  assert.equal(personalityBookFor('general', 'b').size, 0);
  assert.equal(personalityBooks('general').w.book.size, 0);
});

test('following the books for both sides never produces an illegal move', () => {
  for (const id of IDS) {
    const game = new Chess();
    let played = 0;
    for (let ply = 0; ply < 10; ply += 1) {
      const moves = legalBookMoves(personalityBookFor(id, game.turn()), game);
      if (moves.length === 0) break;
      const choice = chooseBookMove(moves, PERSONALITY_STYLES[id], () => 0);
      assert.ok(choice, `${id} failed to choose among ${moves.length} book moves`);
      game.move(choice.san);
      played += 1;
    }
    assert.ok(played >= 1, `${id} left its own book after ${played} plies`);
  }
});
