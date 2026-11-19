/**
 * Persistence layer, exercised against fake-indexeddb: one active game at a
 * time, ordered writes, and an archive that never duplicates a completion.
 */

import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { db } from '../../src/db.ts';
import {
  clearActiveGame,
  deletePlayedGame,
  finalizePlayedGame,
  getPlayedGame,
  listPlayedGames,
  loadActiveGame,
  saveActiveGame,
  savePlayedGame,
} from '../../src/play/gameStore.ts';
import {
  activeToPlayedGame,
  createActiveRecord,
  finishActiveRecord,
} from '../../src/play/activeGame.ts';
import { PERSONALITY_OPPONENTS } from '../../src/play/opponents.ts';
import { STANDARD_START_FEN } from '../../src/play/pgn.ts';
import type { ActiveGameRecord, GameConfig } from '../../src/play/types.ts';

const config: GameConfig = {
  color: 'w',
  timeControlId: '5+0',
  initialSeconds: 300,
  incrementSeconds: 0,
  untimed: false,
};

function record(id: string, overrides: Partial<Parameters<typeof createActiveRecord>[0]> = {}) {
  return createActiveRecord({
    id,
    opponent: PERSONALITY_OPPONENTS[2]!,
    config,
    playerColor: 'w',
    orientation: 'white',
    initialFen: STANDARD_START_FEN,
    currentFen: STANDARD_START_FEN,
    sans: ['e4', 'e5'],
    whiteMs: 280_000,
    blackMs: 295_000,
    active: 'w',
    clockStarted: true,
    paused: false,
    startedAt: 1_700_000_000_000,
    now: 1_700_000_030_000,
    ...overrides,
  });
}

function finished(id: string): ActiveGameRecord {
  return finishActiveRecord(
    record(id),
    '1-0',
    'checkmate',
    1_700_000_200_000,
    'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3',
  );
}

test('stores and reads the unfinished game', async () => {
  await db.active_game.clear();
  await db.played_games.clear();

  assert.equal(await loadActiveGame(), undefined);

  await saveActiveGame(record('game_a'));
  const loaded = await loadActiveGame();

  assert.equal(loaded?.game_id, 'game_a');
  assert.deepEqual(loaded?.sans, ['e4', 'e5']);
  assert.equal(loaded?.white_ms, 280_000);
  assert.equal(loaded?.active_clock, 'w');
  assert.equal(loaded?.paused, false);
  assert.equal(loaded?.status, 'playing');
});

test('keeps a single active slot and applies queued writes in order', async () => {
  await db.active_game.clear();

  await Promise.all([saveActiveGame(record('game_a')), saveActiveGame(record('game_b'))]);

  assert.equal(await db.active_game.count(), 1);
  assert.equal((await loadActiveGame())?.game_id, 'game_b');
});

test('clearing with a mismatched id leaves the newer game alone', async () => {
  await db.active_game.clear();
  await saveActiveGame(record('game_current'));

  await clearActiveGame('game_other');
  assert.equal((await loadActiveGame())?.game_id, 'game_current');

  await clearActiveGame('game_current');
  assert.equal(await loadActiveGame(), undefined);
});

test('archiving completes once and removes the active row', async () => {
  await db.active_game.clear();
  await db.played_games.clear();

  const final = finished('game_done');
  await saveActiveGame(final);
  const played = activeToPlayedGame(final);

  await finalizePlayedGame(played);
  assert.equal(await loadActiveGame(), undefined);

  /* A repeated completion writes the same key, never a second entry. */
  await finalizePlayedGame(played);

  const history = await listPlayedGames();
  assert.equal(history.length, 1);
  assert.equal(history[0]?.game_id, 'game_done');
  assert.equal(history[0]?.result, '1-0');
  assert.equal((await getPlayedGame('game_done'))?.sans.length, 2);
});

test('deleting a finished game does not touch an unfinished one', async () => {
  await db.active_game.clear();
  await db.played_games.clear();

  await savePlayedGame(activeToPlayedGame(finished('game_done')));
  await saveActiveGame(record('game_live'));

  await deletePlayedGame('game_done');

  assert.equal(await getPlayedGame('game_done'), undefined);
  assert.equal((await loadActiveGame())?.game_id, 'game_live');
});
