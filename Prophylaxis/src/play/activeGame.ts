import type {
  ActiveGameRecord,
  GameConfig,
  PlayColor,
  PlayResult,
  PlayedGameRecord,
  ResultReason,
} from './types.ts';
import { opponentFullName, type OpponentProfile } from './opponents.ts';
import { loadPlayerProfile, playerDisplayName } from '../profile/playerProfile.ts';
import { STANDARD_START_FEN, buildPgn } from './pgn.ts';

/**
 * Conversion between a live session, the persisted active game and the
 * finished history record.
 *
 * Pure functions only: the hook owns timers and React state, these functions
 * own the shape of what is written to IndexedDB.
 */

export interface ActiveRecordInput {
  id: string;
  opponent: OpponentProfile;
  config: GameConfig;
  playerColor: PlayColor;
  orientation: 'white' | 'black';
  initialFen: string;
  currentFen: string;
  sans: readonly string[];
  whiteMs: number;
  blackMs: number;
  active: PlayColor | null;
  clockStarted: boolean;
  paused: boolean;
  startedAt: number;
  now: number;
}

/** The PGN for an unfinished game, result `*`. */
export function activePgn(
  input: Pick<
    ActiveRecordInput,
    'opponent' | 'config' | 'playerColor' | 'initialFen' | 'sans' | 'startedAt'
  >,
): string {
  const player = loadPlayerProfile();
  const playerName = playerDisplayName(player);
  const opponentName = opponentFullName(input.opponent);
  const white = input.playerColor === 'w' ? playerName : opponentName;
  const black = input.playerColor === 'b' ? playerName : opponentName;
  return buildPgn(
    {
      white,
      black,
      result: '*',
      date: input.startedAt,
      timeControl: input.config.untimed
        ? '-'
        : `${input.config.initialSeconds}+${input.config.incrementSeconds}`,
      whiteElo: input.playerColor === 'w' ? player.elo : input.opponent.elo,
      blackElo: input.playerColor === 'b' ? player.elo : input.opponent.elo,
      startingFen: input.initialFen,
    },
    input.sans,
  );
}

export function createActiveRecord(input: ActiveRecordInput): ActiveGameRecord {
  return {
    game_id: input.id,
    opponent_id: input.opponent.id,
    opponent_name: opponentFullName(input.opponent),
    opponent_elo: input.opponent.elo,
    opponent_kind: input.opponent.kind,
    player_color: input.playerColor,
    orientation: input.orientation,
    initial_fen: input.initialFen || STANDARD_START_FEN,
    current_fen: input.currentFen,
    sans: [...input.sans],
    pgn: activePgn(input),
    initial_seconds: input.config.initialSeconds,
    increment_seconds: input.config.incrementSeconds,
    time_control_id: input.config.timeControlId,
    untimed: input.config.untimed,
    white_ms: Math.max(0, Math.round(input.whiteMs)),
    black_ms: Math.max(0, Math.round(input.blackMs)),
    active_clock: input.active,
    clock_started: input.clockStarted,
    paused: input.paused,
    started_at: input.startedAt,
    last_sync_at: input.now,
    status: 'playing',
    result: null,
    reason: null,
    ended_at: null,
    updated_at: input.now,
  };
}

/** Folds the final result into the active row before it is archived. */
export function finishActiveRecord(
  record: ActiveGameRecord,
  result: PlayResult,
  reason: ResultReason,
  endedAt: number,
  finalFen: string,
): ActiveGameRecord {
  return {
    ...record,
    status: 'finished',
    result,
    reason,
    ended_at: endedAt,
    current_fen: finalFen,
    active_clock: null,
    paused: true,
    updated_at: endedAt,
  };
}

/**
 * Builds the history row for a completed active game. The PGN is regenerated
 * with the real result so an export never carries the `*` placeholder.
 */
export function activeToPlayedGame(record: ActiveGameRecord): PlayedGameRecord {
  if (record.status !== 'finished' || !record.result || !record.reason) {
    throw new Error('Only a finished game can be archived.');
  }

  const endedAt = record.ended_at ?? record.updated_at;
  const player = loadPlayerProfile();
  const playerName = playerDisplayName(player);
  const white = record.player_color === 'w' ? playerName : record.opponent_name;
  const black = record.player_color === 'b' ? playerName : record.opponent_name;

  const pgn = buildPgn(
    {
      white,
      black,
      result: record.result,
      date: endedAt,
      timeControl: record.untimed ? '-' : `${record.initial_seconds}+${record.increment_seconds}`,
      whiteElo: record.player_color === 'w' ? player.elo : record.opponent_elo,
      blackElo: record.player_color === 'b' ? player.elo : record.opponent_elo,
      startingFen: record.initial_fen,
    },
    record.sans,
  );

  return {
    game_id: record.game_id,
    opponent_id: record.opponent_id,
    opponent_name: record.opponent_name,
    opponent_elo: record.opponent_elo,
    opponent_kind: record.opponent_kind,
    player_color: record.player_color,
    result: record.result,
    reason: record.reason,
    pgn,
    sans: [...record.sans],
    initial_seconds: record.initial_seconds,
    increment_seconds: record.increment_seconds,
    started_at: record.started_at,
    ended_at: endedAt,
    duration_seconds: Math.max(1, Math.round((endedAt - record.started_at) / 1000)),
    final_fen: record.current_fen,
    starting_fen: record.initial_fen,
    board_orientation: record.orientation,
    time_control_id: record.time_control_id,
  };
}

/** True when the persisted position and move text disagree (corrupt record). */
export function recordLooksConsistent(record: ActiveGameRecord): boolean {
  return (
    typeof record.game_id === 'string' &&
    record.game_id.length > 0 &&
    typeof record.initial_fen === 'string' &&
    typeof record.opponent_id === 'string' &&
    record.opponent_name.length > 0 &&
    Array.isArray(record.sans) &&
    record.sans.every((san) => typeof san === 'string') &&
    Number.isFinite(record.white_ms) &&
    Number.isFinite(record.black_ms) &&
    Number.isFinite(record.started_at)
  );
}
