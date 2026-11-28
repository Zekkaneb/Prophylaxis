/**
 * The player's own profile: the name and rating printed on their side of the
 * board and in exported PGN headers.
 *
 * The rules are pure, so they are tested directly: tolerant parsing, name and
 * rating normalisation, storage that survives a bad value, and the display
 * helpers the board uses.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_PLAYER_PROFILE,
  PLAYER_ELO_RANGE,
  PLAYER_NAME_MAX,
  PLAYER_PROFILE_KEY,
  clampPlayerElo,
  loadPlayerProfile,
  normalisePlayerName,
  normalisePlayerProfile,
  parsePlayerProfile,
  playerDisplayName,
  playerInitials,
  savePlayerProfile,
  type ProfileStorage,
} from '../../src/profile/playerProfile.ts';

function memoryStorage(initial: Record<string, string> = {}): ProfileStorage & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

test('an untouched profile keeps the name the app shipped with', () => {
  assert.deepEqual(loadPlayerProfile(null), DEFAULT_PLAYER_PROFILE);
  assert.deepEqual(parsePlayerProfile(null), DEFAULT_PLAYER_PROFILE);
  assert.equal(playerDisplayName(DEFAULT_PLAYER_PROFILE), 'Player One');
  assert.equal(playerInitials(DEFAULT_PLAYER_PROFILE), 'PO');
});

test('names are trimmed, flattened and capped', () => {
  assert.equal(normalisePlayerName('  Zekka   Neb  '), 'Zekka Neb');
  assert.equal(normalisePlayerName('x'.repeat(80)).length, PLAYER_NAME_MAX);
  assert.equal(normalisePlayerName(42), '');
  assert.equal(normalisePlayerName(null), '');

  assert.deepEqual(
    normalisePlayerProfile({ firstName: '  Ada ', lastName: '  Lovelace ', elo: 1840 }),
    { firstName: 'Ada', lastName: 'Lovelace', elo: 1840 },
  );
});

test('the rating is an integer inside the allowed band', () => {
  assert.equal(clampPlayerElo(1200), 1200);
  assert.equal(clampPlayerElo(1234.6), 1235);
  assert.equal(clampPlayerElo(-500), PLAYER_ELO_RANGE.min);
  assert.equal(clampPlayerElo(99999), PLAYER_ELO_RANGE.max);
  assert.equal(clampPlayerElo('1750'), 1750);
  assert.equal(clampPlayerElo('not a number'), DEFAULT_PLAYER_PROFILE.elo);
  assert.equal(clampPlayerElo(undefined), DEFAULT_PLAYER_PROFILE.elo);
});

test('a blank name falls back instead of leaving the board nameless', () => {
  assert.deepEqual(
    normalisePlayerProfile({ firstName: '   ', lastName: '', elo: 1500 }),
    DEFAULT_PLAYER_PROFILE,
  );
  assert.deepEqual(
    normalisePlayerProfile({ firstName: 'Zekka', lastName: '', elo: 1500 }),
    { firstName: 'Zekka', lastName: '', elo: 1500 },
  );
  assert.equal(playerDisplayName({ firstName: 'Zekka', lastName: '', elo: 1500 }), 'Zekka');
  assert.equal(playerInitials({ firstName: 'Zekka', lastName: '', elo: 1500 }), 'Z');
});

test('saving writes the normalised value and reading it back matches', () => {
  const storage = memoryStorage();
  const saved = savePlayerProfile(
    { firstName: '  Zekka ', lastName: 'Neb  ', elo: 1500.4 },
    storage,
  );
  assert.deepEqual(saved, { firstName: 'Zekka', lastName: 'Neb', elo: 1500 });
  assert.deepEqual(JSON.parse(storage.data[PLAYER_PROFILE_KEY]), saved);
  assert.deepEqual(loadPlayerProfile(storage), saved);
});

test('broken storage never breaks the board', () => {
  assert.deepEqual(
    parsePlayerProfile('{not json'),
    DEFAULT_PLAYER_PROFILE,
    'malformed JSON falls back',
  );
  assert.deepEqual(parsePlayerProfile('null'), DEFAULT_PLAYER_PROFILE);
  assert.deepEqual(parsePlayerProfile('"Zekka"'), DEFAULT_PLAYER_PROFILE);
  assert.deepEqual(parsePlayerProfile('{"firstName":"","lastName":"","elo":"x"}'), DEFAULT_PLAYER_PROFILE);

  const throwing: ProfileStorage = {
    getItem: () => {
      throw new Error('private mode');
    },
    setItem: () => {
      throw new Error('private mode');
    },
  };
  assert.deepEqual(loadPlayerProfile(throwing), DEFAULT_PLAYER_PROFILE);
  assert.doesNotThrow(() => savePlayerProfile({ firstName: 'A', lastName: 'B', elo: 1200 }, throwing));
});

test('a stored profile from an older shape is repaired', () => {
  /* Missing rating, an empty last name, a stale extra field. */
  assert.deepEqual(
    parsePlayerProfile('{"firstName":"Zekka","lastName":"","favourite":"Vienna"}'),
    { firstName: 'Zekka', lastName: '', elo: DEFAULT_PLAYER_PROFILE.elo },
  );
});
