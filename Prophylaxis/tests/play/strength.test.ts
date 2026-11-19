/**
 * Rating → engine strength: every bot searches a real depth, and the chance of
 * a deliberate mistake decays exponentially as the rating rises.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SEARCH_DEPTH,
  blunderChance,
  chooseBlunder,
  chooseCandidate,
  depthForElo,
} from '../../src/play/strength.ts';

test('every rating searches to the same real depth', () => {
  for (const elo of [600, 1250, 1550, 2150, 2250, 2400]) {
    assert.equal(depthForElo(elo), SEARCH_DEPTH);
  }
  assert.ok(SEARCH_DEPTH >= 14, 'a live move is calculated, not guessed');
});

test('the blunder curve falls exponentially and stays under 2% at 2200', () => {
  const ladder = [600, 800, 1000, 1250, 1450, 1700, 2000, 2150, 2200, 2400];
  const rates = ladder.map(blunderChance);

  for (let index = 1; index < rates.length; index += 1) {
    assert.ok(rates[index] <= rates[index - 1], `rate rose at ${ladder[index]}`);
  }

  assert.ok(blunderChance(1250) > 0.12 && blunderChance(1250) < 0.2);
  assert.ok(blunderChance(2200) < 0.02, '2200 blunders on under 2% of moves');
  assert.ok(blunderChance(2400) > 0 && blunderChance(2400) < 0.012);

  /* Exponential: equal Elo steps multiply the rate by the same factor. */
  const first = blunderChance(1200);
  const second = blunderChance(1530);
  const third = blunderChance(1860);
  assert.ok(Math.abs(first / second - second / third) < 0.02);
});

test('a blunder is a real but survivable mistake from the candidate list', () => {
  const candidates = [
    { uci: 'e2e4', scoreCp: 30, mate: null },
    { uci: 'd2d4', scoreCp: 10, mate: null },
    { uci: 'h2h3', scoreCp: -120, mate: null },
  ];

  assert.equal(chooseBlunder(candidates, 'w', 1250, () => 0), 'h2h3');

  /* Black's point of view mirrors the gap sign: the same White-POV scores make
     the White-favouring move the mistake. */
  assert.equal(chooseBlunder(candidates, 'b', 1250, () => 0), 'e2e4');

  /* Nothing bad enough on the list? Then there is no mistake to make. */
  assert.equal(
    chooseBlunder(
      [
        { uci: 'e2e4', scoreCp: 30, mate: null },
        { uci: 'd2d4', scoreCp: 20, mate: null },
      ],
      'w',
      2200,
      () => 0,
    ),
    null,
  );

  /* A line that walks into mate is never the deliberate mistake. */
  assert.equal(
    chooseBlunder(
      [
        { uci: 'e2e4', scoreCp: 30, mate: null },
        { uci: 'f2f3', scoreCp: -90_000, mate: -2 },
      ],
      'w',
      1250,
      () => 0,
    ),
    null,
  );
});

test('chooses the best candidate for strong bots and can take the runner-up', () => {
  assert.equal(chooseCandidate([], 1500), null);

  const candidates = ['e2e4', 'd2d4'];
  assert.equal(chooseCandidate(candidates, 2200, () => 0.5), 'e2e4');
  assert.equal(chooseCandidate(candidates, 800, () => 0), 'd2d4');
  assert.equal(chooseCandidate(candidates, 800, () => 0.99), 'e2e4');
  assert.equal(chooseCandidate(['e2e4'], 800, () => 0), 'e2e4');
});
