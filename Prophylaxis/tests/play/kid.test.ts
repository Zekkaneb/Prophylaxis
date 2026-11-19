import assert from 'node:assert/strict';
import test from 'node:test';
import { Chess } from 'chess.js';
import { PERSONALITY_REPERTOIRES } from '../../src/play/personality/repertoires/index.ts';
import {
  chooseKidMove,
  isKidOpening,
  kidPlan,
  type KidPlan,
} from '../../src/play/personality/repertoires/kid.ts';
import { PERSONALITY_STYLES, styleFor } from '../../src/play/personality/styles.ts';
import type { PersonalityCandidate } from '../../src/play/personality/engine.ts';

const SOPHOMORE = PERSONALITY_STYLES.sophomore;
const JUNIOR = PERSONALITY_STYLES.junior;

/** Plays SAN moves from the start and returns history + FEN. */
function line(sans: string[]): { history: string[]; fen: string } {
  const game = new Chess();
  for (const san of sans) game.move(san);
  return { history: sans, fen: game.fen() };
}

function planFor(
  sans: string[],
  style = JUNIOR,
  random: () => number = () => 0.9,
): KidPlan | null {
  const { history, fen } = line(sans);
  return kidPlan(fen, history, style, random);
}

const CANDIDATE = (uci: string, scoreCp: number): PersonalityCandidate => ({
  uci,
  scoreCp,
  mate: null,
});

test('the King’s Indian answers 1.d4 with ...Nf6', () => {
  const plan = planFor(['d4']);
  assert.ok(plan);
  assert.equal(plan.moves[0]?.uci, 'g8f6');
  assert.equal(plan.moves[0]?.kind, 'setup');
});

test('the Pirc keeps 1.e4 and the King’s Indian keeps 1.d4', () => {
  assert.equal(planFor(['e4']), null, '1.e4 belongs to the Pirc, not the KID');
  assert.equal(isKidOpening(line(['e4']).fen, ['e4']), false);
});

test('transpositions from 1.c4 and 1.Nf3 still reach the King’s Indian', () => {
  const english = planFor(['c4']);
  assert.ok(english);
  assert.equal(english.moves[0]?.uci, 'g8f6');

  const reti = planFor(['Nf3']);
  assert.ok(reti);
  assert.equal(reti.moves[0]?.uci, 'g8f6');
});

