import { db } from '../db.ts';

/**
 * The local change log that makes sync possible without touching the 51 call
 * sites that write to Dexie.
 *
 * Whoever writes a synced row also records the change here, in the same task:
 * a row id, whether it was a delete, and when. Push reads the *current* row
 * from Dexie rather than storing a copy, so a burst of writes to one game
 * collapses into a single upload of its latest state.
 */

/**
 * Every table whose rows belong to one person.
 *
 * `puzzles` and `puzzle_shards` are absent on purpose: that is the shared
 * reference corpus, seeded per device.
 *
 * `woodpecker_sets` is here because the Puzzles page's "Available sets" list is
 * still built from it, not from `puzzle_sets` — a set frozen there is the one
 * the trainer replays, so leaving it out would mean a set that never travels.
 */
export const SYNCED_TABLES = [
  'played_games',
  'puzzle_sets',
  'puzzle_cycles',
  'puzzle_attempts',
  'woodpecker_sets',
  'pgn_courses',
  'custom_lessons',
  'line_progress',
  'lesson_progress',
  'saved_reviews',
  'active_game',
  'prefs',
] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];

/** Fired whenever a change is queued, so the UI can show the real count. */
export const QUEUE_EVENT = 'openinglab:sync-queued';

export function isSyncedTable(name: string): name is SyncedTable {
  return (SYNCED_TABLES as readonly string[]).includes(name);
}

/**
 * Monotonic stamp in epoch ms.
 *
 * Two changes in the same millisecond must still order, otherwise "newest
 * wins" has nothing to compare. Cheap: the clock only ever moves forward.
 */
let lastStamp = 0;
export function changeStamp(): number {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return lastStamp;
}

/**
 * True while rows are being written from the server. Those writes are not local
 * changes and must not be pushed back.
 */
let applyingRemote = 0;

export function isApplyingRemote(): boolean {
  return applyingRemote > 0;
}

export async function withRemoteApply<T>(task: () => Promise<T>): Promise<T> {
  applyingRemote += 1;
  try {
    return await task();
  } finally {
    applyingRemote -= 1;
  }
}

/**
 * Notes that a synced row changed. Deliberately swallows its own failure: a
 * broken outbox must never lose a saved game, only a later upload of it.
 */
export async function recordSyncedChange(
  table: SyncedTable,
  rowId: string,
  deleted: boolean,
): Promise<void> {
  if (isApplyingRemote()) return;
  try {
    await db.sync_outbox.add({
      table_name: table,
      row_id: rowId,
      updated_at: changeStamp(),
      deleted,
    });
    /* Lets the Account panel show the queue as it fills, instead of only after
       the next sync. A page-level event rather than a subscription, because
       the writers are plain functions with no React context. */
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(QUEUE_EVENT));
    }
  } catch {
    /* sync bookkeeping is best-effort; the row itself is already saved */
  }
}
