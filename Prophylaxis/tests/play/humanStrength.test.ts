import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import {
  BEGINNER_BLUNDER_ELO,
  BEGINNER_DEPTH_ELO,
  BEGINNER_ELO,
  BEGINNER_SECOND_WEIGHT,
  BEGINNER_TOP_WEIGHT,
  BEGINNER_VULNERABILITY_ELO,
  BUCKET_ORDER,
  DEEP_SLIP_ELO,
  ELO_MAX,
  ELO_MIN,
  ERROR_TEMPERATURE_BOOST,
  ERROR_TEMPERATURE_BOOST_LOW,
  HUMAN_MULTI_PV,
  PHASE_DISTINCT_ELO,
  PHASE_LEVELS_META,
  PHASE_ONE_BAD_ELO,
  QUALITY_BANDS,
  SELF_MATE_GUARD_ELO,
  allowsMateInOne,
  beginnerScaling,
  bucketFor,
  clampElo,
  describePhaseProfile,
  errorTemperatureBoost,
  getEffectivePhaseElo,
  hasHumanIntent,
  humanCalibration,
  humanSearchDepth,
  lastCaptureOf,
  moveIntent,
  phaseForMoveNumber,
  phaseErrorMultiplier,
  phaseMultiplier,
  pickCategory,
  planHumanSearch,
  positionKind,
  qualityShares,
  recaptureChance,
  rollPhaseProfile,
  scaleErrors,
  selectHumanBotMove,
  suppressTopLines,
  skillOf,
  timeControlCategory,
  timeControlScaling,
  topLineDamping,
  winProbability,
  type QualityShares,
} from '../../src/play/humanStrength.ts';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
/** Exactly one legal move: Kb1. */
const FORCED_FEN = '7k/8/8/8/8/p7/P7/K7 w - - 0 1';
/** Black can take back on e4. */
const RECAPTURE_FEN = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
/** Two legal captures (cxd4, exd4): a sharp turn. */
const SHARP_FEN = '4k3/8/8/8/3p4/2P1P3/3P4/4K3 w - - 0 20';
/** f2f3 walks into ...Qh4#. */
const MATE_IN_ONE_FEN =
  'rnbqkbnr/pppp1ppp/8/4p3/6P1/8/PPPPPP1P/RNBQKBNR w KQkq - 0 1';

const candidate = (uci: string, scoreCp: number, mate: number | null = null) => ({
  uci,
  scoreCp,
  mate,
});

const plan = (elo: number, overrides: Partial<Parameters<typeof planHumanSearch>[0]> = {}) =>
  planHumanSearch({
    fen: START_FEN,
    elo,
    moveNumber: 20,
    timeControlCategory: 'classical',
    remainingTimeMs: null,
    incrementMs: 0,
    random: () => 0.5,
    ...overrides,
  });

const sharesSum = (shares: QualityShares) =>
  shares.blunder +
  shares.mistake +
  shares.inaccuracy +
  shares.good +
  shares.excellent +
  shares.best;

test('the rating scale runs 100-2800 and normalizes skill', () => {
  assert.equal(ELO_MIN, 100);
  assert.equal(ELO_MAX, 2800);
  assert.equal(clampElo(0), 100);
  assert.equal(clampElo(3300), 2800);
  assert.equal(clampElo(Number.NaN), 1500);
  assert.equal(humanCalibration(40).elo, 100);
  assert.equal(humanCalibration(40).skill, 0);
  assert.equal(skillOf(1450), 0.5);
  assert.equal(humanCalibration(9000).skill, 1);
});

test('the six quality buckets sum to 1 across the whole range', () => {
  for (let elo = ELO_MIN; elo <= ELO_MAX; elo += 50) {
    const shares = humanCalibration(elo).quality;
    assert.ok(Math.abs(sharesSum(shares) - 1) < 1e-9, `shares do not sum to 1 at ${elo}`);
    for (const key of BUCKET_ORDER) {
      assert.ok(shares[key] >= 0 && shares[key] <= 1, `${key} out of range at ${elo}`);
    }
  }
});

