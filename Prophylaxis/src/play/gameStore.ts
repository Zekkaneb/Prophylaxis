import { db } from '../db.ts';
import { recordSyncedChange } from '../sync/outbox.ts';
import type { ActiveGameRecord, PlayedGameRecord } from './types.ts';

/**
 * Local persistence for played games and the one unfinished game. Uses the
 * app's single Dexie database; no parallel storage system is introduced.
 *
 * Writes are serialised: a pause that lands while a move is being written can
 * never finish first and leave an older position stored. Only discrete events
 * call these functions — the running clock is never written per frame.
 */

let writeQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task, task);
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/* --------------------------------- history -------------------------------- */

export async function savePlayedGame(record: PlayedGameRecord): Promise<void> {
  await enqueue(() => db.played_games.put(record));
  await recordSyncedChange('played_games', record.game_id, false);
}

export async function listPlayedGames(limit = 100): Promise<PlayedGameRecord[]> {
  return db.played_games.orderBy('ended_at').reverse().limit(limit).toArray();
}

export async function getPlayedGame(gameId: string): Promise<PlayedGameRecord | undefined> {
  return db.played_games.get(gameId);
}

export async function deletePlayedGame(gameId: string): Promise<void> {
  await enqueue(() => db.played_games.delete(gameId));
  await recordSyncedChange('played_games', gameId, true);
}

/**
 * Archives a completed game exactly once and drops it from the active slot.
 *
 * `put` is keyed by `game_id`, so retrying after a failed write cannot create a
 * second history entry; the active row is only removed after the archive write
 * succeeds, so a crash in between loses nothing.
 */
export async function finalizePlayedGame(record: PlayedGameRecord): Promise<void> {
  await enqueue(async () => {
    await db.transaction('rw', db.played_games, db.active_game, async () => {
      await db.played_games.put(record);
      await db.active_game.delete(record.game_id);
    });
  });
  await recordSyncedChange('played_games', record.game_id, false);
}

/* ------------------------------- active game ------------------------------ */

/**
 * Stores the unfinished game. The table holds at most one row, so replacing it
 * here is the same "one live game" rule the UI enforces with its confirmation.
 */
export async function saveActiveGame(record: ActiveGameRecord): Promise<void> {
  await enqueue(async () => {
    await db.transaction('rw', db.active_game, async () => {
      await db.active_game.clear();
      await db.active_game.put(record);
    });
  });
}

export async function loadActiveGame(): Promise<ActiveGameRecord | undefined> {
  const rows = await db.active_game.toArray();
  if (rows.length === 0) return undefined;
  /* Newest wins if an older build ever left more than one row behind. */
  return rows.sort((a, b) => b.updated_at - a.updated_at)[0];
}

/** Removes the active row (optionally only when it is still `gameId`). */
export async function clearActiveGame(gameId?: string): Promise<void> {
  await enqueue(async () => {
    if (gameId) {
      const current = await db.active_game.get(gameId);
      if (current) await db.active_game.delete(gameId);
      return;
    }
    await db.active_game.clear();
  });
}

/* ---------------------------------- pgn ----------------------------------- */

/** Starts a PGN download for a stored game. */
export function downloadPgn(record: PlayedGameRecord): void {
  const blob = new Blob([record.pgn], { type: 'application/x-chess-pgn' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const date = new Date(record.ended_at).toISOString().slice(0, 10);
  anchor.href = url;
  anchor.download = `${record.opponent_id}-${date}.pgn`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
