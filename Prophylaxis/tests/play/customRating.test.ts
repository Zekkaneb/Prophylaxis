/**
 * The custom rating engine, checked against its own rules.
 *
 * Every case here is a sentence from the specification: the placement K, the
 * three standard bands, the streak multiplier, the milestone floors and the
 * bot-game scaling.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CALIBRATION_GAMES,
  MILESTONES,
  NEW_PLAYER_GAMES,
  NEW_PLAYER_K,
  RATING_MAX,
  RATING_MIN,
  applyResult,
  categoryForSeconds,
  earnedFloor,
  expectedScore,
  kFactorFor,
  ratingLabel,
  seedById,
} from '../../src/play/customRating.ts';

const base = {
  rating: 1200,
  streak: 0,
  /* A settled account: past the new-player K band, so the assertions below read
     the established-player curve. The boosted band has its own test. */
  gamesPlayed: 60,
  opponentRating: 1200,
  score: 1 as const,
};

test('categories follow the clock, and unlimited counts as classical', () => {
  assert.equal(categoryForSeconds(60), 'bullet');
  assert.equal(categoryForSeconds(120), 'bullet');
  assert.equal(categoryForSeconds(180), 'blitz');
  assert.equal(categoryForSeconds(540), 'blitz');
  assert.equal(categoryForSeconds(600), 'rapid');
  assert.equal(categoryForSeconds(1740), 'rapid');
  assert.equal(categoryForSeconds(1800), 'classical');
  assert.equal(categoryForSeconds(0, true), 'classical');
});

test('the expectation is standard Elo', () => {
  assert.equal(Number(expectedScore(1200, 1200).toFixed(4)), 0.5);
  assert.ok(expectedScore(1400, 1200) > 0.7);
  assert.ok(expectedScore(1000, 1200) < 0.3);
  /* 400 points is the familiar 10:1. */
  assert.equal(Number(expectedScore(1600, 1200).toFixed(4)), 0.9091);
});

test('K is 80 while placing, 48 for new accounts, then 28 / 20 / 12 by height', () => {
  assert.equal(kFactorFor(1200, 0), 80);
  assert.equal(kFactorFor(1200, CALIBRATION_GAMES - 1), 80);
  assert.equal(kFactorFor(1200, CALIBRATION_GAMES), 48);
  assert.equal(kFactorFor(1200, NEW_PLAYER_GAMES - 1), 48);
  assert.equal(kFactorFor(1799, NEW_PLAYER_GAMES), 28);
  assert.equal(kFactorFor(1800, NEW_PLAYER_GAMES), 20);
  assert.equal(kFactorFor(2299, NEW_PLAYER_GAMES), 20);
  assert.equal(kFactorFor(2300, NEW_PLAYER_GAMES), 12);
});

test('a new account climbs much faster than a settled one', () => {
  const placing = applyResult({ ...base, gamesPlayed: 0 });
  assert.equal(placing.delta, 40);
  const fresh = applyResult({ ...base, gamesPlayed: CALIBRATION_GAMES });
  assert.equal(fresh.k, NEW_PLAYER_K);
  assert.equal(fresh.delta, 24);
  const settled = applyResult(base);
  assert.equal(settled.delta, 14);
  assert.ok(fresh.delta > settled.delta * 1.5, 'the new-player band is a real head start');
});

test('a win against an equal at 1200 gains K/2', () => {
  const out = applyResult(base);
  assert.equal(out.delta, 14);
  assert.equal(out.rating, 1214);
  assert.equal(out.k, 28);
  assert.equal(out.calibrating, false);
});

test('placement moves fast: 1200 vs 1200 gains 40', () => {
  const out = applyResult({ ...base, gamesPlayed: 0 });
  assert.equal(out.delta, 40);
  assert.equal(out.calibrationLeft, CALIBRATION_GAMES - 1);
  assert.equal(out.calibrating, true);
  assert.equal(ratingLabel(1240, true), '1240?');
});

