import Dexie, { type EntityTable } from 'dexie';

/**
 * Local-first persistence layer.
 *
 * Everything lives in the browser's IndexedDB: no server, no accounts, no sync.
 * Lightweight UI preferences (theme, sound, resume pointers) stay in
 * `localStorage` and are deliberately NOT part of this schema.
 */

import type { PgnCourseRecord } from './courses/types';
import type { ActiveGameRecord, PlayedGameRecord } from './play/types';
import type {
  PuzzleAttempt,
  PuzzleCycleProgress,
  PuzzleShardState,
  PuzzleTrainingSet,
  StoredPuzzle,
} from './puzzles/types';
import { LICHESS_TO_CHESSCOM_SHIFT } from './puzzles/tiers.ts';

export const DB_NAME = 'chess-trainer-db';
export const DB_SCHEMA_VERSION = 10;

/**
 * One local change waiting to be uploaded.
 *
 * No payload is stored: push reads the row's current state from its own table,
 * so a row written many times while it is being used uploads once. See
 * `src/sync/outbox.ts`.
 */
export interface SyncOutboxRow {
  id?: number;
  table_name: string;
  row_id: string;
  /** Epoch ms on this device, monotonic within a session. */
  updated_at: number;
  deleted: boolean;
}

/** Small key/value scratch space for sync cursors. */
export interface SyncMetaRow {
  key: string;
  value: string;
}

/* -------------------------------------------------------------------------- */
/*                                  Puzzles                                   */
/* -------------------------------------------------------------------------- */

/**
 * A puzzle row, seeded on demand from `/public/puzzles/{tier}.json` or imported
 * from the Lichess Open Puzzle Database. The normalized shape lives in
 * `puzzles/types.ts` so scripts and tests can use it without Dexie.
 */
export type Puzzle = StoredPuzzle;

/* -------------------------------------------------------------------------- */
/*                              Woodpecker sets                               */
/* -------------------------------------------------------------------------- */

/** One finished pass over a frozen set of puzzles. */
export interface WoodpeckerCycleResult {
  /** 1-based cycle this result belongs to. */
  cycle_num: number;
  /** Seconds spent actively solving the whole cycle. */
  total_time_seconds: number;
  /** Puzzles solved cleanly on the first attempt. */
  correct_count: number;
  /** Puzzles in the cycle (always equals `puzzle_ids.length`). */
  total_count: number;
}

/** A frozen, ordered set of puzzles repeated over multiple cycles. */
export interface WoodpeckerSet {
  set_id: string;
  /** Difficulty tier label, e.g. `"Intermediate"`. */
  tier_name: string;
  /** Frozen ids in fixed order; never reshuffled between cycles. */
  puzzle_ids: string[];
  /** 1-based active cycle. */
  current_cycle: number;
  history: WoodpeckerCycleResult[];
  /** Epoch ms, used to list sets newest first. */
  created_at: number;
  /** Planned number of cycles; absent/0 means unlimited (legacy sets). */
  cycle_target?: number;
  /** Seconds allowed per cycle; absent/0 means no limit (legacy sets). */
  time_limit_seconds?: number;
}

/* -------------------------------------------------------------------------- */
/*                               Lesson progress                              */
/* -------------------------------------------------------------------------- */

/** Progress for one chunked opening lesson. */
export interface LessonProgress {
  lesson_id: string;
  /** Number of chunks whose quiz has been passed. */
  completed_chunks: number;
  is_completed: boolean;
  /** Epoch ms. */
  last_practiced: number;
}

/* -------------------------------------------------------------------------- */
/*                                Game reviews                                */
/* -------------------------------------------------------------------------- */

/* Classification vocabulary lives in the central config; re-exported here so
   existing `from '../db'` imports keep working. */
export type { MoveClassification } from './config/moveClassifications';
import type { MoveClassification } from './config/moveClassifications';

