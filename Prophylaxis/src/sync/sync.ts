import { db, type SyncOutboxRow } from '../db.ts';
import { readDatabaseOwner } from './accountDatabase.ts';
import { supabase } from './client.ts';
import { isSyncedTable, withRemoteApply } from './outbox.ts';

/**
 * Push local changes, then pull everyone else's.
 *
 * Both directions are dumb on purpose: the server decides winners
 * (`push_sync_rows` keeps the newest `updated_at` per row), and this side
 * replays whatever comes back in stream order. Nothing here merges counters;
 * see `docs/sync.md` for the two rows that will need it when they join.
 */

const PUSH_BATCH = 200;
const PULL_PAGE = 500;

interface RemoteSyncRow {
  table_name: string;
  row_id: string;
  payload: Record<string, unknown> | null;
  updated_at: string;
  /** Unique per write, so the pull cursor can never straddle a tie. */
  updated_seq: number;
  deleted: boolean;
}

export interface SyncReport {
  pushed: number;
  pulled: number;
  /**
   * True when the download half failed. Kept separate from `pulled === 0`
   * because "nothing new" and "could not ask" must never look the same.
   */
  pullFailed: boolean;
  pullError: string | null;
}

/* --------------------------------- cursors -------------------------------- */

function cursorKey(userId: string): string {
  return `cursor:${userId}`;
}

/**
 * The highest `updated_seq` already applied.
 *
 * Numeric, not a timestamp: rows written in the same millisecond share an
 * `updated_at`, and a `> timestamp` cursor drops every one of them that falls
 * past a page boundary. The sequence value is unique, so `>` is exact.
 */
async function readCursor(userId: string): Promise<number> {
  const row = await db.sync_meta.get(cursorKey(userId));
  const value = Number(row?.value ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

async function writeCursor(userId: string, value: number): Promise<void> {
  await db.sync_meta.put({ key: cursorKey(userId), value: String(value) });
}

/* ---------------------------------- push ---------------------------------- */

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

export interface PullResult {
  pulled: number;
  failed: boolean;
  error: string | null;
}

async function pullOnce(userId: string): Promise<PullResult> {
  if (!supabase) return { pulled: 0, failed: false, error: null };

  let cursor = await readCursor(userId);
  let pulled = 0;

  for (;;) {
    const { data, error } = await supabase
      .from('sync_rows')
      .select('table_name, row_id, payload, updated_at, updated_seq, deleted')
      .gt('updated_seq', cursor)
      .order('updated_seq', { ascending: true })
      .limit(PULL_PAGE);

    /* A mid-page failure keeps the cursor where it was, so the next attempt
       re-asks for the same rows rather than skipping them. */
    if (error) return { pulled, failed: true, error: error.message };

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
    cursor = page[page.length - 1].updated_seq;
    await writeCursor(userId, cursor);

    if (page.length < PULL_PAGE) break;
  }

  return { pulled, failed: false, error: null };
}

/* ---------------------------------- sync ---------------------------------- */

/**
 * One full pass: pull first, then push. Pulling first means a device that was
 * away uploads its offline games *after* seeing newer ones, so the server's
 * timestamp guard — not arrival order — decides what stands.
 *
 * Refuses to run unless the open database belongs to `userId`: another
 * account's rows must never be uploaded under this session.
 */
export async function runSync(userId: string): Promise<SyncReport> {
  if (!supabase) return { pushed: 0, pulled: 0, pullFailed: false, pullError: null };

  const owner = await readDatabaseOwner();
  if (owner !== userId) {
    throw new Error('this browser is not holding that account’s database yet');
  }

  /* A failed pull must not block the upload of local work, but it must also not
     be reported as "everything is up to date". */
  const pull = await pullOnce(userId);

  let pushed = 0;
  for (;;) {
    const sent = await pushOnce();
    pushed += sent;
    if (sent < PUSH_BATCH) break;
  }

  return {
    pushed,
    pulled: pull.pulled,
    pullFailed: pull.failed,
    pullError: pull.error,
  };
}

export async function pendingChangeCount(): Promise<number> {
  return db.sync_outbox.count();
}