test('the beginner tiers carry the extra error mass', () => {
  const floor = qualityShares(100);
  assert.ok(floor.blunder > 0.55);
  assert.ok(floor.best < 0.02);

  const sevenHundred = qualityShares(700);
  const errorRate =
    sevenHundred.blunder + sevenHundred.mistake + sevenHundred.inaccuracy;
  assert.ok(errorRate > 0.55 && errorRate < 0.61, `700 error rate ${errorRate}`);
  assert.ok(
    sevenHundred.blunder >= 0.2 && sevenHundred.blunder <= 0.25,
    `700 blunder share ${sevenHundred.blunder}`,
  );

  /* The boost is gone at exactly 1000, where the smooth curves take over. */
  assert.equal(beginnerScaling(BEGINNER_VULNERABILITY_ELO).errors, 1);
  assert.equal(beginnerScaling(BEGINNER_VULNERABILITY_ELO).blunder, 1);
  assert.equal(beginnerScaling(BEGINNER_BLUNDER_ELO).blunder, 1);
  assert.ok(beginnerScaling(700).errors > 1);
  assert.ok(beginnerScaling(700).blunder > beginnerScaling(700).errors);

  const oneThousand = qualityShares(1000);
  assert.ok(Math.abs(oneThousand.blunder - 0.122) < 0.01);
  assert.ok(oneThousand.best > 0.04);

  const ceiling = qualityShares(2800);
  assert.ok(ceiling.blunder < 0.005);
  assert.ok(ceiling.mistake < 0.03);
  assert.ok(Math.abs(ceiling.inaccuracy - 0.035) < 0.002);
  assert.ok(Math.abs(ceiling.excellent - 0.33) < 0.002);
  assert.ok(ceiling.best > 0.5);
});

test('the error rate falls and Best rises as the rating climbs', () => {
  let previousError = 1;
  for (let elo = ELO_MIN; elo <= ELO_MAX; elo += 100) {
    const { errorRate } = humanCalibration(elo);
    assert.ok(errorRate < previousError, `error rate rose at ${elo}`);
    previousError = errorRate;
  }

  /* Blunders collapse fastest of the three error buckets. */
  assert.ok(qualityShares(400).blunder > qualityShares(1400).blunder * 3);
  assert.ok(qualityShares(100).best < qualityShares(1400).best);
  assert.ok(qualityShares(1400).best < qualityShares(2800).best);
});

test('a quality roll lands inside the bucket it names', () => {
  const uniform: QualityShares = {
    blunder: 1 / 6,
    mistake: 1 / 6,
    inaccuracy: 1 / 6,
    good: 1 / 6,
    excellent: 1 / 6,
    best: 1 / 6,
  };
  assert.equal(pickCategory(0, uniform), 'best');
  assert.equal(pickCategory(0.2, uniform), 'excellent');
  assert.equal(pickCategory(0.35, uniform), 'good');
  assert.equal(pickCategory(0.55, uniform), 'inaccuracy');
  assert.equal(pickCategory(0.7, uniform), 'mistake');
  assert.equal(pickCategory(0.99, uniform), 'blunder');

  for (const elo of [100, 700, 1500, 2800]) {
    const shares = qualityShares(elo);
    assert.equal(pickCategory(0, shares), 'best');
    assert.equal(pickCategory(0.999999, shares), 'blunder');
  }
});

test('the win-drop bands are the six shared review thresholds', () => {
  assert.equal(QUALITY_BANDS.best, 0.4);
  assert.equal(QUALITY_BANDS.excellent, 1.8);
  assert.equal(QUALITY_BANDS.good, 4.5);
  assert.equal(QUALITY_BANDS.inaccuracy, 10);
  assert.equal(QUALITY_BANDS.mistake, 20);
  assert.equal(bucketFor(0), 'best');
  assert.equal(bucketFor(0.39), 'best');
  assert.equal(bucketFor(0.4), 'excellent');
  assert.equal(bucketFor(1.79), 'excellent');
  assert.equal(bucketFor(1.8), 'good');
  assert.equal(bucketFor(4.49), 'good');
  assert.equal(bucketFor(4.5), 'inaccuracy');
  assert.equal(bucketFor(9.9), 'inaccuracy');
  assert.equal(bucketFor(10), 'mistake');
  assert.equal(bucketFor(19.9), 'mistake');
  assert.equal(bucketFor(20), 'blunder');
  assert.equal(bucketFor(60), 'blunder');
});

