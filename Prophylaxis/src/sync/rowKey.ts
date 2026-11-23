/**
 * The field each synced table is keyed by in Dexie.
 *
 * A pulled payload normally carries its own key, because the row that was
 * uploaded came out of the same table. When it does not — an upload from an
 * older build, a row repaired by hand on the server, a tombstone re-created
 * later — IndexedDB refuses the write outright ("Evaluating the object store's
 * key path did not yield a value") and the whole pull aborts, so nothing newer
 * ever arrives. Restoring the key from `row_id` fixes the row: `row_id` is the
 * column the server upserts on, so it *is* the local key.
 *
 * Plain data and no imports, so it can be exercised on its own.
 */

export const SYNCED_KEY_FIELD: Record<string, string> = {
  played_games: 'game_id',
  puzzle_sets: 'set_id',
  puzzle_cycles: 'cycle_id',
  puzzle_attempts: 'attempt_id',
  woodpecker_sets: 'set_id',
  pgn_courses: 'course_id',
  custom_lessons: 'lesson_id',
  line_progress: 'id',
  lesson_progress: 'lesson_id',
  saved_reviews: 'game_id',
  active_game: 'game_id',
  prefs: 'key',
  /** Four rows, one per category; the category *is* the key. */
  user_ratings: 'category',
  /** One row per account, always `titles`. */
  user_titles: 'id',
};

/** Returns the payload with its table's key filled in when it is missing. */
export function withRowKey(
  table: string,
  rowId: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const field = SYNCED_KEY_FIELD[table];
  if (!field) return payload;
  const current = payload[field];
  if (current !== undefined && current !== null && current !== '') return payload;
  return { ...payload, [field]: rowId };
}
