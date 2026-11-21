import assert from 'node:assert/strict';
import test from 'node:test';
import {
  candidateGapForElo,
  chooseBookMove,
  choosePersonalityMove,
  describeMove,
} from '../../src/play/personality/engine.ts';
import { blunderChance, depthForElo } from '../../src/play/strength.ts';
import type { BookMove } from '../../src/play/personality/repertoires/book.ts';
import {
  PERSONALITY_STYLES,
  accuracyForElo,
  styleFor,
} from '../../src/play/personality/styles.ts';

/**
 * Italian Game position where White can castle or send the knight to g5: two
 * sound moves, one keeping the king home and one creating activity. The engine
 * prefers castling by 1cp, which is exactly the kind of near-tie personality is
 * supposed to break.
 */
const QUIET_OR_ACTIVE = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 6';

const CANDIDATES = [
  { uci: 'e1g1', scoreCp: 15, mate: null },
  { uci: 'f3g5', scoreCp: 15, mate: null },
];

function pick(
  id: 'freshman' | 'sophomore' | 'junior' | 'senior' | 'brandon' | 'nina',
  elo: number,
) {
  const style = styleFor(id, elo);
  assert.ok(style);
  return choosePersonalityMove({
    fen: QUIET_OR_ACTIVE,
    candidates: CANDIDATES,
    style,
    elo,
    random: () => 0.9,
  });
}

test('the profiles are the agreed tendency table', () => {
  assert.deepEqual(
    Object.values(PERSONALITY_STYLES).map((style) => style.aggression),
    [25, 45, 30, 85, 95, 55, 35, 50, 35, 80, 70, 25, 50, 40, 90, 30, 35, 35],
  );
  assert.deepEqual(
    Object.values(PERSONALITY_STYLES).map((style) => style.risk),
    [20, 45, 25, 85, 90, 50, 30, 50, 30, 45, 75, 20, 45, 35, 85, 20, 30, 25],
  );
  assert.deepEqual(
    Object.values(PERSONALITY_STYLES).map((style) => style.defensive),
    [85, 70, 95, 45, 65, 55, 95, 50, 45, 80, 35, 45, 65, 30, 35, 98, 50, 65],
  );
  assert.deepEqual(
    Object.values(PERSONALITY_STYLES).map((style) => style.complexity),
    [20, 55, 35, 90, 100, 45, 25, 50, 35, 45, 85, 20, 45, 30, 95, 25, 30, 25],
  );
  const brandon = PERSONALITY_STYLES.brandon;
  assert.deepEqual(
    [brandon.tactical, brandon.initiative, brandon.simplification, brandon.material],
    [98, 98, 20, 25],
  );
});

test('accuracy comes from the rating, not the character', () => {
  assert.deepEqual(
    ['freshman', 'sophomore', 'junior', 'senior', 'brandon', 'nina'].map(
      (id) =>
        styleFor(
          id,
          id === 'brandon'
            ? 2350
            : id === 'junior'
              ? 2150
              : id === 'senior'
                ? 2250
                : id === 'sophomore'
                  ? 1450
                  : id === 'nina'
                    ? 1550
                    : 1250,
        )?.accuracy,
    ),
    [
      accuracyForElo(1250),
      accuracyForElo(1450),
      accuracyForElo(2150),
      accuracyForElo(2250),
      accuracyForElo(2350),
      accuracyForElo(1550),
    ],
  );
  assert.ok(accuracyForElo(1250) < accuracyForElo(1450));
  assert.ok(accuracyForElo(1450) < accuracyForElo(2150));
  assert.ok(accuracyForElo(2150) < accuracyForElo(2250));
  assert.ok(accuracyForElo(2250) < accuracyForElo(2350));
});

test('the same position produces different choices for different characters', () => {
  const freshman = pick('freshman', 1250);
  const senior = pick('senior', 2250);
  assert.ok(freshman);
  assert.ok(senior);

  assert.equal(freshman.uci, 'e1g1', 'Freshman keeps the king safe');
  assert.equal(senior.uci, 'f3g5', 'Senior prefers active pieces');
  assert.notEqual(freshman.uci, senior.uci);
});

test('Junior and Sophomore also stay with the solid move here', () => {
  assert.equal(pick('junior', 2150)?.uci, 'e1g1');
  assert.equal(pick('sophomore', 1450)?.uci, 'e1g1');
});

test('at 2250, taste cannot outvote a weaker evaluation', () => {
  const style = styleFor('senior', 2250);
  assert.ok(style);
  const choice = choosePersonalityMove({
    fen: QUIET_OR_ACTIVE,
    candidates: [
      { uci: 'e1g1', scoreCp: 15, mate: null },
      { uci: 'f3g5', scoreCp: 10, mate: null },
    ],
    style,
    elo: 2250,
    random: () => 0.9,
  });
  assert.equal(choice?.uci, 'e1g1', 'stronger calculation corrects the old 1cp indulgence');
});