/** Per-ply engine analysis produced by the local Stockfish worker. */
export interface MoveEvaluation {
  /** 1-based ply (half-move) index within the game. */
  ply: number;
  /** Full move number, starting at 1. */
  move_number: number;
  /** Side that played the move. */
  color: 'w' | 'b';
  /** Played move, SAN and UCI. */
  san: string;
  uci: string;
  fen_before: string;
  fen_after: string;
  /** Centipawn score from White's point of view before the move. */
  eval_before: number;
  /** Centipawn score from White's point of view after the move. */
  eval_after: number;
  /** Forced mate distance (signed, in moves) when the engine reports mate. */
  mate_before: number | null;
  mate_after: number | null;
  /** Engine's best move in UCI, from the position before the move. */
  best_move: string;
  /** Principal variation in UCI, best line first. */
  best_line: string[];
  /** Centipawn loss compared with the engine's best move. */
  centipawn_loss: number;
  classification: MoveClassification;
  /** PV2 first move (MultiPV 2), UCI. */
  second_best_move?: string;
  /** White-POV score of the second-best line. */
  second_eval?: number;
  second_mate?: number | null;
  /** Shallow (depth 6) score of the position after the move, White POV. */
  shallow_score_cp?: number;
  /** Shallow mate distance after the move, White POV. */
  shallow_mate?: number | null;
  /** Win-probability gap to the runner-up line, in points (0–100). */
  second_best_win_gap?: number;
  /** True when the defending-position rule escalated the label. */
  escalated?: boolean;
  /** Per-move accuracy (0–100) under the weighted model. */
  accuracy?: number;
}

/** A lesson imported from a PGN line by the user. */
export interface CustomLessonRecord {
  lesson_id: string;
  title: string;
  repertoire_color: 'white' | 'black';
  /** Defaults to the standard starting position. */
  starting_fen?: string;
  moves: Array<{ uci: string; san: string; explanation: string }>;
  /** Epoch ms. */
  created_at: number;
}

/**
 * Quiz history for one chapter of one course.
 *
 * `mastery` is 0–3: 0 never passed, 1 passed once, 2 passed twice, 3 solid.
 * The drill tab uses it to choose what is due.
 */
export interface LineProgress {
  /** `${course_id}:${chapter_id}` — one row per chapter. */
  id: string;
  course_id: string;
  chapter_id: string;
  attempts: number;
  /** Best clean-move percentage across attempts (0–100). */
  best_percent: number;
  last_percent: number;
  /** Epoch ms. */
  last_drilled: number;
  mastery: number;
}

/** A completed, locally stored game review. */
export interface SavedReview {
  game_id: string;
  pgn: string;
  white_player: string;
  black_player: string;
  /** `WhiteElo` tag from the PGN, when it carried one. */
  white_elo?: string | null;
  /** `BlackElo` tag from the PGN, when it carried one. */
  black_elo?: string | null;
  evaluations: MoveEvaluation[];
  /** Epoch ms. */
  created_at: number;
}

/* -------------------------------------------------------------------------- */
/*                                   Schema                                   */
/* -------------------------------------------------------------------------- */

/**
 * Indexes:
 * - `puzzles`: primary key `puzzle_id`, rating indexed for tier sampling,
 *   multi-entry `*themes` for theme filters.
 * - `woodpecker_sets`: primary key `set_id`, tier + creation date indexed.
 * - `lesson_progress`: primary key `lesson_id`, completion + recency indexed.
 * - `saved_reviews`: primary key `game_id`, creation date indexed.
 */
const schemaV1 = {
  puzzles: 'puzzle_id, rating, *themes',
  woodpecker_sets: 'set_id, tier_name, created_at',
  lesson_progress: 'lesson_id, is_completed, last_practiced',
  saved_reviews: 'game_id, created_at',
} as const;

/** v2 adds user-imported lessons; existing stores are unchanged. */
const schemaV2 = {
  ...schemaV1,
  custom_lessons: 'lesson_id, created_at',
} as const;

/** v3 adds imported PGN courses (one row per file, chapters inside). */
const schemaV3 = {
  ...schemaV2,
  pgn_courses: 'course_id, imported_at',
} as const;

/** v4 adds per-chapter quiz/drill history. */
const schemaV4 = {
  ...schemaV3,
  line_progress: 'id, course_id, last_drilled',
} as const;

/**
 * v5 adds the training-set tables. The existing `woodpecker_sets` history is
 * left untouched so the current trainer keeps all of its data.
 */
const schemaV5 = {
  ...schemaV4,
  puzzle_sets: 'set_id, tier_slug, created_at',
  puzzle_cycles: 'cycle_id, set_id, [set_id+cycle_num], status',
  puzzle_attempts: 'attempt_id, set_id, [set_id+cycle_num], puzzle_id',
} as const;

