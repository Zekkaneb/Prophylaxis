import { db } from '../db.ts';
import { recordSyncedChange } from '../sync/outbox.ts';
import { STANDARD_START_FEN } from './pgn.ts';
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
  /* The live game is gone once it is archived, and the other devices need to
     hear that or they keep offering to resume it. */
  await recordSyncedChange('active_game', record.game_id, true);
}

/* ------------------------------- active game ------------------------------ */

/**
 * Stores the unfinished game. The table holds at most one row, so replacing it
 * here is the same "one live game" rule the UI enforces with its confirmation.
 */
export async function saveActiveGame(record: ActiveGameRecord): Promise<void> {
  let removed: string[] = [];

  await enqueue(async () => {
    await db.transaction('rw', db.active_game, async () => {
      /* Named before the clear: the row it replaces has to be tombstoned, and
         after the clear there is nothing left to name it. */
      removed = (await db.active_game.toCollection().primaryKeys()).map(String);
      await db.active_game.clear();
      await db.active_game.put(record);
    });
  });

  await recordSyncedChange('active_game', record.game_id, false);
  for (const id of removed) {
    if (id !== record.game_id) await recordSyncedChange('active_game', id, true);
  }
}

export async function loadActiveGame(): Promise<ActiveGameRecord | undefined> {
  const rows = await db.active_game.toArray();
  if (rows.length === 0) return undefined;
  /* Newest wins if an older build ever left more than one row behind. */
  const usable = rows
    .map((row) => normaliseActiveGame(row))
    .filter((row): row is ActiveGameRecord => row !== null);
  if (usable.length === 0) return undefined;
  return usable.sort((a, b) => b.updated_at - a.updated_at)[0];
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Rebuilds a usable record from whatever the table holds.
 *
 * `active_game` arrives from two writers that can both be older than this
 * build: the local save path and a sync pull from another device. A row without
 * `sans` (or a colour, or clocks) used to throw while the Play room rendered it
 * — "cannot read properties of undefined" — and a render throw unmounts the
 * app, which reads as a blank page for that one account and nobody else.
 * Filling the gaps is harmless; crashing is not. A row with no id or no
 * position cannot be a game and is skipped.
 */
export function normaliseActiveGame(raw: unknown): ActiveGameRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Partial<ActiveGameRecord>;

  const gameId = typeof row.game_id === 'string' ? row.game_id : '';
  if (!gameId) return null;

  const initialFen =
    typeof row.initial_fen === 'string' && row.initial_fen ? row.initial_fen : STANDARD_START_FEN;
  const currentFen =
    typeof row.current_fen === 'string' && row.current_fen ? row.current_fen : initialFen;

  const playerColor = row.player_color === 'b' ? 'b' : 'w';
  const whiteMs = numberOr(row.white_ms, numberOr(row.initial_seconds, 0) * 1000);
  const blackMs = numberOr(row.black_ms, whiteMs);
  const startedAt = numberOr(row.started_at, 0);

  return {
    game_id: gameId,
    opponent_id: typeof row.opponent_id === 'string' ? row.opponent_id : 'unknown',
    opponent_name: typeof row.opponent_name === 'string' ? row.opponent_name : 'Opponent',
    opponent_elo: numberOr(row.opponent_elo, 1200),
    opponent_kind: row.opponent_kind === 'general' ? 'general' : 'personality',
    player_color: playerColor,
    orientation: row.orientation === 'black' ? 'black' : 'white',
    initial_fen: initialFen,
    current_fen: currentFen,
    sans: Array.isArray(row.sans) ? row.sans.filter((san) => typeof san === 'string') : [],
    pgn: typeof row.pgn === 'string' ? row.pgn : '',
    initial_seconds: numberOr(row.initial_seconds, 0),
    increment_seconds: numberOr(row.increment_seconds, 0),
    time_control_id: typeof row.time_control_id === 'string' ? row.time_control_id : 'custom',
    untimed: row.untimed === true,
    white_ms: whiteMs,
    black_ms: blackMs,
    active_clock: row.active_clock === 'w' || row.active_clock === 'b' ? row.active_clock : null,
    clock_started: row.clock_started === true,
    paused: row.paused === true,
    started_at: startedAt,
    last_sync_at: numberOr(row.last_sync_at, startedAt),
    status: row.status === 'finished' ? 'finished' : 'playing',
    result: row.result ?? null,
    reason: row.reason ?? null,
    ended_at: typeof row.ended_at === 'number' ? row.ended_at : null,
    updated_at: numberOr(row.updated_at, startedAt),
  };
}

/** Removes the active row (optionally only when it is still `gameId`). */
export async function clearActiveGame(gameId?: string): Promise<void> {
  const removed: string[] = [];

  await enqueue(async () => {
    if (gameId) {
      const current = await db.active_game.get(gameId);
      if (current) {
        await db.active_game.delete(gameId);
        removed.push(gameId);
      }
      return;
    }
    removed.push(...(await db.active_game.toCollection().primaryKeys()).map(String));
    await db.active_game.clear();
  });

  for (const id of removed) await recordSyncedChange('active_game', id, true);
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