test('it declines the King’s Indian once the structure is not one', () => {
  /* A Queen's Gambit structure: Black has committed to ...d5. */
  const qgd = line(['d4', 'd5', 'c4', 'e6']);
  assert.equal(isKidOpening(qgd.fen, qgd.history), false);
  assert.equal(kidPlan(qgd.fen, qgd.history, JUNIOR), null);

  /* The fianchetto bishop has been developed elsewhere. */
  const game = new Chess();
  for (const san of ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4']) game.move(san);
  assert.equal(kidPlan(game.fen(), ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'], JUNIOR), null);
});

test('Junior builds the whole setup before breaking', () => {
  const steps: Array<{ sans: string[]; move: string }> = [
    { sans: ['d4'], move: 'g8f6' },
    { sans: ['d4', 'Nf6', 'c4'], move: 'g7g6' },
    { sans: ['d4', 'Nf6', 'c4', 'g6', 'Nc3'], move: 'f8g7' },
    { sans: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4'], move: 'd7d6' },
    { sans: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3'], move: 'e8g8' },
  ];

  for (const step of steps) {
    const plan = planFor(step.sans, JUNIOR);
    assert.ok(plan, `no plan after ${step.sans.join(' ')}`);
    assert.equal(plan.moves[0]?.uci, step.move, `after ${step.sans.join(' ')}`);
  }
});

test('Junior waits for castling, Sophomore breaks earlier', () => {
  const sans = ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3'];
  const junior = planFor(sans, JUNIOR);
  const sophomore = planFor(sans, SOPHOMORE);

  assert.ok(junior);
  assert.ok(sophomore);
  assert.equal(junior.moves[0]?.uci, 'e8g8', 'Junior castles first');
  assert.equal(sophomore.moves[0]?.kind, 'break', 'Sophomore breaks before castling');
  assert.equal(sophomore.moves[0]?.uci, 'e7e5', 'White’s centre asks for ...e5');
});

test('the break follows the centre: ...e5 against e4, ...c5 against c4', () => {
  const withE4 = planFor(
    ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3', 'O-O', 'Be2'],
    JUNIOR,
  );
  assert.ok(withE4);
  assert.equal(withE4.moves[0]?.uci, 'e7e5');

  const withoutE4 = planFor(
    ['d4', 'Nf6', 'c4', 'g6', 'Nf3', 'Bg7', 'g3', 'O-O', 'Bg2', 'd6', 'O-O'],
    JUNIOR,
  );
  assert.ok(withoutE4);
  assert.equal(withoutE4.moves[0]?.uci, 'c7c5');
});

test('the plan is legal moves only', () => {
  const positions = [
    ['d4'],
    ['d4', 'Nf6', 'c4'],
    ['d4', 'Nf6', 'c4', 'g6', 'Nc3'],
    ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4'],
    ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3', 'O-O', 'Be2'],
    ['c4'],
    ['Nf3'],
  ];

  for (const sans of positions) {
    const { fen, history } = line(sans);
    for (const style of [SOPHOMORE, JUNIOR]) {
      const plan = kidPlan(fen, history, style, () => 0.5);
      if (!plan) continue;
      const game = new Chess(fen);
      const legal = new Set(
        game.moves({ verbose: true }).map((move) => `${move.from}${move.to}${move.promotion ?? ''}`),
      );
      for (const move of plan.moves) {
        assert.ok(legal.has(move.uci), `${style.id}: ${move.uci} illegal after ${sans.join(' ')}`);
      }
    }
  }
});

test('engine evaluation gates the break, and style sets how strictly', () => {
  const { fen, history } = line([
    'd4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3', 'O-O', 'Be2',
  ]);
  /* White-POV: +40 means Black is 40cp worse after ...e5. */
  const candidates = [CANDIDATE('e7e5', 40), CANDIDATE('b8c6', 0)];

  const junior = chooseKidMove({
    fen,
    history,
    style: styleFor('junior', 2150)!,
    elo: 2150,
    candidates,
    random: () => 0.9,
  });
  const sophomore = chooseKidMove({
    fen,
    history,
    style: styleFor('sophomore', 1450)!,
    elo: 1450,
    candidates,
    random: () => 0.9,
  });

  assert.equal(junior, null, 'Junior declines a ...e5 the engine dislikes by 40cp');
  assert.equal(sophomore?.uci, 'e7e5', 'Sophomore accepts the more ambitious break');
});

test('a preferred move the engine does not list is never played', () => {
  const { fen, history } = line(['d4']);
  const choice = chooseKidMove({
    fen,
    history,
    style: styleFor('junior', 2150)!,
    elo: 2150,
    candidates: [CANDIDATE('d2d4', 25), CANDIDATE('c2c4', 20)],
    random: () => 0.9,
  });
  assert.equal(choice, null);
});

test('the chosen King’s Indian move comes from the engine candidates', () => {
  const { fen, history } = line(['d4']);
  const choice = chooseKidMove({
    fen,
    history,
    style: styleFor('junior', 2150)!,
    elo: 2150,
    candidates: [CANDIDATE('g8f6', 30), CANDIDATE('d7d5', 25)],
    random: () => 0.9,
  });
  assert.ok(choice);
  assert.equal(choice.uci, 'g8f6');
  assert.equal(choice.best, false, 'a 30cp gap is honest about not being best');
});

test('Sophomore’s kingside gesture is occasional, Junior never plays it', () => {
  const sans = ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3', 'O-O', 'Be2', 'e5', 'O-O'];
  const aggressive = planFor(sans, SOPHOMORE, () => 0.1);
  const disciplined = planFor(sans, JUNIOR, () => 0.1);

  assert.ok(aggressive);
  assert.ok(disciplined);
  assert.ok(
    aggressive.moves.some((move) => move.uci === 'f6h5'),
    'Sophomore can swing the knight to h5 once the centre is fixed',
  );
  assert.equal(
    disciplined.moves.some((move) => move.uci === 'f6h5'),
    false,
    'Junior avoids premature kingside gestures',
  );
});

test('the King’s Indian is not claimed as a supplied PGN and never borrows the Grünfeld', () => {
  for (const id of ['sophomore', 'junior'] as const) {
    for (const line of PERSONALITY_REPERTOIRES[id].asBlack) {
      const text = `${line.id} ${line.name}`.toLowerCase();
      assert.equal(text.includes('kid'), false, `${id} claims a KID PGN: ${line.id}`);
      assert.equal(text.includes("king's indian"), false);
      assert.equal(/gruenfeld|grünfeld/.test(text), false, `${id} must not use Senior's Grünfeld`);
    }
  }

  assert.ok(
    PERSONALITY_REPERTOIRES.senior.asBlack.filter((line) => /gruenfeld/.test(line.id)).length >= 3,
    'Senior keeps the supplied Grünfeld',
  );
});
