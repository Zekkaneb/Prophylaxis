import { db, type SyncOutboxRow } from '../db.ts';
import { supabase } from './client.ts';
import {
  SYNCED_TABLES,
  isSyncedTable,
  withRemoteApply,
} from './outbox.ts';

/**
 * Push local changes, then pull everyone else's.
 *
 * Both directions are dumb on purpose: the server decides winners
 * (`push_sync_rows` keeps the newest `updated_at` per row), and this side
 * replays whatever comes back in timestamp order. Nothing here merges counters;
 * see `docs/sync.md` for the two rows that will need it when they join.
 */

const PUSH_BATCH = 200;
const PULL_PAGE = 500;
const EPOCH = '1970-01-01T00:00:00.000Z';

interface RemoteSyncRow {
  table_name: string;
  row_id: string;
  payload: Record<string, unknown> | null;
  updated_at: string;
  deleted: boolean;
}

export interface SyncReport {
  pushed: number;
  pulled: number;
}

/* --------------------------------- cursors -------------------------------- */

function cursorKey(userId: string): string {
  return `cursor:${userId}`;
}

async function readCursor(userId: string): Promise<string> {
  const row = await db.sync_meta.get(cursorKey(userId));
  return row?.value ?? EPOCH;
}

async function writeCursor(userId: string, value: string): Promise<void> {
  await db.sync_meta.put({ key: cursorKey(userId), value });
}

/* ---------------------------------- push ---------------------------------- */

/**
 * Uploads pending changes one batch at a time.
 *
 * Several outbox entries can name the same row (create, then update); only the
 * newest one matters, so the batch is de-duplicated by row before it goes out.
 * Payloads are read from Dexie at push time, which is why a game saved sixteen
 * times while playing is uploaded once, with its final position.
 */
/** The newest change per row: anything older is already superseded locally. */
export function collapsePending(pending: SyncOutboxRow[]): SyncOutboxRow[] {
  const newest = new Map<string, SyncOutboxRow>();
  for (const change of pending) {
    const key = `${change.table_name}\u0000${change.row_id}`;
    const seen = newest.get(key);
    if (!seen || seen.updated_at <= change.updated_at) newest.set(key, change);
  }
  return [...newest.values()];
}

/** The shape `push_sync_rows` expects for one change. */
export function toWireRow(change: SyncOutboxRow, stored: Record<string, unknown> | undefined) {
  return {
    table_name: change.table_name,
    row_id: change.row_id,
    payload: stored ?? {},
    updated_at: new Date(change.updated_at).toISOString(),
    /* A delete only counts as one while the row is still gone: a delete
       followed by a re-create must upload the row, not a tombstone. */
    deleted: change.deleted && stored === undefined,
  };
}

async function pushOnce(): Promise<number> {
  if (!supabase) return 0;

  const pending = await db.sync_outbox.orderBy('id').limit(PUSH_BATCH).toArray();
  if (pending.length === 0) return 0;

  const rows = [];
  for (const change of collapsePending(pending)) {
    if (!isSyncedTable(change.table_name)) continue;
    const stored = await db.table(change.table_name).get(change.row_id);
    rows.push(toWireRow(change, stored as Record<string, unknown> | undefined));
  }

  if (rows.length === 0) {
    await db.sync_outbox.bulkDelete(pending.map((change) => change.id as number));
    return 0;
  }

  const { error } = await supabase.rpc('push_sync_rows', { p_rows: rows });
  if (error) throw new Error(error.message);

  await db.sync_outbox.bulkDelete(pending.map((change) => change.id as number));
  return rows.length;
}

/* ---------------------------------- pull ---------------------------------- */

async function pullOnce(userId: string): Promise<number> {
  if (!supabase) return 0;

  let cursor = await readCursor(userId);
  let pulled = 0;

  for (;;) {
    const { data, error } = await supabase
      .from('sync_rows')
      .select('table_name, row_id, payload, updated_at, deleted')
      .gt('updated_at', cursor)
      .order('updated_at', { ascending: true })
      .limit(PULL_PAGE);
    if (error) throw new Error(error.message);

    const page = (data ?? []) as RemoteSyncRow[];
    if (page.length === 0) break;

    await withRemoteApply(async () => {
      for (const row of page) {
        if (!isSyncedTable(row.table_name)) continue;
        if (row.deleted) await db.table(row.table_name).delete(row.row_id);
        else if (row.payload) await db.table(row.table_name).put(row.payload);
      }
    });

    pulled += page.length;
    cursor = page[page.length - 1].updated_at;
    await writeCursor(userId, cursor);

    if (page.length < PULL_PAGE) break;
  }

  return pulled;
}

/* ---------------------------------- sync ---------------------------------- */

/**
 * One full pass: pull first, then push. Pulling first means a device that was
 * away uploads its offline games *after* seeing newer ones, so the server's
 * timestamp guard — not arrival order — decides what stands.
 */
export async function runSync(userId: string): Promise<SyncReport> {
  if (!supabase) return { pushed: 0, pulled: 0 };

  let pulled = 0;
  let pushed = 0;

  try {
    pulled = await pullOnce(userId);
  } catch (cause) {
    /* A failed pull must not block the upload of local work. */
    if (import.meta.env.DEV) console.warn('[sync] pull failed', cause);
  }

  for (;;) {
    const sent = await pushOnce();
    pushed += sent;
    if (sent < PUSH_BATCH) break;
  }

  return { pushed, pulled };
}

export async function pendingChangeCount(): Promise<number> {
  return db.sync_outbox.count();
}

export { SYNCED_TABLES };