test('a loss costs the same half-K, and a draw is neutral', () => {
  const loss = applyResult({ ...base, score: 0 });
  assert.equal(loss.delta, -14);
  const draw = applyResult({ ...base, score: 0.5 });
  assert.equal(draw.delta, 0);
});

test('three wins in a row against an equal earn the quarter bonus', () => {
  const two = applyResult({ ...base, streak: 1 });
  assert.equal(two.delta, 14);
  assert.equal(two.streak, 2);

  const three = applyResult({ ...base, streak: 2 });
  assert.equal(three.delta, 18); /* 14 * 1.25 */
  assert.equal(three.streak, 3);

  /* The same win streak against a weaker opponent pays normally. */
  const weaker = applyResult({ ...base, streak: 2, opponentRating: 1100 });
  assert.ok(weaker.delta < three.delta);
});

test('a loss resets the streak', () => {
  assert.equal(applyResult({ ...base, streak: 4, score: 0 }).streak, 0);
});

test('reaching 1200 locks a 1100 floor', () => {
  const out = applyResult({ ...base, rating: 1190, opponentRating: 1200 });
  assert.equal(out.rating, 1204);
  assert.equal(out.floor, 1100);
  assert.equal(out.milestoneReached, 1200);
});

test('the floor holds a rating that would have fallen through it', () => {
  const out = applyResult({
    ...base,
    rating: 1102,
    floor: 1100,
    score: 0,
    opponentRating: 1400,
  });
  assert.equal(out.rating, 1100);
  assert.equal(out.heldByFloor, true);
  assert.equal(out.floor, 1100);
});

test('a floor already earned is not recomputed away', () => {
  /* Falling back to 1050 must not drop the 1100 floor earned at 1200. */
  assert.equal(earnedFloor(1050, 1100), 1100);
  assert.equal(earnedFloor(2000), 1900);
  assert.equal(earnedFloor(1999), 1700);
  for (const milestone of MILESTONES) {
    assert.equal(earnedFloor(milestone), milestone - 100);
  }
});

test('bot games count at half weight', () => {
  const out = applyResult({ ...base, opponentIsBot: true });
  assert.equal(out.k, 14);
  assert.equal(out.delta, 7);
});

test('beating a bot 250+ points below gains nothing', () => {
  const out = applyResult({ ...base, opponentIsBot: true, opponentRating: 900 });
  assert.equal(out.delta, 0);
  /* Exactly 250 below is still rated: the rule says "more than". */
  const edge = applyResult({ ...base, opponentIsBot: true, opponentRating: 950 });
  assert.ok(edge.delta > 0);
});

test('losing to a bot still costs rating', () => {
  const out = applyResult({ ...base, opponentIsBot: true, score: 0 });
  assert.ok(out.delta < 0);
});

test('the rating cannot leave the ladder', () => {
  const low = applyResult({ ...base, rating: RATING_MIN, score: 0, opponentRating: 2400 });
  assert.equal(low.rating, RATING_MIN);
  const high = applyResult({ ...base, rating: RATING_MAX, opponentRating: 100, score: 1 });
  assert.equal(high.rating, RATING_MAX);
});

test('an unrated game leaves the record alone but still counts the streak', () => {
  const out = applyResult({ ...base, rated: false, streak: 0 });
  assert.equal(out.delta, 0);
  assert.equal(out.rating, 1200);
  assert.equal(out.gamesPlayed, 61);
});

test('the peak remembers the highest rating ever held', () => {
  const out = applyResult({ ...base, rating: 1400, peak: 1500, score: 0 });
  assert.equal(out.peak, 1500);
});

test('placement seeds are the advertised values', () => {
  assert.equal(seedById('beginner').rating, 400);
  assert.equal(seedById('casual').rating, 800);
  assert.equal(seedById('intermediate').rating, 1200);
  assert.equal(seedById('advanced').rating, 1600);
});