/**
 * v6 adds the published-shard bookkeeping. `puzzles` gains a `shard_id` index
 * (non-unique, empty for legacy/mock/review rows) so pruning can find a shard's
 * rows without scanning the table. No data is migrated or removed.
 */
const schemaV6 = {
  ...schemaV5,
  puzzles: 'puzzle_id, rating, *themes, shard_id',
  puzzle_shards: 'id, tier_slug, status, [tier_slug+manifest_version]',
} as const;

/**
 * v7 stores finished games played against the bots. Independent of
 * `saved_reviews` (which holds review analyses), so neither table has to be
 * migrated or reshaped.
 */
const schemaV7 = {
  ...schemaV6,
  played_games: 'game_id, ended_at, opponent_id',
} as const;

/**
 * v8 adds the single unfinished game. A new store only: `played_games` and
 * every other table keep their rows and indexes, so the upgrade is additive.
 */
const schemaV8 = {
  ...schemaV7,
  active_game: 'game_id, updated_at',
} as const;

/**
 * v9 moves stored puzzle ratings from the Lichess scale to the chess.com scale
 * the trainer displays (`puzzles/tiers.ts` explains the offset). No store or
 * index changes: rows already in the browser keep their ids, themes and
 * provenance, and every saved training set keeps resolving its membership. Rows
 * downloaded after this upgrade arrive converted, so the shift happens once per
 * database rather than per read.
 */
const schemaV9 = { ...schemaV8 } as const;

/**
 * v10 adds the sync bookkeeping. Purely additive: two new stores, no existing
 * row touched, so a device that never signs in simply carries an empty outbox.
 */
const schemaV10 = {
  ...schemaV9,
  sync_outbox: '++id, table_name, row_id, updated_at',
  sync_meta: 'key',
} as const;

export const db = new Dexie(DB_NAME) as Dexie & {
  puzzles: EntityTable<Puzzle, 'puzzle_id'>;
  woodpecker_sets: EntityTable<WoodpeckerSet, 'set_id'>;
  lesson_progress: EntityTable<LessonProgress, 'lesson_id'>;
  saved_reviews: EntityTable<SavedReview, 'game_id'>;
  custom_lessons: EntityTable<CustomLessonRecord, 'lesson_id'>;
  pgn_courses: EntityTable<PgnCourseRecord, 'course_id'>;
  line_progress: EntityTable<LineProgress, 'id'>;
  puzzle_sets: EntityTable<PuzzleTrainingSet, 'set_id'>;
  puzzle_cycles: EntityTable<PuzzleCycleProgress, 'cycle_id'>;
  puzzle_attempts: EntityTable<PuzzleAttempt, 'attempt_id'>;
  puzzle_shards: EntityTable<PuzzleShardState, 'id'>;
  played_games: EntityTable<PlayedGameRecord, 'game_id'>;
  active_game: EntityTable<ActiveGameRecord, 'game_id'>;
  sync_outbox: EntityTable<SyncOutboxRow, 'id'>;
  sync_meta: EntityTable<SyncMetaRow, 'key'>;
};

db.version(1).stores(schemaV1);
db.version(2).stores(schemaV2);
db.version(3).stores(schemaV3);
db.version(4).stores(schemaV4);
db.version(5).stores(schemaV5);
db.version(6).stores(schemaV6);
db.version(7).stores(schemaV7);
db.version(8).stores(schemaV8);
db.version(DB_SCHEMA_VERSION)
  .stores(schemaV10)
  .upgrade((tx) =>
    tx
      .table('puzzles')
      .toCollection()
      .modify((puzzle: { rating?: number }) => {
        if (typeof puzzle.rating === 'number' && Number.isFinite(puzzle.rating)) {
          puzzle.rating += LICHESS_TO_CHESSCOM_SHIFT;
        }
      }),
  );

/**
 * Aggregated row counts, used by diagnostics and the dashboard.
 */
export async function getLocalStorageSummary(): Promise<{
  puzzles: number;
  woodpeckerSets: number;
  lessons: number;
  reviews: number;
}> {
  const [puzzles, woodpeckerSets, lessons, reviews] = await Promise.all([
    db.puzzles.count(),
    db.woodpecker_sets.count(),
    db.lesson_progress.count(),
    db.saved_reviews.count(),
  ]);
  return { puzzles, woodpeckerSets, lessons, reviews };
}
