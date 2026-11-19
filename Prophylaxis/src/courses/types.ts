/**
 * PGN course records.
 *
 * A *course* is one imported PGN file (a Lichess study export, a training set,
 * a bundle of annotated games). Each game inside it becomes a *chapter* that the
 * study view can replay ply by ply.
 *
 * Pages are pre-computed at import time — every ply carries the FEN before and
 * after it — so replaying a chapter never touches a rules engine at render time.
 */

/** One half-move of a chapter's main line, with everything drawn from the tree. */
export interface CoursePly {
  /** Normalised SAN (`0-0` becomes `O-O`), as chess.js accepted it. */
  san: string;
  /** `e2e4` / `e7e8q` — derived while replaying, so it is always legal. */
  uci: string;
  fen_before: string;
  fen_after: string;
  /** Coach text from `{ … }` comments attached to this move. */
  comment: string;
  /** Numeric Annotation Glyphs, e.g. `[4]` for a brilliancy. */
  nags: number[];
  /** Full-move number of the position before the move. */
  move_number: number;
  color: 'w' | 'b';
  /** Moves that replace this one in the source (written as `( … )` branches). */
  alternatives?: CourseVariation[];
}

/**
 * A written alternative to a main-line move, with its own replayable
 * continuation so the quiz can drill side lines as well as the trunk.
 */
export interface CourseVariation {
  /** SAN of the alternative move itself. */
  san: string;
  /** Coach text attached to the alternative. */
  comment: string;
  /** The alternative plus everything that follows it (capped at import). */
  plies: CoursePly[];
}

/** One game of an imported PGN, flattened to a replayable main line. */
export interface CourseChapter {
  chapter_id: string;
  title: string;
  /** `1-0`, `0-1`, `1/2-1/2` or `*`. */
  result: string;
  /** Present only when the chapter starts from a non-standard position. */
  starting_fen?: string;
  /** Original tag pairs, keyed as written (`White`, `Black`, `ECO`, …). */
  headers: Record<string, string>;
  plies: CoursePly[];
  /** Tree nodes that were *not* on the main line (variations), for display only. */
  variation_count: number;
}

/** One imported PGN file. */
export interface PgnCourseRecord {
  course_id: string;
  title: string;
  /**
   * The side this study is written for. Drives board orientation and which
   * moves the quiz asks for. Courses imported before this field existed read
   * as `'w'`.
   */
  repertoire_color: 'w' | 'b';
  /** Original file name, shown so users recognise what they dropped. */
  source_name: string;
  /** Epoch ms. */
  imported_at: number;
  chapters: CourseChapter[];
  /** Import-time problems that did not stop the import (truncated lines, …). */
  warnings: string[];
}