test('a forced mate overrides every tendency', () => {
  const mate = '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1';
  const candidates = [
    { uci: 'e1e8', scoreCp: 100_000, mate: 1 },
    { uci: 'e1e7', scoreCp: 900, mate: null },
  ];

  const eloFor = (id: string) =>
    id === 'brandon'
      ? 2350
      : id === 'junior'
        ? 2150
        : id === 'senior'
          ? 2250
          : id === 'sophomore'
            ? 1450
            : id === 'nina'
              ? 1550
              : 1250;

  for (const id of ['freshman', 'sophomore', 'junior', 'senior', 'brandon', 'nina'] as const) {
    const style = styleFor(id, eloFor(id));
    assert.ok(style);
    const result = choosePersonalityMove({
      fen: mate,
      candidates,
      style,
      elo: eloFor(id),
      random: () => 0.5,
    });
    assert.equal(result?.uci, 'e1e8', `${id} missed mate in one`);
  }
});

test('an obviously losing move is never selected for taste', () => {
  const style = styleFor('senior', 2250);
  assert.ok(style);
  const result = choosePersonalityMove({
    fen: QUIET_OR_ACTIVE,
    candidates: [
      { uci: 'e1g1', scoreCp: 15, mate: null },
      { uci: 'c4f7', scoreCp: -190, mate: null },
    ],
    style,
    elo: 2250,
    random: () => 0.1,
  });
  assert.equal(result?.uci, 'e1g1');
});

test('the allowed score gap shrinks as the rating rises', () => {
  assert.ok(candidateGapForElo(1250) > candidateGapForElo(1450));
  assert.ok(candidateGapForElo(1450) > candidateGapForElo(2150));
  assert.ok(candidateGapForElo(2150) > candidateGapForElo(2250));
  assert.equal(candidateGapForElo(2250), 60);
  assert.ok(candidateGapForElo(2350) < candidateGapForElo(2250));

  /* Senior's 2250 target must be a real strength step over Junior, not extra
     noise: a tighter gap, higher accuracy and a rarer mistake. Search depth is
     shared now, so the blunder curve carries the step. */
  assert.ok(accuracyForElo(2250) > accuracyForElo(2150));
  assert.equal(depthForElo(2250), depthForElo(2150));
  assert.ok(blunderChance(2250) < blunderChance(2150));

  /* Brandon's 2350 target has to be a real step over Senior, not just a label. */
  assert.ok(accuracyForElo(2350) > accuracyForElo(2250));
  assert.equal(depthForElo(2350), depthForElo(2250));
  assert.ok(blunderChance(2350) < blunderChance(2250));
});

test('illegal candidates are filtered out', () => {
  const style = styleFor('junior', 2150);
  assert.ok(style);

  assert.equal(
    choosePersonalityMove({
      fen: QUIET_OR_ACTIVE,
      candidates: [{ uci: 'a1a8', scoreCp: 900, mate: null }],
      style,
      elo: 2150,
    }),
    null,
  );

  const mixed = choosePersonalityMove({
    fen: QUIET_OR_ACTIVE,
    candidates: [
      { uci: 'a1a8', scoreCp: 900, mate: null },
      { uci: 'e1g1', scoreCp: 10, mate: null },
    ],
    style,
    elo: 2150,
    random: () => 0.9,
  });
  assert.equal(mixed?.uci, 'e1g1');
});

test('move features read the board, not the caller', () => {
  const castle = describeMove(QUIET_OR_ACTIVE, 'e1g1');
  assert.ok(castle);
  assert.equal(castle.castle, true);
  assert.equal(castle.check, false);

  const sortie = describeMove(QUIET_OR_ACTIVE, 'f3g5');
  assert.ok(sortie);
  assert.equal(sortie.develops, false);
  assert.equal(sortie.toEnemyHalf, true);
  assert.equal(sortie.check, false);

  assert.equal(describeMove(QUIET_OR_ACTIVE, 'a1a8'), null);
});

test('repertoire choice follows the opening bias', () => {
  const moves: BookMove[] = [
    { uci: 'e2e4', san: 'e4', lineIds: ['solid'], tags: ['solid'], weight: 1 },
    { uci: 'd2d4', san: 'd4', lineIds: ['sharp'], tags: ['sharp'], weight: 1 },
  ];

  let seed = 12345;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  const share = (id: 'freshman' | 'senior') => {
    let sharp = 0;
    for (let index = 0; index < 600; index += 1) {
      if (chooseBookMove(moves, PERSONALITY_STYLES[id], random)?.tags.includes('sharp')) {
        sharp += 1;
      }
    }
    return sharp / 600;
  };

  const freshman = share('freshman');
  const senior = share('senior');
  assert.ok(senior > freshman, `senior ${senior} should prefer sharp more than freshman ${freshman}`);
  assert.ok(senior > 0.55);
  assert.ok(freshman < 0.45);
});

test('every profile can still choose a purely engine-best move', () => {
  const style = styleFor('freshman', 1250);
  assert.ok(style);
  const result = choosePersonalityMove({
    fen: QUIET_OR_ACTIVE,
    candidates: [{ uci: 'e1g1', scoreCp: 40, mate: null }],
    style,
    elo: 1250,
  });
  assert.equal(result?.uci, 'e1g1');
  assert.equal(result?.best, true);
  assert.equal(result?.gap, 0);
});
