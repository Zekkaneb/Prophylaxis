/**
 * The sync bookkeeping, exercised against fake-indexeddb and without a network:
 * what lands in the outbox, how a burst of writes collapses, and how a delete
 * becomes a tombstone instead of a missing row.
 */

import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { db } from '../../src/db.ts';
import {
  changeStamp,
  isApplyingRemote,
  recordSyncedChange,
  withRemoteApply,
} from '../../src/sync/outbox.ts';
import { collapsePending, mergeRemoteRow, toWireRow } from '../../src/sync/sync.ts';
import { deleteTrainingSet } from '../../src/puzzles/trainingSets.ts';

test('a change is stamped forward, never backwards', () => {
  const first = changeStamp();
  const second = changeStamp();
  const third = changeStamp();
  assert.ok(second > first);
  assert.ok(third > second);
  assert.ok(third >= Date.now() - 1000, 'the stamp stays near wall-clock time');
});

test('remote writes are not recorded as local changes', async () => {
  assert.equal(isApplyingRemote(), false);
  const before = await db.sync_outbox.count();

  await withRemoteApply(async () => {
    assert.equal(isApplyingRemote(), true);
    await recordSyncedChange('played_games', 'pulled-row', false);
  });

  assert.equal(isApplyingRemote(), false);
  assert.equal(await db.sync_outbox.count(), before, 'the puller must not re-upload');
});

test('a local change is queued once per write', async () => {
  await db.sync_outbox.clear();
  await recordSyncedChange('played_games', 'g1', false);
  await recordSyncedChange('played_games', 'g1', false);

  const rows = await db.sync_outbox.toArray();
  assert.equal(rows.length, 2, 'both writes are recorded; collapsing happens at push time');
  assert.ok(rows[1].updated_at > rows[0].updated_at);
});

test('a burst of writes collapses to the newest change per row', () => {
  const collapsed = collapsePending([
    { id: 1, table_name: 'played_games', row_id: 'a', updated_at: 10, deleted: false },
    { id: 2, table_name: 'played_games', row_id: 'b', updated_at: 11, deleted: false },
    { id: 3, table_name: 'played_games', row_id: 'a', updated_at: 12, deleted: false },
    { id: 4, table_name: 'played_games', row_id: 'a', updated_at: 9, deleted: false },
  ]);

  assert.equal(collapsed.length, 2);
  const a = collapsed.find((change) => change.row_id === 'a');
  assert.equal(a?.updated_at, 12, 'the newest entry wins, out-of-order included');
});

test('a counter row keeps the higher cycle when two devices disagree', () => {
  const merged = mergeRemoteRow(
    'puzzle_sets',
    { set_id: 's1', current_cycle: 4, name: 'mine' },
    { set_id: 's1', current_cycle: 3, name: 'theirs' },
  );
  assert.equal(merged.current_cycle, 4, 'a slow clock cannot roll a trainer back a cycle');
  assert.equal(merged.name, 'theirs', 'every other field still takes the incoming value');

  const forward = mergeRemoteRow(
    'puzzle_sets',
    { set_id: 's1', current_cycle: 2 },
    { set_id: 's1', current_cycle: 5 },
  );
  assert.equal(forward.current_cycle, 5);

  const unaffected = mergeRemoteRow('played_games', { game_id: 'g' }, { game_id: 'g', pgn: 'x' });
  assert.deepEqual(unaffected, { game_id: 'g', pgn: 'x' }, 'other tables take the row as it comes');
});

test('deleting a training set queues tombstones for its tables', async () => {
  await db.sync_outbox.clear();
  await deleteTrainingSet('set-that-does-not-exist');

  const changes = await db.sync_outbox.toArray();
  assert.equal(changes.length, 1, 'the set itself is tombstoned');
  assert.equal(changes[0].table_name, 'puzzle_sets');
  assert.equal(changes[0].deleted, true);
});

test('a delete becomes a tombstone, a re-create becomes a row', () => {
  const tombstone = toWireRow(
    { table_name: 'played_games', row_id: 'gone', updated_at: 5, deleted: true },
    undefined,
  );
  assert.equal(tombstone.deleted, true);
  assert.deepEqual(tombstone.payload, {}, 'a tombstone carries no payload');
  assert.equal(tombstone.updated_at, new Date(5).toISOString());

  const recreated = toWireRow(
    { table_name: 'played_games', row_id: 'back', updated_at: 6, deleted: true },
    { game_id: 'back', pgn: '1. e4' },
  );
  assert.equal(recreated.deleted, false, 'the row exists again, so it uploads');
  assert.deepEqual(recreated.payload, { game_id: 'back', pgn: '1. e4' });
});
