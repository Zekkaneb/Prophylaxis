import { db } from '../db';

/**
 * Local backup / restore.
 *
 * Everything the user creates lives in IndexedDB, so a single JSON file is a
 * complete snapshot. `puzzles` is included on purpose: the "My Game Blunders"
 * deck stores its puzzles there, and restoring a deck without them would leave
 * broken set entries.
 */

export const BACKUP_TABLES = [
  'puzzles',
  'woodpecker_sets',
  'lesson_progress',
  'custom_lessons',
  'saved_reviews',
  'pgn_courses',
  'line_progress',
  'puzzle_sets',
  'puzzle_cycles',
  'puzzle_attempts',
  'played_games',
  'active_game',
  // Rebuildable cache, but exporting it keeps a restore consistent with the
  // puzzle rows that were downloaded from published shards.
  'puzzle_shards',
] as const;

export type BackupTable = (typeof BACKUP_TABLES)[number];

export interface BackupPayload {
  app: 'chess-trainer';
  version: 1;
  exported_at: string;
  tables: Partial<Record<BackupTable, unknown[]>>;
}

export interface RestoreSummary {
  tables: Partial<Record<BackupTable, number>>;
  total: number;
}

export async function createBackup(): Promise<BackupPayload> {
  const tables: Partial<Record<BackupTable, unknown[]>> = {};
  for (const name of BACKUP_TABLES) {
    tables[name] = await db.table(name).toArray();
  }
  return {
    app: 'chess-trainer',
    version: 1,
    exported_at: new Date().toISOString(),
    tables,
  };
}

export function downloadBackup(payload: BackupPayload): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `chess-trainer-backup-${payload.exported_at.slice(0, 10)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Replaces the local tables with the backup's contents. */
export async function restoreBackup(file: File): Promise<RestoreSummary> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('That file is not valid JSON.');
  }

  const payload = parsed as Partial<BackupPayload> | null;
  if (!payload || payload.app !== 'chess-trainer' || !payload.tables) {
    throw new Error('That is not a Chess Trainer backup file.');
  }

  const summary: RestoreSummary = { tables: {}, total: 0 };

  await db.transaction(
    'rw',
    BACKUP_TABLES.map((name) => db.table(name)),
    async () => {
      for (const name of BACKUP_TABLES) {
        const rows = payload.tables?.[name];
        if (!Array.isArray(rows)) continue;
        if (rows.some((row) => typeof row !== 'object' || row === null)) {
          throw new Error(`The "${name}" table in that backup is malformed.`);
        }
        const table = db.table(name);
        await table.clear();
        await table.bulkPut(rows);
        summary.tables[name] = rows.length;
        summary.total += rows.length;
      }
    },
  );

  if (summary.total === 0) {
    throw new Error('That backup contains no data for this app.');
  }

  return summary;
}
