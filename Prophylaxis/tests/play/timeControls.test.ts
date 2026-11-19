/**
 * Presets, standard notation, custom-control validation and clock formatting.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CUSTOM_ID,
  TIME_CONTROL_PRESETS,
  UNTIMED_ID,
  formatClock,
  formatDuration,
  formatTimeControl,
  timeControlLabel,
  validateCustomTime,
} from '../../src/play/timeControls.ts';

test('offers exactly the documented presets in order', () => {
  assert.deepEqual(
    TIME_CONTROL_PRESETS.map((preset) => preset.id),
    ['1+0', '1+1', '3+0', '3+2', '5+0', '10+0', '10+5', '15+10'],
  );

  const byId = new Map(TIME_CONTROL_PRESETS.map((preset) => [preset.id, preset]));
  assert.equal(byId.get('1+0')?.initialSeconds, 60);
  assert.equal(byId.get('1+0')?.category, 'bullet');
  assert.equal(byId.get('3+2')?.incrementSeconds, 2);
  assert.equal(byId.get('3+2')?.category, 'blitz');
  assert.equal(byId.get('10+5')?.initialSeconds, 600);
  assert.equal(byId.get('15+10')?.category, 'rapid');
  assert.equal(UNTIMED_ID, 'untimed');
  assert.equal(CUSTOM_ID, 'custom');
});

test('formats time controls in standard minutes+increment notation', () => {
  assert.equal(formatTimeControl(300, 3), '5+3');
  assert.equal(formatTimeControl(60, 0), '1+0');
  assert.equal(formatTimeControl(900, 10), '15+10');
  assert.equal(timeControlLabel(0, 0), 'Untimed');
  assert.equal(timeControlLabel(600, 5), '10+5');
});

test('rounds clocks up and adds hours only when needed', () => {
  assert.equal(formatClock(300_000), '5:00');
  assert.equal(formatClock(299_001), '5:00');
  assert.equal(formatClock(9_000), '0:09');
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(3_723_000), '1:02:03');
});

test('formats durations for history rows', () => {
  assert.equal(formatDuration(38), '38s');
  assert.equal(formatDuration(252), '4m 12s');
  assert.equal(formatDuration(3_900), '1h 05m');
});

test('accepts a sensible custom control', () => {
  assert.deepEqual(validateCustomTime('5', '3'), {
    ok: true,
    initialSeconds: 300,
    incrementSeconds: 3,
  });
  assert.deepEqual(validateCustomTime('180', '0'), {
    ok: true,
    initialSeconds: 10_800,
    incrementSeconds: 0,
  });
});

test('rejects out-of-range or non-integer custom values', () => {
  for (const [minutes, increment] of [
    ['0', '0'],
    ['181', '0'],
    ['5.5', '0'],
    ['abc', '0'],
    ['5', '-1'],
    ['5', '61'],
    ['5', '2.5'],
  ] as const) {
    const result = validateCustomTime(minutes, increment);
    assert.equal(result.ok, false, `${minutes}+${increment} should be rejected`);
    assert.ok(result.error);
  }
});
