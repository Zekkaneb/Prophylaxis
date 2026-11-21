/**
 * Per-account local databases, against fake-indexeddb: the anonymous rows are
 * claimed once, and two accounts on one browser never share a row.
 */

import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { DB_NAME, createDatabase, db } from '../../src/db.ts';
import {
  LOCAL_OWNER,
  backfillSyncedRows,
  claimLocalRows,
  databaseNameFor,
  ensureDatabaseFor,
  readDatabaseOwner,
} from '../../src/sync/accountDatabase.ts';
import type { PlayedGameRecord } from '../../src/play/types.ts';

function game(id: string): PlayedGameRecord {
  return {
    game_id: id,
    pgn: '1. e4 e5',
    ended_at: 1_700_000_000_000,
  } as unknown as PlayedGameRecord;
}

async function ids(): Promise<string[]> {
  const rows = await db.played_games.toArray();
  return rows.map((row) => row.game_id).sort();
}

test('an account database is named after the account, anonymous keeps the old name', () => {
  assert.equal(databaseNameFor(LOCAL_OWNER), DB_NAME);
  assert.equal(databaseNameFor('abc-123'), `${DB_NAME}-abc-123`);
  assert.notEqual(databaseNameFor('abc-123'), databaseNameFor('def-456'));
});

test('the anonymous rows are claimed once, outbox included', async () => {
  const source = createDatabase(`${DB_NAME}-claim-source`);
  await source.open();
  await source.played_games.put(game('pre-account'));
  await source.sync_outbox.add({
    table_name: 'played_games',
    row_id: 'pre-account',
    updated_at: 1_700_000_000_000,
    deleted: false,
  });

  const target = createDatabase(`${DB_NAME}-claim-target`);
  await target.open();

  assert.equal(await claimLocalRows(source, target, 'user-claim'), 2);
  assert.equal(await readDatabaseOwner(target), 'user-claim');
  assert.equal(await target.played_games.count(), 1);
  assert.equal(await target.sync_outbox.count(), 1, 'the claimed game still uploads');

  assert.equal(await claimLocalRows(source, target, 'user-claim'), 0, 'a claim happens once');
  assert.equal(await target.played_games.count(), 1, 'a second claim does not duplicate');

  await source.close();
  await target.close();
});

test('rows saved before sync existed are queued once', async () => {
  await ensureDatabaseFor(LOCAL_OWNER);
  await db.played_games.clear();
  await db.sync_outbox.clear();
  await db.sync_meta.clear();
  await db.played_games.put(game('from-before-sync'));

  const queued = await backfillSyncedRows();
  assert.ok(queued > 0);

  const changes = await db.sync_outbox.toArray();
  assert.ok(
    changes.some((change) => change.table_name === 'played_games' && change.row_id === 'from-before-sync'),
    'a row without an outbox entry still gets uploaded',
  );

  await db.sync_outbox.clear();
  assert.equal(await backfillSyncedRows(), 0, 'the backfill runs once per database');
});

test('two accounts on one browser cannot see each other’s games', async () => {
  await ensureDatabaseFor(LOCAL_OWNER);
  await db.played_games.clear();
  await db.played_games.put(game('anonymous'));
  await db.sync_outbox.clear();

  await ensureDatabaseFor('user-a');
  assert.equal(await readDatabaseOwner(), 'user-a');
  assert.deepEqual(await ids(), ['anonymous'], 'signing in claims the local game');

  await db.played_games.put(game('a-only'));

  await ensureDatabaseFor('user-b');
  assert.equal(await readDatabaseOwner(), 'user-b');
  assert.deepEqual(
    await ids(),
    ['anonymous'],
    'B inherits the anonymous rows, never A’s',
  );

  await db.played_games.put(game('b-only'));

  await ensureDatabaseFor('user-a');
  assert.deepEqual(
    await ids(),
    ['a-only', 'anonymous'],
    'A’s database is unchanged by B',
  );

  await ensureDatabaseFor(LOCAL_OWNER);
  assert.equal(await readDatabaseOwner(), LOCAL_OWNER);
  assert.deepEqual(await ids(), ['anonymous'], 'signing out returns to the anonymous database');
});