test('phase and time control scale the error buckets, not the rating', () => {
  assert.equal(phaseForMoveNumber(8), 'opening');
  assert.equal(phaseForMoveNumber(9), 'middlegame');
  assert.equal(phaseForMoveNumber(33), 'endgame');
  assert.equal(phaseMultiplier('opening', 1100), 0.7);
  assert.equal(phaseMultiplier('opening', 1800), 0.4);
  assert.equal(phaseMultiplier('middlegame'), 1.2);
  assert.equal(phaseMultiplier('endgame'), 0.95);

  const base = humanCalibration(800);
  const middlegame = plan(800);
  assert.ok(middlegame.errorRate > base.errorRate);
  assert.ok(middlegame.errorRate > 0.55 && middlegame.errorRate < 0.75);
  assert.ok(Math.abs(sharesSum(middlegame.quality) - 1) < 1e-9);

  const opening = plan(800, { moveNumber: 3 });
  assert.ok(opening.errorRate < middlegame.errorRate);

  const blitz = plan(800, { timeControlCategory: 'blitz' });
  const rapid = plan(800, { timeControlCategory: 'rapid' });
  assert.ok(blitz.errorRate > rapid.errorRate);
  assert.ok(rapid.errorRate > middlegame.errorRate);
});

test('a rating multiplier moves mass through the quality buckets', () => {
  const base = qualityShares(1200);
  const worse = scaleErrors(base, 1.5);
  const better = scaleErrors(base, 0.5);

  const errorOf = (shares: QualityShares) =>
    shares.blunder + shares.mistake + shares.inaccuracy;

  assert.ok(errorOf(worse) > errorOf(base));
  assert.ok(errorOf(better) < errorOf(base));
  assert.ok(worse.best < base.best);
  assert.ok(better.best > base.best);
  assert.ok(Math.abs(sharesSum(worse) - 1) < 1e-9);
  assert.ok(Math.abs(sharesSum(better) - 1) < 1e-9);

  /* The three error buckets keep their relative weights. */
  assert.ok(Math.abs(base.mistake / base.blunder - worse.mistake / worse.blunder) < 1e-9);
});

test('depth and temperature follow the skill curve', () => {
  assert.equal(humanCalibration(100).depth, 2);
  assert.equal(humanCalibration(300).depth, 2);
  assert.equal(humanCalibration(700).depth, 3);
  assert.equal(humanCalibration(900).depth, 3);
  assert.equal(humanCalibration(1000).depth, 5);
  assert.equal(humanCalibration(2800).depth, 14);
  assert.ok([4, 5].includes(humanCalibration(1100).depth));
  assert.equal(humanSearchDepth(1100, -2), 3);
  assert.equal(humanSearchDepth(2800, -3), 11);
  assert.ok(Math.abs(humanCalibration(100).temperature - 1.35) < 1e-9);
  assert.ok(Math.abs(humanCalibration(2800).temperature - 0.2467) < 0.002);
  assert.ok(humanCalibration(2800).temperature >= 0.2);

  assert.equal(plan(100, { timeControlCategory: 'bullet' }).depth, 2);
  assert.equal(plan(800, { timeControlCategory: 'blitz' }).depth, 2);
});

test('time trouble raises the error rate, bolds the errors and rushes', () => {
  const calm = plan(1100);
  const trouble = plan(1100, { remainingTimeMs: 20_000, incrementMs: 0 });

  assert.equal(trouble.timeTrouble, true);
  assert.ok(trouble.errorRate > calm.errorRate);
  assert.ok(trouble.quality.blunder > calm.quality.blunder);
  assert.ok(Math.abs(sharesSum(trouble.quality) - 1) < 1e-9);
  assert.equal(trouble.depth, 3);
  assert.ok(trouble.thinkTimeMs >= 250 && trouble.thinkTimeMs <= 850);

  assert.equal(plan(800, { remainingTimeMs: 20_000, incrementMs: 10_000 }).timeTrouble, false);
});

test('position kind is read from the board before searching', () => {
  assert.equal(positionKind(FORCED_FEN), 'forced');
  assert.equal(positionKind(RECAPTURE_FEN, { to: 'e4', captured: 'p' }), 'recapture');
  assert.equal(positionKind(SHARP_FEN), 'sharp');
  assert.equal(positionKind(START_FEN), 'quiet');
});

test('thinking time is randomized per position and time control', () => {
  assert.equal(plan(800, { fen: FORCED_FEN }).thinkTimeMs, 600);
  assert.equal(plan(800).thinkTimeMs, 2650);
  assert.equal(plan(800, { timeControlCategory: 'blitz' }).thinkTimeMs, 663);
  assert.equal(plan(800, { fen: SHARP_FEN }).thinkTimeMs, 7500);
  assert.equal(plan(800, { fen: SHARP_FEN, remainingTimeMs: 60_000 }).thinkTimeMs, 7200);
});

