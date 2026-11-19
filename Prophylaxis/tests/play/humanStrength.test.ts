import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import {
  ERROR_TEMPERATURE_BOOST,
  ERROR_TEMPERATURE_BOOST_LOW,
  HUMAN_MULTI_PV,
  RECAPTURE_CHANCE,
  SOLID_TEMPERATURE_BOOST,
  SOLID_TEMPERATURE_BOOST_LOW,
  RECAPTURE_CHANCE_LOW,
  SELF_MATE_GUARD_ELO,
  allowsMateInOne,
  bucketFor,
  clampElo,
  errorTemperatureBoost,
  humanCalibration,
  humanSearchDepth,
  lastCaptureOf,
  phaseForMoveNumber,
  phaseMultiplier,
  planHumanSearch,
  recaptureChance,
  positionKind,
  selectHumanBotMove,
  timeControlCategory,
  timeControlScaling,
  topLineDamping,
  winProbability,
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

test('the Bad Move Index follows the documented exponential curve', () => {
  assert.ok(Math.abs(humanCalibration(400).badMoveIndex - 0.82) < 0.002);
  assert.ok(Math.abs(humanCalibration(800).badMoveIndex - 0.5806) < 0.002);
  assert.ok(Math.abs(humanCalibration(1100).badMoveIndex - 0.4506) < 0.002);
  assert.ok(Math.abs(humanCalibration(1400).badMoveIndex - 0.3516) < 0.002);
  assert.ok(Math.abs(humanCalibration(1900).badMoveIndex - 0.2372) < 0.002);
  assert.ok(Math.abs(humanCalibration(2000).badMoveIndex - 0.22) < 0.002);
  assert.ok(Math.abs(humanCalibration(2800).badMoveIndex - 0.1264) < 0.002);

  /* A 1100 USCF club player errs noticeably more often than the old curve. */
  assert.ok(humanCalibration(1100).badMoveIndex > 0.42);

  /* Continuous and monotonic between the anchors. */
  let previous = 1;
  for (let elo = 400; elo <= 2800; elo += 100) {
    const value = humanCalibration(elo).badMoveIndex;
    assert.ok(value < previous, `bad move index rose at ${elo}`);
    previous = value;
  }
});

test('the rating is clamped to 400-2800 and normalizes skill', () => {
  assert.equal(clampElo(120), 400);
  assert.equal(clampElo(3300), 2800);
  assert.equal(humanCalibration(120).elo, 400);
  assert.equal(humanCalibration(120).skill, 0);
  assert.equal(humanCalibration(3300).skill, 1);
  assert.equal(clampElo(Number.NaN), 1500);
});

test('the Move Range Index is normalized and severity-ordered', () => {
  for (const elo of [400, 800, 1400, 2000, 2800]) {
    const { shares } = humanCalibration(elo);
    const total = shares.inaccuracy + shares.mistake + shares.blunder;
    assert.ok(Math.abs(total - 1) < 1e-9, `shares do not sum to 1 at ${elo}`);
    assert.ok(shares.inaccuracy > 0 && shares.mistake > 0 && shares.blunder > 0);
  }

  /* A beginner blunders about as often as it makes a plain mistake; a strong
     player's errors are overwhelmingly small. */
  const beginner = humanCalibration(400).shares;
  assert.ok(beginner.blunder > 0.45);
  assert.ok(beginner.mistake > beginner.inaccuracy);

  const club = humanCalibration(1100).shares;
  assert.ok(club.inaccuracy > club.mistake);
  assert.ok(club.mistake > club.blunder);
  assert.ok(Math.abs(club.inaccuracy - 0.495) < 0.005);
  assert.ok(Math.abs(club.mistake - 0.338) < 0.005);
  assert.ok(Math.abs(club.blunder - 0.167) < 0.005);

  const expert = humanCalibration(2800).shares;
  assert.ok(expert.blunder < 0.02);
  assert.ok(expert.inaccuracy > 0.8);
});

test('depth and temperature follow the skill curve', () => {
  assert.equal(humanCalibration(400).depth, 2);
  assert.equal(humanCalibration(800).depth, 3);
  /* A sub-1500 bot never searches as deep as a 1600+ tournament player. */
  assert.equal(humanCalibration(1100).depth, 4);
  assert.ok(humanCalibration(1400).depth <= 6);
  for (let elo = 400; elo < 1500; elo += 50) {
    assert.ok(humanCalibration(elo).depth <= 6, `depth ${elo}`);
  }
  assert.equal(humanCalibration(2800).depth, 14);
  assert.equal(humanSearchDepth(1100), 4);
  assert.equal(humanSearchDepth(1100, -2), 2);
  assert.equal(humanSearchDepth(2800, -3), 11);
  assert.ok(Math.abs(humanCalibration(400).temperature - 1.35) < 1e-9);
  assert.ok(Math.abs(humanCalibration(2800).temperature - 0.247) < 0.002);
  assert.ok(Math.abs(humanCalibration(800).temperature - 1.017) < 0.002);
  assert.ok(humanCalibration(2800).temperature >= 0.2);
});

test('phase and time control scale the error budget', () => {
  assert.equal(phaseForMoveNumber(8), 'opening');
  assert.equal(phaseForMoveNumber(9), 'middlegame');
  assert.equal(phaseForMoveNumber(33), 'endgame');
  /* Sub-1400 bots err in the opening too; stronger ones keep it tidy. */
  assert.equal(phaseMultiplier('opening', 1100), 0.7);
  assert.equal(phaseMultiplier('opening'), 0.4);
  assert.equal(phaseMultiplier('opening', 1800), 0.4);
  assert.equal(phaseMultiplier('middlegame'), 1.2);
  assert.equal(phaseMultiplier('endgame'), 0.95);

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

  const middlegame = plan(800);
  assert.ok(Math.abs(middlegame.badMoveProb - 0.5806 * 1.2) < 0.002);
  assert.equal(middlegame.depth, 3);

  const opening = plan(800, { moveNumber: 3 });
  assert.ok(Math.abs(opening.badMoveProb - 0.5806 * 0.7) < 0.002);

  const blitz = plan(800, { timeControlCategory: 'blitz' });
  /* The blitz multiplier pushes an 800 past the 0.85 ceiling. */
  assert.equal(blitz.badMoveProb, 0.85);
  assert.equal(blitz.depth, 2);

  /* 1100 USCF lands on the 4-5 ply band the recalibration targets. */
  assert.ok([4, 5].includes(plan(1100).depth));

  /* Bullet plus the depth floor. */
  assert.equal(plan(400, { timeControlCategory: 'bullet' }).depth, 2);
});

test('time trouble raises the error rate, bolds the blunder share and rushes', () => {
  const calm = plan(800);
  const trouble = plan(800, { remainingTimeMs: 20_000, incrementMs: 0 });

  assert.equal(trouble.timeTrouble, true);
  /* 1.5x would clear the ceiling at 800 USCF; the cap is what holds. */
  assert.equal(trouble.badMoveProb, 0.85);
  assert.ok(trouble.badMoveProb >= calm.badMoveProb);
  assert.ok(trouble.shares.blunder > calm.shares.blunder);
  const total = trouble.shares.inaccuracy + trouble.shares.mistake + trouble.shares.blunder;
  assert.ok(Math.abs(total - 1) < 1e-9);
  assert.equal(trouble.depth, 3);
  assert.ok(trouble.thinkTimeMs >= 250 && trouble.thinkTimeMs <= 850);

  /* A healthy increment means the clock is not pressing. */
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

  /* Never more than 12% of the clock on one turn. */
  assert.equal(plan(800, { fen: SHARP_FEN, remainingTimeMs: 60_000 }).thinkTimeMs, 7200);

  const longThink = planHumanSearch({
    fen: START_FEN,
    elo: 800,
    moveNumber: 20,
    timeControlCategory: 'classical',
    remainingTimeMs: null,
    incrementMs: 0,
    random: (() => {
      const values = [0.5, 0.1];
      return () => values.shift() ?? 0.5;
    })(),
  });
  assert.equal(longThink.thinkTimeMs, 3975);
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

test('an obvious recapture is taken from 550 Elo up, and can be missed below', () => {
  const lastMove = { to: 'e4', captured: 'p' };
  const candidates = [candidate('d5e4', -30), candidate('g8f6', 0), candidate('b8c6', 10)];

  const recapture = selectHumanBotMove({
    fen: RECAPTURE_FEN,
    elo: 800,
    candidates,
    lastMove,
    plan: plan(800, { fen: RECAPTURE_FEN, lastMove }),
    random: () => 0,
  });
  assert.equal(recapture.kind, 'recapture');
  assert.equal(recapture.uci, 'd5e4');

  const weak = selectHumanBotMove({
    fen: RECAPTURE_FEN,
    elo: 500,
    candidates,
    lastMove,
    plan: plan(500, { fen: RECAPTURE_FEN, lastMove }),
    random: () => 0.9,
  });
  assert.notEqual(weak.kind, 'recapture');
});

test('a bad-move roll takes the bucket the Move Range Index asked for', () => {
  const candidates = [
    candidate('e2e4', 0),
    candidate('b1c3', -40),
    candidate('a2a4', -120), // ~11% win drop: inaccuracy
    candidate('d2d4', -200), // ~18% win drop: mistake
    candidate('g1f3', -400), // ~31% win drop: blunder
    candidate('h2h3', -700),
  ];
  const base = plan(800);

  assert.ok(base.shares.inaccuracy > 0.25 && base.shares.blunder > 0.2);

  /* roll below the bad-move probability, then a category roll in the blunder
     tail (inaccuracy + mistake shares), then the weighted pick. */
  const blunder = selectHumanBotMove({
    fen: START_FEN,
    elo: 800,
    candidates,
    plan: base,
    random: (() => {
      const values = [0, 0.9, 0];
      return () => values.shift() ?? 0;
    })(),
  });
  assert.equal(blunder.kind, 'blunder');
  assert.ok(blunder.winDrop >= 22);

  const mistake = selectHumanBotMove({
    fen: START_FEN,
    elo: 800,
    candidates,
    plan: base,
    random: (() => {
      const values = [0, 0.6, 0];
      return () => values.shift() ?? 0;
    })(),
  });
  assert.equal(mistake.kind, 'mistake');
  assert.ok(mistake.winDrop >= 12 && mistake.winDrop < 22);

  const inaccuracy = selectHumanBotMove({
    fen: START_FEN,
    elo: 800,
    candidates,
    plan: base,
    random: (() => {
      const values = [0, 0.1, 0];
      return () => values.shift() ?? 0;
    })(),
  });
  assert.equal(inaccuracy.kind, 'inaccuracy');
  assert.ok(inaccuracy.winDrop >= 5 && inaccuracy.winDrop < 12);
});

test('the #1 line is damped below 1500 so sub-1500 bots drift', () => {
  assert.equal(topLineDamping(1500), 1);
  assert.equal(topLineDamping(2200), 1);
  assert.ok(Math.abs(topLineDamping(400) - 0.3637) < 0.002);
  assert.ok(Math.abs(topLineDamping(1100) - 0.6689) < 0.002);
  assert.ok(topLineDamping(1100) < topLineDamping(1400));

  /* The club-level band damps harder than the plain sub-1500 curve and still
     meets it continuously at the boundary. */
  assert.ok(Math.abs(topLineDamping(1249) - topLineDamping(1250)) < 0.01);
  assert.ok(topLineDamping(1100) < 0.35 + 0.65 * (1100 / 1500));

  /* Error turns spread wider inside their band below 1250. */
  assert.equal(errorTemperatureBoost(1100), ERROR_TEMPERATURE_BOOST_LOW);
  assert.equal(errorTemperatureBoost(1250), ERROR_TEMPERATURE_BOOST);
  assert.equal(errorTemperatureBoost(1800), ERROR_TEMPERATURE_BOOST);
  assert.ok(ERROR_TEMPERATURE_BOOST_LOW > ERROR_TEMPERATURE_BOOST);
  assert.ok(SOLID_TEMPERATURE_BOOST_LOW > SOLID_TEMPERATURE_BOOST);

  const candidates = [
    candidate('e2e4', 0),
    candidate('d2d4', -10),
    candidate('b1c3', -20),
    candidate('a2a3', -30),
  ];
  const play = (elo: number) =>
    selectHumanBotMove({
      fen: START_FEN,
      elo,
      candidates,
      plan: plan(elo),
      random: (() => {
        const values = [0.99, 0.5];
        return () => values.shift() ?? 0.99;
      })(),
    });

  const strong = play(2200);
  const weak = play(400);
  assert.equal(strong.weights[0].uci, 'e2e4');
  assert.ok(weak.weights[0].weight < strong.weights[0].weight);
  /* The second choice gains relative weight, which is the human drift. */
  assert.ok(
    weak.weights[1].weight / weak.weights[0].weight >
      strong.weights[1].weight / strong.weights[0].weight,
  );
  const total = weak.weights.reduce((sum, entry) => sum + entry.weight, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
});

test('an error roll with no matching bucket takes the move closest to that bucket', () => {
  /* Every candidate is inside the solid band: no inaccuracy, mistake or
     blunder exists, so the distance fallback decides — nearest to the rolled
     bucket's centre (28% for a blunder), which here is the worst line. */
  const candidates = [
    candidate('e2e4', 0),
    candidate('d2d4', -10),
    candidate('a2a3', -20),
    candidate('h2h3', -30),
  ];

  const choice = selectHumanBotMove({
    fen: START_FEN,
    elo: 800,
    candidates,
    plan: plan(800),
    random: (() => {
      const values = [0, 0.9, 0];
      return () => values.shift() ?? 0;
    })(),
  });

  assert.equal(choice.uci, 'h2h3', 'the candidate nearest the 28% blunder centre');
  assert.equal(choice.kind, bucketFor(choice.winDrop));
  assert.equal(choice.weights.length, 1);
});

test('reference scores decide severity while the shallow order keeps its pull', () => {
  const candidates = [candidate('e2e4', 0), candidate('d2d4', -10)];
  const choice = selectHumanBotMove({
    fen: START_FEN,
    elo: 800,
    candidates,
    plan: plan(800),
    reference: new Map([
      ['e2e4', -300],
      ['d2d4', 0],
    ]),
    random: (() => {
      const values = [0, 0.9, 0];
      return () => values.shift() ?? 0;
    })(),
  });

  /* The shallow search preferred e2e4; the reference pass says it loses a
     piece, so a blunder bucket exists and the roll lands in it. */
  assert.equal(choice.uci, 'e2e4');
  assert.equal(choice.kind, 'blunder');
  assert.ok(choice.winDrop >= 22);
});

test('a sub-1500 blunder roll asks for an off-list probe when nothing fits', () => {
  const candidates = [candidate('e2e4', 0), candidate('d2d4', -10)];

  const probe = selectHumanBotMove({
    fen: START_FEN,
    elo: 1100,
    candidates,
    plan: plan(1100),
    allowProbe: true,
    random: (() => {
      const values = [0, 0.9];
      return () => values.shift() ?? 0;
    })(),
  });
  assert.equal(probe.kind, 'probe');
  assert.equal(probe.uci, null);

  const noProbe = selectHumanBotMove({
    fen: START_FEN,
    elo: 1100,
    candidates,
    plan: plan(1100),
    random: (() => {
      const values = [0, 0.9, 0];
      return () => values.shift() ?? 0;
    })(),
  });
  assert.notEqual(noProbe.kind, 'probe');
  assert.ok(noProbe.uci);
});

test('recaptures are fumbled more often below 1300', () => {
  assert.equal(recaptureChance(1100), RECAPTURE_CHANCE_LOW);
  assert.equal(recaptureChance(1600), RECAPTURE_CHANCE);
});

test('a missing bucket falls back to the next milder one', () => {
  /* No candidate is 22% worse: blunder -> mistake. */
  const candidates = [candidate('e2e4', 0), candidate('d2d4', -150), candidate('g1f3', -190)];

  const choice = selectHumanBotMove({
    fen: START_FEN,
    elo: 800,
    candidates,
    plan: plan(800),
    random: (() => {
      const values = [0, 0.9, 0];
      return () => values.shift() ?? 0;
    })(),
  });

  assert.equal(choice.kind, 'mistake');
  assert.ok(choice.winDrop >= 12 && choice.winDrop < 22);
});

test('a solid turn only considers moves under a 5% win drop', () => {
  const candidates = [
    candidate('e2e4', 0),
    candidate('d2d4', -40),
    candidate('a2a3', -200),
  ];

  const strong = selectHumanBotMove({
    fen: START_FEN,
    elo: 2800,
    candidates,
    plan: plan(2800),
    random: (() => {
      const values = [0.99, 0.6];
      return () => values.shift() ?? 0.99;
    })(),
  });
  assert.equal(strong.kind, 'solid');
  assert.ok(strong.weights.every((entry) => entry.winDrop < 5));
  const total = strong.weights.reduce((sum, entry) => sum + entry.weight, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
  /* The 2800 leans on the best move much harder than a 400 would. */
  assert.ok(strong.weights[0].weight > 0.75);

  const weak = selectHumanBotMove({
    fen: START_FEN,
    elo: 400,
    candidates,
    plan: plan(400),
    random: (() => {
      const values = [0.99, 0.6];
      return () => values.shift() ?? 0.99;
    })(),
  });
  assert.ok(weak.weights[0].weight < strong.weights[0].weight);
});

test('a mating line is never played and the mate guard is rating-gated', () => {
  assert.equal(allowsMateInOne(MATE_IN_ONE_FEN, 'f2f3'), true);
  assert.equal(allowsMateInOne(MATE_IN_ONE_FEN, 'h2h3'), false);
  assert.ok(SELF_MATE_GUARD_ELO <= 1000);

  /* A candidate the engine reports as mated is dropped from every pool. */
  const choice = selectHumanBotMove({
    fen: START_FEN,
    elo: 800,
    candidates: [candidate('e2e4', 0), candidate('g1f3', 30, -1)],
    plan: plan(800),
    random: () => 0.99,
  });
  assert.notEqual(choice.uci, 'g1f3');
});

test('win-drop buckets match the Move Range Index bands', () => {
  assert.equal(bucketFor(0), 'solid');
  assert.equal(bucketFor(4.9), 'solid');
  assert.equal(bucketFor(5), 'inaccuracy');
  assert.equal(bucketFor(11.9), 'inaccuracy');
  assert.equal(bucketFor(12), 'mistake');
  assert.equal(bucketFor(21.9), 'mistake');
  assert.equal(bucketFor(22), 'blunder');
});

test('win probability is 50% at a dead level and rises with the score', () => {
  assert.equal(winProbability(0), 50);
  assert.ok(winProbability(300) > winProbability(100));
  assert.ok(winProbability(-300) < 50);
  assert.ok(HUMAN_MULTI_PV >= 10);
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
