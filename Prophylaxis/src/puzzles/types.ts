/**
 * Puzzle domain types.
 *
 * Deliberately free of Dexie and React so the ingestion pipeline, the selection
 * engine and `node --test` can share them. `src/db.ts` re-exports `StoredPuzzle`
 * as `Puzzle`, which is what the app code has always imported.
 */

import type { PuzzleTierSlug } from './tiers.ts';

/**
 * One normalized puzzle, exactly as stored in the `puzzles` table.
 *
 * The first five fields are the original app shape (game-review puzzles and the
 * mock pool still fill only those). Everything else is Lichess metadata and is
 * optional so older rows keep working.
 */
export interface StoredPuzzle {
  /** Lichess puzzle id, e.g. `00sHx`. Primary key. */
  puzzle_id: string;
  /** FEN of the position *before* the opponent's setup move. */
  fen: string;
  /** Space separated UCI: opponent setup first, then the solution. */
  moves: string;
  /**
   * Difficulty on the chess.com puzzle scale. The library is Lichess-sourced,
   * so imports and published pools are shifted once (see `tiers.ts`).
   */
  rating: number;
  /** Lichess theme tags, e.g. `["fork", "middlegame"]`. */
  themes: string[];

  /** Rating deviation (lower = more trustworthy). */
  rating_deviation?: number;
  /** Lichess popularity, −100…100. */
  popularity?: number;
  /** How many times the puzzle has been played on Lichess. */
  plays?: number;
  /** Link to the game the puzzle was taken from. */
  game_url?: string;
  /** Opening tags from the source game, e.g. `["Italian_Game"]`. */
  opening_tags?: string[];
  /** `DailyDate` column: only filled for puzzles used as Lichess's daily puzzle. */
  daily_date?: string;
  /** Where the row came from, for provenance. */
  source?: PuzzleSource;
  /** Epoch ms. */
  imported_at?: number;
  /**
   * Set when the row came from a published shard, e.g.
   * `intermediate:1734567890123:2`. Rows imported from the legacy single-tier
   * file, mock data and reviews have no shard id, which is how pruning tells
   * "downloaded pool" apart from "user data".
   */
  shard_id?: string;
}

/**
 * One published shard this device has downloaded (or failed to download).
 *
 * Shard state lives in Dexie rather than localStorage so the coverage decision
 * survives a storage clear of browser preferences, is included in the backup,
 * and can be queried transactionally beside the puzzles it describes.
 */
export interface PuzzleShardState {
  /** `${tier_slug}:${manifest_version}:${shard_index}` — primary key. */
  id: string;
  tier_slug: string;
  manifest_version: number;
  shard_index: number;
  file: string;
  status: 'downloaded' | 'failed';
  /** Rows written for this shard (after duplicate-id collapsing). */
  puzzle_count: number;
  attempts: number;
  downloaded_at: number;
  last_error?: string;
}

export type PuzzleSource = 'lichess' | 'review' | 'mock' | 'generated';

/** One row of the Lichess Open Puzzle Database (already split into fields). */
export interface LichessPuzzleRecord {
  puzzle_id: string;
  fen: string;
  /** Raw UCI sequence, opponent setup move first. */
  moves: string[];
  rating: number;
  rating_deviation: number;
  popularity: number;
  plays: number;
  themes: string[];
  game_url: string;
  opening_tags: string[];
  /** 11th official column (`DailyDate`); usually empty. */
  daily_date?: string;
}

/** Quality gates applied before selection. All optional; 0/[] means "no gate". */
export interface PuzzleQualityFilters {
  /** Lichess popularity floor (−100…100). */
  minPopularity?: number;
  /** Rating-deviation ceiling; lower RD means a more settled rating. */
  maxRatingDeviation?: number;
  /** Minimum number of Lichess plays. */
  minPlays?: number;
  /** Keep only puzzles carrying at least one of these themes. */
  requiredThemes?: string[];
  /** Drop puzzles carrying any of these themes. */
  excludedThemes?: string[];
}

/**
 * Defaults used when a caller does not supply filters: popular, settled, well
 * played positions. They are intentionally light — the library stays complete,
 * only the curated chunks and selections are filtered.
 */