test('an obvious recapture follows the rating curve, not a switch', () => {
  assert.ok(Math.abs(recaptureChance(100) - 0.12) < 1e-9);
  assert.ok(Math.abs(recaptureChance(400) - 0.32) < 0.02);
  assert.ok(Math.abs(recaptureChance(700) - 0.46) < 0.02);
  assert.ok(Math.abs(recaptureChance(1000) - 0.75) < 0.03);
  assert.ok(recaptureChance(2400) > 0.9);
  assert.ok(recaptureChance(2800) < 1);

  let previous = 0;
  for (let elo = ELO_MIN; elo <= ELO_MAX; elo += 100) {
    const value = recaptureChance(elo);
    assert.ok(value > previous, `recapture chance fell at ${elo}`);
    previous = value;
  }

  const candidates = [candidate('d5e4', -30), candidate('g8f6', 0)];
  const lastMove = { to: 'e4', captured: 'p' };

  const strong = selectHumanBotMove({
    fen: RECAPTURE_FEN,
    elo: 2400,
    candidates,
    lastMove,
    plan: plan(2400, { fen: RECAPTURE_FEN, lastMove }),
    random: () => 0,
  });
  assert.equal(strong.kind, 'recapture');
  assert.equal(strong.uci, 'd5e4');

  const beginner = selectHumanBotMove({
    fen: RECAPTURE_FEN,
    elo: 100,
    candidates,
    lastMove,
    plan: plan(100, { fen: RECAPTURE_FEN, lastMove }),
    random: () => 0.5,
  });
  assert.notEqual(beginner.kind, 'recapture');
});

test('a forced move is returned immediately', () => {
  const choice = selectHumanBotMove({
    fen: FORCED_FEN,
    elo: 800,
    candidates: [candidate('a2a3', 20)],
    random: () => 0,
  });
  assert.equal(choice.kind, 'forced');
  assert.equal(choice.uci, 'a1b1');
});

test('move intent reads captures, checks and pawn pushes at the king', () => {
  const capture = moveIntent(RECAPTURE_FEN, 'd5e4');
  assert.ok(capture?.capture);
  assert.equal(hasHumanIntent(capture!, 30), true);

  /* A quiet a2a3 is not an attacking idea: the pawn walks away from the king. */
  const quiet = moveIntent(START_FEN, 'a2a3');
  assert.equal(quiet?.capture, false);
  assert.equal(quiet?.check, false);
  assert.equal(hasHumanIntent(quiet!, 30), false);

  /* A pawn on the fifth rank stepping at the king is a forward attack. */
  const forward = moveIntent('4k3/8/8/4P3/8/8/8/4K3 w - - 0 1', 'e5e6');
  assert.equal(forward?.pawnTowardKing, true);
  assert.equal(hasHumanIntent(forward!, 12), true);
});

test('club-level errors must be intended or shallow-attractive', () => {
  const candidates = [candidate('e2e4', 0), candidate('a2a3', -400)];

  /* 1100: the quiet pawn push loses a piece but has no human point and was not
     a shallow favourite, so the roll is downgraded to the best move. */
  const club = selectHumanBotMove({
    fen: START_FEN,
    elo: 1100,
    candidates,
    plan: plan(1100),
    forcedBucket: 'blunder',
    shallowRank: ['e2e4'],
    random: () => 0.5,
  });
  assert.equal(club.uci, 'e2e4');
  assert.equal(club.kind, 'best');

  /* The same move is allowed when the shallow search liked it. */
  const attractive = selectHumanBotMove({
    fen: START_FEN,
    elo: 1100,
    candidates,
    plan: plan(1100),
    forcedBucket: 'blunder',
    shallowRank: ['a2a3', 'e2e4'],
    random: () => 0.5,
  });
  assert.equal(attractive.uci, 'a2a3');
  assert.equal(attractive.kind, 'blunder');
});

test('a blunder needs a human idea at club level, but a beginner may just drop a piece', () => {
  const candidates = [candidate('e2e4', 0), candidate('a2a3', -400)];

  const beginner = selectHumanBotMove({
    fen: START_FEN,
    elo: 300,
    candidates,
    plan: plan(300),
    forcedBucket: 'blunder',
    random: () => 0.5,
  });
  assert.equal(beginner.uci, 'a2a3');
  assert.equal(beginner.kind, 'blunder');
  assert.ok(beginner.winDrop >= QUALITY_BANDS.blunder);
});

