/**
 * Audio mapping, priority and preference persistence.
 *
 * The browser playback layer is exercised in the app; these tests pin the
 * rules: one cue per move, deterministic priority, and settings that survive a
 * reload (including the old mute-only key).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MOVE_SOUND_PRIORITY,
  SOUND_DEDUPE_MS,
  SOUND_FILES,
  classifyMoveSound,
  moveSoundFacts,
  shouldPlaySound,
  shouldPlaySoundIn,
  type MoveSoundFacts,
  type SoundEvent,
} from '../../src/play/audio/soundEvents.ts';
import { replaySans, replayPlySound } from '../../src/play/replay.ts';
import {
  DEFAULT_SOUND_SETTINGS,
  LEGACY_MUTE_KEY,
  SOUND_SETTINGS_KEY,
  clampVolume,
  loadSoundSettings,
  parseSoundSettings,
  saveSoundSettings,
  type SettingsStorage,
} from '../../src/play/audio/soundSettings.ts';

function facts(overrides: Partial<MoveSoundFacts> = {}): MoveSoundFacts {
  return {
    side: 'self',
    capture: false,
    castle: false,
    promotion: false,
    check: false,
    gameEnd: false,
    ...overrides,
  };
}

function memoryStorage(seed: Record<string, string> = {}): SettingsStorage & {
  values: Map<string, string>;
} {
  const values = new Map(Object.entries(seed));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

test('every candle has exactly one supplied file', () => {
  const events = Object.keys(SOUND_FILES) as SoundEvent[];
  assert.equal(events.length, 9);
  assert.deepEqual(new Set(Object.values(SOUND_FILES)), new Set([
    'move-self.mp3',
    'move-opponent.mp3',
    'capture.mp3',
    'move-check.mp3',
    'castle.mp3',
    'promote.mp3',
    'illegal.mp3',
    'premove.mp3',
    'game-end.mp3',
  ]));
});

test('ordinary moves differ by who moved', () => {
  assert.equal(classifyMoveSound(facts({ side: 'self' })), 'move-self');
  assert.equal(classifyMoveSound(facts({ side: 'opponent' })), 'move-opponent');
});

test('priority: game end, promotion, castle, check, capture, move', () => {
  assert.deepEqual(MOVE_SOUND_PRIORITY, [
    'game-end',
    'promote',
    'castle',
    'move-check',
    'capture',
  ]);

  assert.equal(
    classifyMoveSound(
      facts({ gameEnd: true, promotion: true, castle: true, check: true, capture: true }),
    ),
    'game-end',
  );
  assert.equal(
    classifyMoveSound(facts({ promotion: true, castle: true, check: true, capture: true })),
    'promote',
  );
  assert.equal(classifyMoveSound(facts({ castle: true, check: true, capture: true })), 'castle');
  assert.equal(classifyMoveSound(facts({ check: true, capture: true })), 'move-check');
  assert.equal(classifyMoveSound(facts({ capture: true })), 'capture');
});

test('a mating capture plays only the completion cue', () => {
  const factsForMate = moveSoundFacts(
    { captured: 'q', flags: 'c' },
    { side: 'self', check: true, gameEnd: true },
  );
  assert.equal(classifyMoveSound(factsForMate), 'game-end');
});

test('move facts recognise en passant, castling and promotion flags', () => {
  assert.equal(
    moveSoundFacts({ flags: 'e' }, { side: 'self', check: false, gameEnd: false }).capture,
    true,
  );
  assert.equal(
    moveSoundFacts({ flags: 'k' }, { side: 'opponent', check: false, gameEnd: false }).castle,
    true,
  );
  assert.equal(
    moveSoundFacts({ flags: 'q' }, { side: 'opponent', check: false, gameEnd: false }).castle,
    true,
  );
  assert.equal(
    moveSoundFacts({ flags: 'p', promotion: 'q' }, { side: 'self', check: false, gameEnd: false })
      .promotion,
    true,
  );
  assert.equal(
    moveSoundFacts({ flags: 'n' }, { side: 'self', check: false, gameEnd: false }).promotion,
    false,
  );
});

test('duplicate cues inside the window are suppressed', () => {
  assert.equal(shouldPlaySound(0, SOUND_DEDUPE_MS - 1), false);
  assert.equal(shouldPlaySound(0, SOUND_DEDUPE_MS), true);
  assert.equal(shouldPlaySound(1_000, 5_000), true);
});

test('a live game and a review are allowed to speak', () => {
  assert.equal(shouldPlaySoundIn('live-play'), true);
  assert.equal(shouldPlaySoundIn('review'), true);
  for (const context of ['restore', 'pgn-import', 'analysis'] as const) {
    assert.equal(shouldPlaySoundIn(context), false, context);
  }
});

test('a reviewed ply sounds like the move that made it', () => {
  /* 1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bxc6 dxc6 */
  const replay = replaySans('', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6', 'dxc6']);
  assert.equal(replay.plies.length, 8);

  const cue = (index: number, playerColor: 'w' | 'b' | null) =>
    replayPlySound(replay.plies[index], playerColor);

  /* White's first move, from White's seat. */
  assert.equal(cue(0, 'w'), 'move-self');
  /* Black's reply, heard from White's seat, is the opponent's voice. */
  assert.equal(cue(1, 'w'), 'move-opponent');
  assert.equal(cue(1, 'b'), 'move-self', 'the black player hears its own move');
  /* Bxc6 is a capture; dxc6 is the recapture. */
  assert.equal(cue(6, 'w'), 'capture');
  assert.equal(cue(7, 'w'), 'capture');
  /* The last move never plays the completion cue in a review. */
  assert.equal(cue(7, 'w'), 'capture');

  /* A corrupt ply is silent rather than throwing. */
  assert.equal(replayPlySound({ ...replay.plies[0], san: 'Qh8#' }, 'w'), null);
});