export const DEFAULT_QUALITY_FILTERS: Required<
  Pick<PuzzleQualityFilters, 'minPopularity' | 'maxRatingDeviation' | 'minPlays'>
> = {
  minPopularity: 80,
  maxRatingDeviation: 100,
  minPlays: 50,
};

export type SelectionMethod = 'random' | 'balanced';

/** What a caller asks for when freezing a training set. */
export interface TrainingSetConfig {
  name?: string;
  tier: PuzzleTierSlug;
  /** Unique puzzles in the set, frozen forever. */
  puzzleCount: number;
  /** How many passes over the same set the training programme plans. */
  cycles: number;
  selection: SelectionMethod;
  quality?: PuzzleQualityFilters;
  /** Seeds the shuffle so a set can be reproduced. */
  seed?: number;
  /** Balanced selection: spread picks across these themes (default: all). */
  balanceThemes?: string[];
}

/**
 * A frozen training set definition.
 *
 * `puzzle_ids` is immutable by contract: creation is the only writer. Cycles and
 * attempts reference it, they never rebuild it.
 */
export interface PuzzleTrainingSet {
  set_id: string;
  name: string;
  tier_slug: PuzzleTierSlug;
  tier_name: string;
  selection_method: SelectionMethod;
  /** Length of `puzzle_ids`; kept for cheap listing. */
  puzzle_count: number;
  /** Planned number of cycles. */
  cycle_target: number;
  quality_filters: PuzzleQualityFilters;
  seed: number | null;
  /** Frozen membership, in the order the cycles must follow. */
  puzzle_ids: string[];
  created_at: number;
}

export type CycleStatus = 'pending' | 'in-progress' | 'completed';

/** Progress for one pass over a training set. One row per set per cycle. */
export interface PuzzleCycleProgress {
  /** `${set_id}:${cycle_num}` — primary key. */
  cycle_id: string;
  set_id: string;
  /** 1-based. */
  cycle_num: number;
  status: CycleStatus;
  started_at: number | null;
  completed_at: number | null;
  /** Wall-clock time from the first attempt to completion. */
  elapsed_ms: number;
  /** Sum of the per-puzzle solving times. */
  total_solve_time_ms: number;
  /** Puzzles answered correctly at least once in this cycle. */
  solved_count: number;
  /** Puzzles solved on the first attempt. */
  correct_count: number;
  /** Puzzles that have at least one wrong attempt. */
  incorrect_count: number;
  /** Total attempts, right or wrong. */
  attempt_count: number;
  /** 0–100, first attempts only. */
  first_attempt_accuracy: number;
}

/** One puzzle's history inside one cycle. */
export interface PuzzleAttempt {
  /** `${set_id}:${cycle_num}:${puzzle_id}` — primary key. */
  attempt_id: string;
  set_id: string;
  cycle_num: number;
  puzzle_id: string;
  /** How many times the puzzle was tried, right or wrong. */
  attempts: number;
  first_attempt_correct: boolean;
  /** True once any attempt was wrong. */
  incorrect: boolean;
  /** True once a correct attempt happened. */
  solved: boolean;
  /** Total time spent on the puzzle, ms. */
  time_ms: number;
  first_attempt_at: number;
  last_attempt_at: number;
  completed_at: number | null;
}

/** Aggregated numbers over a set of attempts. */
export interface AttemptSummary {
  solved_count: number;
  correct_count: number;
  incorrect_count: number;
  attempt_count: number;
  first_attempt_accuracy: number;
  total_solve_time_ms: number;
}

/** Per-cycle summary returned by the service and shown by future UIs. */
export interface CycleProgressSummary extends AttemptSummary {
  cycle_id: string;
  cycle_num: number;
  status: CycleStatus;
  started_at: number | null;
  completed_at: number | null;
  elapsed_ms: number;
}

/** Whole-programme view: cycles + overall training progress. */
export interface TrainingSetProgress {
  set_id: string;
  tier_slug: PuzzleTierSlug;
  puzzle_count: number;
  cycle_target: number;
  cycles_started: number;
  cycles_completed: number;
  /** Distinct puzzles solved at least once across all cycles. */
  puzzles_solved_ever: number;
  first_attempt_accuracy: number;
  attempt_count: number;
  total_time_ms: number;
  /** 0–100. */
  percent_complete: number;
  cycles: CycleProgressSummary[];
}
