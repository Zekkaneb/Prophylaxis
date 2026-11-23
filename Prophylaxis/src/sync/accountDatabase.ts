import {
  DB_NAME,
  activeDatabaseName,
  createDatabase,
  db,
  getActiveDatabase,
  setActiveDatabase,
  type AppDatabase,
} from '../db.ts';
import { SYNCED_TABLES, recordSyncedChange } from './outbox.ts';

/**
 * One local database per account.
 *
 * A browser can hold several people's sessions over time. Sharing a single
 * Dexie database between them would mean the outbox of whoever signed in last
 * uploads the previous person's games to their own account — the local copy is
 * not filtered by `user_id`, so the walls have to be the database itself.
 *
 * Anonymous use keeps the original name (`chess-trainer-db`), so nothing moves
 * for anyone who never signs in. An account gets `chess-trainer-db-<user id>`.
 */

export const LOCAL_OWNER = 'local';

/**
 * Tables copied out of the anonymous database the first time this browser is
 * used with an account.
 *
 * Deliberately not `puzzles`/`puzzle_shards`: that corpus is hundreds of
 * megabytes of shared reference data, seeded on demand from `/public/puzzles/`.
 * Copying it per account would be the most expensive part of signing in and
 * buys nothing.
 */
export const CLAIMED_TABLES = [
  'pgn_courses',
  'custom_lessons',
  'line_progress',
  'lesson_progress',
  'saved_reviews',
  'played_games',
  'active_game',
  'puzzle_sets',
  'puzzle_cycles',
  'puzzle_attempts',
  'woodpecker_sets',
  'prefs',
  /* Strength and honours are as personal as a game record: a guest's rating and
     titles must follow them into the account, or signing in would silently drop
     the ladder they had already climbed. */
  'user_ratings',
  'user_titles',
] as const;

export function databaseNameFor(owner: string): string {
  return owner === LOCAL_OWNER ? DB_NAME : `${DB_NAME}-${owner}`;
}

/** Which account's database is currently open; `local` when nobody is signed in. */
export async function readDatabaseOwner(instance: AppDatabase = getActiveDatabase()): Promise<string> {
  try {
    const row = await instance.sync_meta.get('owner');
    return row?.value ?? LOCAL_OWNER;
  } catch {
    return LOCAL_OWNER;
  }
}

/**
 * Copies this browser's rows into a brand-new account database, once.
 *
 * This is the migration path: the games someone played before signing up are
 * theirs, and they should appear on their other devices after the first sync
 * rather than being stranded under an account-free database name.
 */
export async function claimLocalRows(
  source: AppDatabase,
  target: AppDatabase,
  owner: string,
): Promise<number> {
  const claimed = await target.sync_meta.get('owner');
  if (claimed) return 0;

  let copied = 0;
  for (const table of CLAIMED_TABLES) {
    const rows = await source.table(table).toArray();
    if (rows.length === 0) continue;
    await target.table(table).bulkPut(rows);
    copied += rows.length;
  }

  /* The outbox comes along so the claimed games upload on the first sync. */
  const pending = await source.sync_outbox.toArray();
  if (pending.length > 0) {
    await target.sync_outbox.bulkAdd(
      pending.map(({ id: _id, ...change }) => change),
    );
    copied += pending.length;
  }

  await target.sync_meta.put({ key: 'owner', value: owner });
  return copied;
}

/* Keyed by the table list, not a fixed version: adding a table to
   `SYNCED_TABLES` must re-run the backfill once, or rows saved under the old
   set (a course imported last week) would never be queued. Re-sending rows is
   harmless — the server keeps the newest and the push collapses duplicates. */
const BACKFILL_KEY = `backfill:${SYNCED_TABLES.join(',')}`;

/**
 * Queues the rows that existed before this table was synced.
 *
 * Without it, anything saved before sync covered a table would sit in the
 * database forever, invisible to the other devices — a puzzle set created last
 * week would never arrive. Runs once per database; a no-op afterwards.
 */
export async function backfillSyncedRows(): Promise<number> {
  if (await db.sync_meta.get(BACKFILL_KEY)) return 0;

  let queued = 0;
  for (const table of SYNCED_TABLES) {
    const keys = await db.table(table).toCollection().primaryKeys();
    for (const key of keys) {
      await recordSyncedChange(table, String(key), false);
      queued += 1;
    }
  }

  await db.sync_meta.put({ key: BACKFILL_KEY, value: String(Date.now()) });
  return queued;
}

async function openDatabase(name: string): Promise<AppDatabase> {
  const instance = createDatabase(name);
  await instance.open();
  return instance;
}

/**
 * Points the app at `owner`'s database. Returns true when it actually switched,
 * which is the caller's signal that rendered state belongs to the old one.
 */
export async function ensureDatabaseFor(owner: string): Promise<boolean> {
  const targetName = databaseNameFor(owner);
  if (activeDatabaseName() === targetName) return false;

  if (owner === LOCAL_OWNER) {
    const previous = getActiveDatabase();
    const local = await openDatabase(DB_NAME);
    setActiveDatabase(local);
    await previous.close();
    return true;
  }

  const previous = getActiveDatabase();
  /* Claim from the anonymous database, never from another account's. */
  const source = previous.name === DB_NAME ? previous : await openDatabase(DB_NAME);
  const target = await openDatabase(targetName);

  await claimLocalRows(source, target, owner);
  setActiveDatabase(target);

  if (previous !== source) await previous.close();
  if (source !== target) await source.close();
  return true;
}
