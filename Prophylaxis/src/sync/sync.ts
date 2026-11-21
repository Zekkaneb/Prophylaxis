import { db, type SyncOutboxRow } from '../db.ts';
import { readDatabaseOwner } from './accountDatabase.ts';
import { supabase } from './client.ts';
import { isSyncedTable, withRemoteApply } from './outbox.ts';
import { applyRemotePreference } from './preferences.ts';
import { withRowKey } from './rowKey.ts';

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
  /** Rows that arrived but could not be stored on this device. */
  pullSkipped: number;
  /** Changes the server refused outright (a constraint, a bad table name). */
  pushRejected: number;
  pushError: string | null;
  /** `table/row` for the refused changes, so the message names them. */
  pushRejectedRows: string[];
}

interface PushResult {
  sent: number;
  rejected: number;
  rejectedRows: string[];
  error: string | null;
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

/**
 * Folds an incoming row into the local one before it is written.
 *
 * Almost every synced row is independent, so the server's newest-wins answer is
 * taken as-is. The exceptions are the counters — a trainer's cycle, a drill's
 * attempt count and best score, a lesson's recency — where last-write-wins
 * would let a device whose clock ran a few seconds ahead move progress
 * backwards. Those fields only ever grow; everything else still comes from the
 * incoming row.
 */
/** Fields that only ever grow, per table: a merge must never lower them. */
const GROWING_FIELDS: Record<string, readonly string[]> = {
  puzzle_sets: ['current_cycle'],
  line_progress: ['attempts', 'best_percent', 'mastery', 'last_drilled'],
  lesson_progress: ['last_practiced'],
};

export function mergeRemoteRow(
  table: string,
  local: Record<string, unknown> | undefined,
  remote: Record<string, unknown>,
): Record<string, unknown> {
  if (!local) return remote;

  const merged: Record<string, unknown> = { ...remote };

  for (const field of GROWING_FIELDS[table] ?? []) {
    const ours = local[field];
    const theirs = remote[field];
    if (typeof ours === 'number' && typeof theirs === 'number' && ours > theirs) {
      merged[field] = ours;
    }
  }

  /* Completion is a latch: finishing a lesson on either device keeps it done. */
  if (table === 'lesson_progress' && local.is_completed === true) {
    merged.is_completed = true;
  }

  return merged;
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

const rowKey = (change: { table_name: string; row_id: string }) =>
  `${change.table_name}\u0000${change.row_id}`;

async function pushOnce(): Promise<PushResult> {
  if (!supabase) return { sent: 0, rejected: 0, rejectedRows: [], error: null };

  const pending = await db.sync_outbox.orderBy('id').limit(PUSH_BATCH).toArray();
  if (pending.length === 0) return { sent: 0, rejected: 0, rejectedRows: [], error: null };

  const rows = [];
  for (const change of collapsePending(pending)) {
    if (!isSyncedTable(change.table_name)) continue;
    const stored = await db.table(change.table_name).get(change.row_id);
    rows.push(toWireRow(change, stored as Record<string, unknown> | undefined));
  }

  if (rows.length === 0) {
    await db.sync_outbox.bulkDelete(pending.map((change) => change.id as number));
    return { sent: 0, rejected: 0, rejectedRows: [], error: null };
  }

  const { error } = await supabase.rpc('push_sync_rows', { p_rows: rows });
  if (!error) {
    await db.sync_outbox.bulkDelete(pending.map((change) => change.id as number));
    return { sent: rows.length, rejected: 0, rejectedRows: [], error: null };
  }

  /*
   * The batch was refused. One row can do that on its own — a table name the
   * server's allow-list does not know, a constraint the migration has not
   * widened yet — and because the RPC is all-or-nothing, a single bad row
   * would otherwise wedge the entire queue: every sync would fail identically
   * and nothing would ever upload.
   *
   * So retry one row at a time. What succeeds is cleared from the outbox, what
   * fails stays queued (and is reported), and the rest of the user's work goes
   * through.
   */
  let sent = 0;
  let rejected = 0;
  let firstError: string | null = null;
  const rejectedRows: string[] = [];
  const accepted = new Set<string>();

  for (const row of rows) {
    const single = await supabase.rpc('push_sync_rows', { p_rows: [row] });
    if (single.error) {
      rejected += 1;
      firstError ??= single.error.message;
      /* The generic SQL message never says which row it was; the table does. */
      if (rejectedRows.length < 3) rejectedRows.push(row.table_name);
    } else {
      sent += 1;
      accepted.add(rowKey(row));
    }
  }

  const done = pending.filter((change) => accepted.has(rowKey(change)));
  if (done.length > 0) {
    await db.sync_outbox.bulkDelete(done.map((change) => change.id as number));
  }

  return { sent, rejected, rejectedRows, error: firstError };
}

/* ---------------------------------- pull ---------------------------------- */

export interface PullResult {
  pulled: number;
  failed: boolean;
  error: string | null;
  /** Rows the server sent that this device could not apply. */
  skipped: number;
}

async function pullOnce(userId: string): Promise<PullResult> {
  if (!supabase) return { pulled: 0, failed: false, error: null, skipped: 0 };

  let cursor = await readCursor(userId);
  let pulled = 0;
  let skipped = 0;

  for (;;) {
    const { data, error } = await supabase
      .from('sync_rows')
      .select('table_name, row_id, payload, updated_at, updated_seq, deleted')
      .gt('updated_seq', cursor)
      .order('updated_seq', { ascending: true })
      .limit(PULL_PAGE);

    /* A mid-page failure keeps the cursor where it was, so the next attempt
       re-asks for the same rows rather than skipping them. */
    if (error) return { pulled, failed: true, error: error.message, skipped };

    const page = (data ?? []) as RemoteSyncRow[];
    if (page.length === 0) break;

    await withRemoteApply(async () => {
      for (const row of page) {
        if (!isSyncedTable(row.table_name)) continue;
        if (row.deleted) {
          await db.table(row.table_name).delete(row.row_id);
          continue;
        }

        /* The payload must carry the table's key or IndexedDB refuses the
           write; `row_id` restores it when an older upload left it out. */
        const payload =
          row.payload && typeof row.payload === 'object'
            ? withRowKey(row.table_name, row.row_id, row.payload)
            : null;
        if (!payload) {
          skipped += 1;
          continue;
        }

        if (row.table_name === 'prefs') {
          /* A preference is not just a row: the screen has to pick it up. */
          const key = payload.key;
          const value = payload.value;
          if (typeof key === 'string' && typeof value === 'string') {
            await applyRemotePreference(key, value);
          } else {
            skipped += 1;
          }
          continue;
        }

        const local = (await db.table(row.table_name).get(row.row_id)) as
          | Record<string, unknown>
          | undefined;
        try {
          await db.table(row.table_name).put(mergeRemoteRow(row.table_name, local, payload));
        } catch {
          /* One row this device cannot store must not wedge the cursor: later
             rows would never arrive. It is counted and reported instead. */
          skipped += 1;
        }
      }
    });

    pulled += page.length;
    cursor = page[page.length - 1].updated_seq;
    await writeCursor(userId, cursor);

    if (page.length < PULL_PAGE) break;
  }

  return { pulled, failed: false, error: null, skipped };
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
  if (!supabase) {
    return {
      pushed: 0,
      pulled: 0,
      pullFailed: false,
      pullError: null,
      pullSkipped: 0,
      pushRejected: 0,
      pushError: null,
      pushRejectedRows: [],
    };
  }

  const owner = await readDatabaseOwner();
  if (owner !== userId) {
    throw new Error('this browser is not holding that account’s database yet');
  }

  /* A failed pull must not block the upload of local work, but it must also not
     be reported as "everything is up to date". */
  const pull = await pullOnce(userId);

  let pushed = 0;
  let rejected = 0;
  let pushError: string | null = null;
  const rejectedRows: string[] = [];

  for (;;) {
    const result = await pushOnce();
    pushed += result.sent;
    rejected += result.rejected;
    pushError ??= result.error;
    for (const table of result.rejectedRows) {
      if (!rejectedRows.includes(table)) rejectedRows.push(table);
    }
    /* Stop when the batch was not full, or when nothing moved: a queue made
       entirely of rejected rows would otherwise loop forever. */
    if (result.sent + result.rejected < PUSH_BATCH || result.sent === 0) break;
  }

  return {
    pushed,
    pulled: pull.pulled,
    pullFailed: pull.failed,
    pullError: pull.error,
    pullSkipped: pull.skipped,
    pushRejected: rejected,
    pushError,
    pushRejectedRows: rejectedRows,
  };
}

export async function pendingChangeCount(): Promise<number> {
  return db.sync_outbox.count();
}
