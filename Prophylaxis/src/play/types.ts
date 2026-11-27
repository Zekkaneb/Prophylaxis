/**
 * Playing domain types.
 *
 * Free of React, Dexie and the DOM so the clock, opponent and history logic can
 * be tested in Node and reused by a future online/sync layer.
 */

export type PlayColor = 'w' | 'b';

/** Board orientation is written out in words, matching the board component. */
export type PlayOrientation = 'white' | 'black';

/** The side the user chose on the setup screen (`random` resolves at start). */
export type ColorChoice = PlayColor | 'random';

/** Standard PGN result. */
export type PlayResult = '1-0' | '0-1' | '1/2-1/2';

export type ResultReason =
  | 'checkmate'
  | 'resignation'
  | 'timeout'
  | 'stalemate'
  | 'insufficient-material'
  | 'threefold-repetition'
  | 'fifty-move'
  | 'agreement';

/** Everything the setup form collects; resolved before a game starts. */
export interface GameConfig {
  color: ColorChoice;
  /** `'untimed'` or a preset/custom id, kept for display and history. */
  timeControlId: string;
  initialSeconds: number;
  incrementSeconds: number;
  untimed: boolean;
}

/** One finished game, stored locally. */
export interface PlayedGameRecord {
  game_id: string;
  /** Absent on games saved before bot-vs-bot existed. */
  mode?: 'human' | 'bot-vs-bot';
  /** Bot-vs-bot sides; `opponent_*` still carries Black for compatibility. */
  white_opponent_id?: string;
  black_opponent_id?: string;
  white_name?: string;
  black_name?: string;
  white_elo?: number;
  black_elo?: number;
  opponent_id: string;
  opponent_name: string;
  opponent_elo: number;
  opponent_kind: 'personality' | 'general';
  player_color: PlayColor;
  /** Result from White's point of view. */
  result: PlayResult;
  reason: ResultReason;
  /** Full PGN, headers included. */
  pgn: string;
  /** SAN move list, in order. */
  sans: string[];
  /**
   * 0-based ply indices that came from a prepared line — a repertoire, the
   * practice course or a character's opening plan — not from a search.
   *
   * Game Review labels these Book and leaves them out of accuracy: theory is
   * recall, so counting it as a perfect decision flatters whoever happened to
   * have it on file.
   */
  book_plies?: number[];
  initial_seconds: number;
  increment_seconds: number;
  started_at: number;
  ended_at: number;
  duration_seconds: number;
  final_fen: string;
  /** Present only for games that did not start from the standard position. */
  starting_fen?: string;
  /** Board orientation the player finished the game with. */
  board_orientation?: PlayOrientation;
  /** Preset/custom id from the setup screen (`5+0`, `custom-600+5`, …). */
  time_control_id?: string;
  /**
   * This game's performance rating: the opponent's strength adjusted by the
   * result. The title norms average these. Absent on unrated games.
   */
  performance_rating?: number;
  /** How much the ladder moved for this game, as printed in the history. */
  rating_delta?: number;
  /** The rating after the game settled. */
  rating_after?: number;
}

/**
 * The one unfinished game kept in IndexedDB.
 *
 * Everything needed to rebuild the session without the React tree: the moves,
 * both clock values, which side was to move and when the clock was last
 * synchronised. It is written on discrete events only (moves, pauses, flips,
 * completion) — never on a timer tick.
 */
export interface ActiveGameRecord {
  game_id: string;
  opponent_id: string;
  opponent_name: string;
  opponent_elo: number;
  opponent_kind: 'personality' | 'general';
  player_color: PlayColor;
  orientation: PlayOrientation;
  initial_fen: string;
  current_fen: string;
  sans: string[];
  /** SAN text at save time; used as a fallback if a ply ever fails to replay. */
  pgn: string;
  initial_seconds: number;
  increment_seconds: number;
  time_control_id: string;
  untimed: boolean;
  white_ms: number;
  black_ms: number;
  active_clock: PlayColor | null;
  clock_started: boolean;
  /** True when the clock was deliberately held (bot's turn with the board hidden). */
  paused: boolean;
  started_at: number;
  /**
   * Time spent at the board, accumulated only while the game was live and on
   * screen. Missing on rows written before it was tracked, which fall back to
   * wall-clock time when archived.
   */
  elapsed_ms?: number;
  /** Epoch ms of the clock reading stored above. */
  last_sync_at: number;
  status: 'playing' | 'finished';
  result: PlayResult | null;
  reason: ResultReason | null;
  ended_at: number | null;
  updated_at: number;
}

/** Human-readable outcome for a stored game. */
export function gameOutcome(record: PlayedGameRecord): {
  score: string;
  tone: 'win' | 'loss' | 'draw';
  label: string;
} {
  const playerWon =
    (record.result === '1-0' && record.player_color === 'w') ||
    (record.result === '0-1' && record.player_color === 'b');

  if (record.result === '1/2-1/2') {
    return { score: '½–½', tone: 'draw', label: 'Draw' };
  }
  return playerWon
    ? { score: record.result, tone: 'win', label: 'Win' }
    : { score: record.result, tone: 'loss', label: 'Loss' };
}

/** Sentence shown when a game ends. */
export function resultReasonLabel(reason: ResultReason): string {
  switch (reason) {
    case 'checkmate':
      return 'Checkmate';
    case 'resignation':
      return 'Resignation';
    case 'timeout':
      return 'Time out';
    case 'stalemate':
      return 'Stalemate';
    case 'insufficient-material':
      return 'Insufficient material';
    case 'threefold-repetition':
      return 'Threefold repetition';
    case 'fifty-move':
      return 'Fifty-move rule';
    case 'agreement':
      return 'Draw agreed';
  }
}
