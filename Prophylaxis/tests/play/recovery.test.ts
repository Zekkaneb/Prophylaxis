/**
 * Restoring a clock after a reload: paused games keep their time, the player's
 * running clock is charged, the bot's is held, and nothing goes negative.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { ChessClock, recoverClock } from '../../src/play/clock.ts';

const BASE = {
  whiteMs: 240_000,
  blackMs: 180_000,
  active: 'w' as const,
  started: true,
  paused: false,
  savedAt: 10_000,
};

test('charges the player for real time spent away', () => {
  const recovered = recoverClock(BASE, { now: 25_000, chargeSide: 'w' });

  assert.equal(recovered.whiteMs, 225_000);
  assert.equal(recovered.blackMs, 180_000);
  assert.equal(recovered.active, 'w');
  assert.equal(recovered.running, true);
  assert.equal(recovered.flagged, null);
  assert.equal(recovered.charged, true);
});

test('does not charge a bot clock while the app is closed', () => {
  const recovered = recoverClock(
    { ...BASE, active: 'b' },
    { now: 60_000, chargeSide: 'w' },
  );

  assert.equal(recovered.blackMs, 180_000);
  assert.equal(recovered.whiteMs, 240_000);
  assert.equal(recovered.charged, false);
  assert.equal(recovered.flagged, null);
});

test('a paused game is restored exactly as saved', () => {
  const recovered = recoverClock(
    { ...BASE, paused: true, active: null },
    { now: 900_000, chargeSide: 'w' },
  );

  assert.equal(recovered.whiteMs, 240_000);
  assert.equal(recovered.blackMs, 180_000);
  assert.equal(recovered.active, null);
  assert.equal(recovered.running, false);
  assert.equal(recovered.charged, false);
});

test('clamps a flagged clock to zero and reports the side', () => {
  const recovered = recoverClock(
    { ...BASE, whiteMs: 5_000 },
    { now: 10_000 + 20_000, chargeSide: 'w' },
  );

  assert.equal(recovered.whiteMs, 0);
  assert.equal(recovered.blackMs, 180_000);
  assert.equal(recovered.flagged, 'w');
  assert.equal(recovered.running, false);
  assert.ok(recovered.whiteMs >= 0);
});

test('a clock never exceeds its initial value when the timestamp moves back', () => {
  const recovered = recoverClock(BASE, { now: 5_000, chargeSide: 'w' });
  assert.equal(recovered.whiteMs, 240_000);
  assert.equal(recovered.charged, false);
});

test('an untimed game (no clock) keeps nothing running', () => {
  const clock = ChessClock.empty();
  assert.deepEqual(clock, {
    whiteMs: 0,
    blackMs: 0,
    active: null,
    running: false,
    flagged: null,
    delayMs: 0,
    inDelay: false,
  });
});

test('restores the exact values, side to move and increment', () => {
  const clock = ChessClock.restore(
    {
      whiteMs: 212_000,
      blackMs: 90_000,
      incrementMs: 2_000,
      active: 'b',
      started: true,
    },
    1_000,
  );

  const snapshot = clock.snapshot(1_000);
  assert.equal(snapshot.whiteMs, 212_000);
  assert.equal(snapshot.blackMs, 90_000);
  assert.equal(snapshot.active, 'b');
  assert.equal(clock.increment, 2_000);
  assert.equal(clock.isStarted, true);

  /* The restored clock keeps applying increment on the next completed move. */
  const after = clock.afterMove('b', 'w', 2_000);
  assert.equal(after.blackMs, 91_000);
  assert.equal(after.active, 'w');
});

test('a restored paused clock resumes on the stored side only when asked', () => {
  const clock = ChessClock.restore(
    {
      whiteMs: 60_000,
      blackMs: 50_000,
      incrementMs: 0,
      active: null,
      pausedSide: 'b',
      started: true,
    },
    1_000,
  );

  assert.equal(clock.snapshot(1_000).running, false);
  clock.resume(1_000);
  assert.equal(clock.snapshot(6_000).blackMs, 45_000);
});

test('a restored game that has not started stays unarmed', () => {
  const clock = ChessClock.restore(
    { whiteMs: 300_000, blackMs: 300_000, incrementMs: 0, active: 'w', started: false },
    0,
  );

  assert.equal(clock.snapshot(9_999).running, false);
  assert.equal(clock.snapshot(9_999).whiteMs, 300_000);
});