test('a greedy capture that fails tactically is a legal club-level blunder', () => {
  const choice = selectHumanBotMove({
    fen: RECAPTURE_FEN,
    elo: 1100,
    candidates: [candidate('d5e4', 0), candidate('b8c6', -10)],
    /* White-POV scores: the capture leaves White a queen up. */
    reference: new Map([
      ['d5e4', 600],
      ['b8c6', 0],
    ]),
    plan: plan(1100, { fen: RECAPTURE_FEN }),
    forcedBucket: 'blunder',
    random: () => 0.5,
  });

  assert.equal(choice.uci, 'd5e4');
  assert.equal(choice.kind, 'blunder');
  assert.ok(choice.winDrop >= QUALITY_BANDS.blunder);
});

test('a 1500+ slip must be one of the first four shallow lines', () => {
  const candidates = [candidate('e2e4', 0), candidate('a2a3', -400)];

  const deepSlip = selectHumanBotMove({
    fen: START_FEN,
    elo: 1800,
    candidates,
    plan: plan(1800),
    forcedBucket: 'blunder',
    shallowRank: ['e2e4'],
    random: () => 0.5,
  });
  assert.equal(deepSlip.uci, 'e2e4');
  assert.equal(deepSlip.kind, 'best');

  const calculated = selectHumanBotMove({
    fen: START_FEN,
    elo: 1800,
    candidates,
    plan: plan(1800),
    forcedBucket: 'blunder',
    shallowRank: ['a2a3', 'e2e4'],
    random: () => 0.5,
  });
  assert.equal(calculated.uci, 'a2a3');
  assert.equal(calculated.kind, 'blunder');
});

test('a shallow favourite is still a mistake when the band is milder', () => {
  /* a2a3 is ~7% worse than e2e4: an inaccuracy band, allowed as a top-six
     shallow choice at club level. */
  const candidates = [candidate('e2e4', 0), candidate('a2a3', -80)];
  const choice = selectHumanBotMove({
    fen: START_FEN,
    elo: 1100,
    candidates,
    plan: plan(1100),
    forcedBucket: 'inaccuracy',
    shallowRank: ['a2a3', 'e2e4'],
    random: () => 0.5,
  });
  assert.equal(choice.uci, 'a2a3');
  assert.equal(choice.kind, bucketFor(choice.winDrop));
  assert.equal(choice.kind, 'inaccuracy');
});

test('an empty band falls through to a milder one instead of a bizarre move', () => {
  /* No candidate is 20%+ worse, so the blunder roll becomes a best move. */
  const candidates = [candidate('e2e4', 0), candidate('d2d4', -10)];
  const choice = selectHumanBotMove({
    fen: START_FEN,
    elo: 1100,
    candidates,
    plan: plan(1100),
    forcedBucket: 'blunder',
    shallowRank: ['e2e4', 'd2d4'],
    random: () => 0.5,
  });
  /* d2d4 is 0.9% worse, an Excellent, so the blunder roll lands there. */
  assert.equal(choice.uci, 'd2d4');
  assert.equal(choice.kind, 'excellent');
});

