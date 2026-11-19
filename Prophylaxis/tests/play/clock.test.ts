/**
 * Timestamp-based clock: no drift, correct first-move behaviour, Fischer
 * increment, pause/resume and timeout detection.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { ChessClock } from '../../src/play/clock.ts';

test('does not charge either side before the first move', () => {
  const clock = new ChessClock(300, 0);
  const snapshot = clock.snapshot(30_000);

  assert.equal(snapshot.whiteMs, 300_000);
  assert.equal(snapshot.blackMs, 300_000);
  assert.equal(snapshot.active, null);
  assert.equal(snapshot.running, false);
  assert.equal(snapshot.flagged, null);
});

test('charges the mover from timestamps and hands the clock over', () => {
  const clock = new ChessClock(300, 0);
  clock.start(1_000);
  clock.afterMove('w', 'b', 6_000);

  const snapshot = clock.snapshot(6_000);
  assert.equal(snapshot.whiteMs, 295_000);
  assert.equal(snapshot.blackMs, 300_000);
  assert.equal(snapshot.active, 'b');
  assert.equal(snapshot.running, true);
});

test('adds the increment after each completed move', () => {
  const clock = new ChessClock(60, 2);
  clock.start(0);
  clock.afterMove('w', 'b', 3_000);

  assert.equal(clock.snapshot(3_000).whiteMs, 59_000);
  clock.afterMove('b', 'w', 4_000);
  const snapshot = clock.snapshot(4_000);
  assert.equal(snapshot.blackMs, 61_000);
  assert.equal(snapshot.whiteMs, 59_000);
  assert.equal(snapshot.active, 'w');
});

test('reading the snapshot repeatedly does not consume time', () => {
  const clock = new ChessClock(60, 0);
  clock.start(0);
  clock.afterMove('w', 'b', 1_000);

  const first = clock.snapshot(11_000);
  const second = clock.snapshot(11_000);
  assert.equal(first.blackMs, 50_000);
  assert.deepEqual(second, first);
});

test('flags the active side once its time is gone', () => {
  const clock = new ChessClock(10, 0);
  clock.start(0);
  clock.afterMove('w', 'b', 1_000);

  assert.equal(clock.snapshot(5_000).flagged, null);
  const flagged = clock.snapshot(12_000);
  assert.equal(flagged.flagged, 'b');
  assert.equal(flagged.blackMs, 0);
});

test('pause banks elapsed time and resume charges only new time', () => {
  const clock = new ChessClock(60, 0);
  clock.start(0);
  clock.afterMove('w', 'b', 1_000);

  clock.pause(6_000);
  assert.equal(clock.snapshot(60_000).blackMs, 55_000);
  assert.equal(clock.snapshot(60_000).running, false);

  clock.resume(60_000);
  assert.equal(clock.snapshot(65_000).blackMs, 50_000);
});

test('stop freezes the clock for the rest of the game', () => {
  const clock = new ChessClock(30, 0);
  clock.start(0);
  clock.afterMove('w', 'b', 1_000);
  clock.stop();

  const before = clock.snapshot(2_000);
  const after = clock.snapshot(20_000);
  assert.equal(before.blackMs, after.blackMs);
  assert.equal(after.active, null);
  assert.equal(after.flagged, null);
});

test('resume before the first move does nothing', () => {
  const clock = new ChessClock(30, 0);
  clock.resume(5_000);
  assert.equal(clock.snapshot(10_000).active, null);
  assert.equal(clock.snapshot(10_000).whiteMs, 30_000);
});