test('missing settings fall back to audible 70%', () => {
  assert.deepEqual(parseSoundSettings(null), { muted: false, volume: 0.7 });
  assert.deepEqual(loadSoundSettings(memoryStorage()), DEFAULT_SOUND_SETTINGS);
});

test('corrupt settings never break sound', () => {
  assert.deepEqual(parseSoundSettings('{not json'), DEFAULT_SOUND_SETTINGS);
  assert.deepEqual(parseSoundSettings('null'), DEFAULT_SOUND_SETTINGS);
  assert.deepEqual(parseSoundSettings('"loud"'), DEFAULT_SOUND_SETTINGS);
});

test('volume is clamped and rounded', () => {
  assert.equal(clampVolume(-1), 0);
  assert.equal(clampVolume(2), 1);
  assert.equal(clampVolume(0.456), 0.46);
  assert.equal(clampVolume('0.3'), 0.3);
  assert.equal(clampVolume(Number.NaN), DEFAULT_SOUND_SETTINGS.volume);
  assert.equal(clampVolume(undefined), DEFAULT_SOUND_SETTINGS.volume);
});

test('mute and volume persist through a reload', () => {
  const storage = memoryStorage();
  const saved = saveSoundSettings({ muted: true, volume: 0.35 }, storage);

  assert.deepEqual(saved, { muted: true, volume: 0.35 });
  assert.ok(storage.values.get(SOUND_SETTINGS_KEY));
  assert.deepEqual(loadSoundSettings(storage), { muted: true, volume: 0.35 });
});

test('the legacy mute-only key is migrated without losing the choice', () => {
  const storage = memoryStorage({ [LEGACY_MUTE_KEY]: '1' });
  assert.deepEqual(loadSoundSettings(storage), { muted: true, volume: 0.7 });

  const audible = memoryStorage({ [LEGACY_MUTE_KEY]: '0' });
  assert.deepEqual(loadSoundSettings(audible), { muted: false, volume: 0.7 });
});

test('storage failures leave usable defaults', () => {
  const broken: SettingsStorage = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('denied');
    },
  };
  assert.deepEqual(loadSoundSettings(broken), DEFAULT_SOUND_SETTINGS);
  assert.deepEqual(saveSoundSettings({ muted: false, volume: 0.5 }, broken), {
    muted: false,
    volume: 0.5,
  });
});