test('the #1 line is damped below 1500 and quality picks stay inside their band', () => {
  assert.equal(topLineDamping(1500), 1);
  assert.equal(topLineDamping(2200), 1);
  assert.ok(topLineDamping(100) < topLineDamping(1100));
  assert.ok(topLineDamping(1100) < topLineDamping(1400));
  assert.ok(Math.abs(topLineDamping(1249) - topLineDamping(1250)) < 0.01);

  assert.equal(errorTemperatureBoost(1100), ERROR_TEMPERATURE_BOOST_LOW);
  assert.equal(errorTemperatureBoost(1250), ERROR_TEMPERATURE_BOOST);
  assert.ok(ERROR_TEMPERATURE_BOOST_LOW > ERROR_TEMPERATURE_BOOST);

  const candidates = [
    candidate('e2e4', 0),
    candidate('d2d4', -2),
    candidate('b1c3', -3),
  ];
  const play = (elo: number) =>
    selectHumanBotMove({
      fen: START_FEN,
      elo,
      candidates,
      plan: plan(elo),
      forcedBucket: 'best',
      random: () => 0.5,
    });

  const strong = play(2200);
  const weak = play(100);
  assert.ok(strong.weights[0].weight > weak.weights[0].weight);
  const total = weak.weights.reduce((sum, entry) => sum + entry.weight, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
  assert.equal(strong.kind, 'best');
  assert.ok(strong.winDrop < QUALITY_BANDS.best);
});

test('a mating line is never played and the mate guard is rating-gated', () => {
  assert.equal(allowsMateInOne(MATE_IN_ONE_FEN, 'f2f3'), true);
  assert.equal(allowsMateInOne(MATE_IN_ONE_FEN, 'h2h3'), false);
  assert.ok(SELF_MATE_GUARD_ELO <= 1000);

  const choice = selectHumanBotMove({
    fen: START_FEN,
    elo: 1200,
    candidates: [candidate('e2e4', 0), candidate('g1f3', 30, -1)],
    plan: plan(1200),
    forcedBucket: 'best',
    random: () => 0.5,
  });
  assert.notEqual(choice.uci, 'g1f3');
});

test('win probability is 50% at a dead level and rises with the score', () => {
  assert.equal(winProbability(0), 50);
  assert.ok(winProbability(300) > winProbability(100));
  assert.ok(winProbability(-300) < 50);
  assert.ok(HUMAN_MULTI_PV >= 10);
});

test('phase levels carry the documented offsets and error multipliers', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((level) => PHASE_LEVELS_META[level as 1 | 2 | 3 | 4 | 5].eloOffset),
    [-200, -100, 0, 100, 175],
  );
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((level) => phaseErrorMultiplier(level as 1 | 2 | 3 | 4 | 5)),
    [1.35, 1.15, 1, 0.82, 0.68],
  );
});

test('the effective phase rating is capped by the card rating', () => {
  assert.equal(getEffectivePhaseElo(700, 5), 875);
  assert.equal(getEffectivePhaseElo(700, 4), 800);
  assert.equal(getEffectivePhaseElo(700, 1), 500);
  assert.equal(getEffectivePhaseElo(600, 5), 750);
  assert.equal(getEffectivePhaseElo(100, 1), 100);
  assert.equal(getEffectivePhaseElo(2000, 5), 2175);
  assert.equal(getEffectivePhaseElo(2800, 5), 2800);
  assert.equal(getEffectivePhaseElo(1200, 3), 1200);
});

test('a game rolls three distinct phase levels below 1600 Elo', () => {
  const sequence = (values: number[]) => {
    let index = 0;
    return () => values[index++] ?? 0.5;
  };
  const profile = rollPhaseProfile(1200, sequence([0, 0.2, 0.4]));
  const levels = [profile.opening, profile.middlegame, profile.endgame];
  assert.deepEqual(levels, [1, 2, 4]);
  assert.equal(new Set(levels).size, 3);

  /* Sampling with replacement only starts at 1600. */
  assert.equal(PHASE_DISTINCT_ELO, 1600);
  const strong = rollPhaseProfile(1800, sequence([0.99, 0.99, 0.99]));
  assert.deepEqual(
    [strong.opening, strong.middlegame, strong.endgame],
    [5, 5, 5],
  );
});

test('a low-rated bot never collapses in more than one phase', () => {
  assert.equal(PHASE_ONE_BAD_ELO, 1400);
  let badSeeds = 0;
  for (let index = 0; index < 300; index += 1) {
    for (const elo of [100, 700, 1100, 1400]) {
      const profile = rollPhaseProfile(elo);
      const levels = [profile.opening, profile.middlegame, profile.endgame];
      assert.ok(
        levels.filter((level) => level === 1).length <= 1,
        `two Level 1 phases at ${elo}`,
      );
      if (levels.includes(1)) badSeeds += 1;
      if (elo < PHASE_DISTINCT_ELO) assert.equal(new Set(levels).size, 3);
    }
  }
  assert.ok(badSeeds > 0);

  /* Level 1 is rare from 1600 up. */
  let bad = 0;
  for (let index = 0; index < 500; index += 1) {
    const profile = rollPhaseProfile(2000);
    bad += [profile.opening, profile.middlegame, profile.endgame].filter(
      (level) => level === 1,
    ).length;
  }
  assert.ok(bad / 500 <= 0.2, `Level 1 drawn too often: ${bad}/1500 phases`);
});

