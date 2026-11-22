/**
 * The title ladder: thresholds, norms, permanence and the nameplate helpers.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TITLES,
  earnedTitles,
  highestTitle,
  newTitles,
  nextTitle,
  normAverage,
  performanceRating,
  progressFor,
  progressSummary,
  titleForRating,
  titleSpec,
} from '../../src/play/titles.ts';

const gm = titleSpec('GM');
const nm = titleSpec('NM');
const clb = titleSpec('CLB');

test('performance is the opponent plus or minus the Elo swing', () => {
  assert.equal(performanceRating(2100, 1), 2500);
  assert.equal(performanceRating(2100, 0.5), 2100);
  assert.equal(performanceRating(2100, 0), 1700);
  /* Never leaves the ladder. */
  assert.equal(performanceRating(100, 0), 100);
  assert.equal(performanceRating(2900, 1), 3000);
});

test('a norm averages only the most recent games in the run', () => {
  assert.equal(normAverage([2500, 2500, 2500, 2500, 2500], 5), 2500);
  assert.equal(normAverage([2500, 2500, 2500], 5), null);
  /* Older games beyond the window are ignored. */
  assert.equal(normAverage([2600, 2600, 2400, 2400, 2400], 5), 2480);
});

test('the club title needs a peak and nothing else', () => {
  assert.equal(progressFor(clb, 1699, []).met, false);
  assert.equal(progressFor(clb, 1700, []).met, true);
  assert.equal(progressFor(clb, 1700, []).ratingMet, true);
});

test('CM is rating only, NM needs the norm as well', () => {
  const cm = titleSpec('CM');
  assert.equal(progressFor(cm, 2200, []).met, true);
  assert.equal(progressFor(nm, 2200, []).met, false);
  const good = [2300, 2300, 2300, 2300, 2300];
  assert.equal(progressFor(nm, 2200, good).met, true);
  /* A peak below the threshold blocks the title however good the play was. */
  assert.equal(progressFor(nm, 2199, good).met, false);
});

test('GM wants ten games, and five are not enough', () => {
  const five = [2600, 2600, 2600, 2600, 2600];
  const ten = [...five, ...five];
  assert.equal(progressFor(gm, 2550, five).met, false);
  assert.equal(progressFor(gm, 2550, ten).met, true);
  assert.equal(progressFor(gm, 2499, ten).met, false);
});

test('the earned set and the new one are related but not the same', () => {
  const window = [2600, 2600, 2600, 2600, 2600, 2600, 2600, 2600, 2600, 2600];
  const earned = earnedTitles(2550, window);
  assert.deepEqual(earned, ['CLB', 'CM', 'NM', 'FM', 'IM', 'GM']);
  assert.deepEqual(newTitles(['CLB', 'CM'], 2550, window), ['NM', 'FM', 'IM', 'GM']);
  assert.deepEqual(newTitles(earned, 2550, window), []);
});

test('the highest held title wins, whatever order they are stored in', () => {
  assert.equal(highestTitle([]), null);
  assert.equal(highestTitle(['CLB']), 'CLB');
  assert.equal(highestTitle(['FM', 'CLB', 'CM']), 'FM');
  assert.equal(highestTitle(['GM', 'CLB']), 'GM');
});

test('the next title skips the ones already earned', () => {
  assert.equal(nextTitle([])?.id, 'CLB');
  assert.equal(nextTitle(['CLB', 'CM'])?.id, 'NM');
  assert.equal(nextTitle(['CLB', 'CM', 'NM', 'FM', 'IM', 'GM']), null);
});

test('bots are titled by rating alone', () => {
  assert.equal(titleForRating(1699), null);
  assert.equal(titleForRating(1700), 'CLB');
  assert.equal(titleForRating(2200), 'CM');
  assert.equal(titleForRating(2300), 'FM');
  assert.equal(titleForRating(2400), 'IM');
  assert.equal(titleForRating(2500), 'GM');
  assert.equal(titleForRating(1250), null);
});

test('progress reads like a sentence with the shortfall in it', () => {
  assert.match(progressSummary(clb, 1700, []), /CLB earned/);
  assert.match(progressSummary(clb, 1600, []), /1600 \/ 1700 peak Elo/);
  const window = [2550, 2550, 2550, 2550, 2550, 2550, 2550];
  const text = progressSummary(gm, 2600, window);
  assert.match(text, /7\/10 games/);
  assert.match(text, /2550 avg performance/);
  assert.match(text, /needs 2550/);
});

test('every title has a colour and a readable name', () => {
  for (const title of TITLES) {
    assert.ok(title.name.length > 3);
    assert.ok(title.tone === 'yellow' || title.tone === 'red');
  }
  assert.equal(titleSpec('CLB').tone, 'yellow');
  assert.equal(titleSpec('GM').tone, 'red');
});