test('the plan plays at the phase rating, not the card rating', () => {
  const profile = { opening: 4, middlegame: 1, endgame: 5 } as const;
  const opening = plan(1200, { moveNumber: 3, phaseProfile: profile });
  assert.equal(opening.phaseLevel, 4);
  assert.equal(opening.effectiveElo, 1300);
  assert.equal(opening.calibration.elo, 1300);
  assert.equal(opening.depth, humanSearchDepth(1300));

  const middlegame = plan(1200, { moveNumber: 20, phaseProfile: profile });
  const onRating = plan(1200, { moveNumber: 20 });
  assert.equal(middlegame.phaseLevel, 1);
  assert.equal(middlegame.effectiveElo, 1000);
  assert.ok(middlegame.errorRate > onRating.errorRate);
  assert.ok(middlegame.depth <= onRating.depth);

  /* No profile means no change at all. */
  const plain = plan(1200, { moveNumber: 20 });
  assert.equal(plain.phaseLevel, 3);
  assert.equal(plain.effectiveElo, 1200);
});

test('the debug summary reads the rolled profile', () => {
  assert.equal(
    describePhaseProfile(700, { opening: 4, middlegame: 1, endgame: 5 }),
    'O: L4 (800) | M: L1 (500) | E: L5 (875)',
  );
  assert.equal(
    describePhaseProfile(1200, { opening: 4, middlegame: 1, endgame: 5 }),
    'O: L4 (1300) | M: L1 (1000) | E: L5 (1375)',
  );
});

test('the last capture is read from the game history', () => {
  const game = new Chess();
  game.move('e4');
  game.move('d5');
  game.move('exd5');
  assert.deepEqual(lastCaptureOf(game), { to: 'd5', captured: 'p' });

  const quiet = new Chess();
  quiet.move('e4');
  assert.equal(lastCaptureOf(quiet), null);
});

test('below 1000 USCF the top two engine moves are suppressed', () => {
  assert.equal(BEGINNER_VULNERABILITY_ELO, 1000);
  assert.equal(BEGINNER_DEPTH_ELO, 1000);
  assert.equal(BEGINNER_TOP_WEIGHT, 0.08);
  assert.equal(BEGINNER_SECOND_WEIGHT, 0.25);

  const weights = [
    { uci: 'e2e4', weight: 0.52, cpLoss: 0, winDrop: 0 },
    { uci: 'd2d4', weight: 0.3, cpLoss: 2, winDrop: 0.2 },
    { uci: 'b1c3', weight: 0.18, cpLoss: 3, winDrop: 0.3 },
  ];
  const beginner = suppressTopLines(weights, 700);
  /* The #1 line drops behind the third choice: that is the beginner drift. */
  assert.ok(beginner[0].weight < beginner[2].weight);
  assert.ok(beginner[0].weight < weights[0].weight / 2);
  assert.ok(Math.abs(beginner.reduce((sum, entry) => sum + entry.weight, 0) - 1) < 1e-9);
  assert.deepEqual(
    suppressTopLines(weights, 2200).map((entry) => entry.weight),
    weights.map((entry) => entry.weight),
  );

  const candidates = [candidate('e2e4', 0), candidate('d2d4', -2), candidate('b1c3', -3)];
  const play = (elo: number) =>
    selectHumanBotMove({
      fen: START_FEN,
      elo,
      candidates,
      plan: plan(elo),
      forcedBucket: 'best',
      random: () => 0.9,
    });

  const weak = play(700);
  const strong = play(2200);
  assert.ok(weak.weights[0].weight < strong.weights[0].weight / 2);
  assert.notEqual(weak.uci, 'e2e4');
});

test('the beginner tier and the time-control bands are the documented ones', () => {
  assert.equal(BEGINNER_ELO, 600);
  assert.equal(DEEP_SLIP_ELO, 1500);
  assert.equal(timeControlCategory(2 * 60_000), 'bullet');
  assert.equal(timeControlCategory(5 * 60_000), 'blitz');
  assert.equal(timeControlCategory(10 * 60_000), 'rapid');
  assert.equal(timeControlCategory(30 * 60_000), 'classical');
  assert.deepEqual(timeControlScaling('classical'), {
    category: 'classical',
    tcMult: 1,
    depthOffset: 0,
    timeScale: 1,
  });
  assert.equal(timeControlScaling('bullet').tcMult, 1.8);
  assert.equal(timeControlScaling('blitz').depthOffset, -2);
});
