-- The four category ratings now sync between a player's devices. One row per
-- category, so the allow-list needs the table name or every upload is refused
-- with `sync_rows_known_table`.

alter table public.sync_rows
  drop constraint if exists sync_rows_known_table;

alter table public.sync_rows
  add constraint sync_rows_known_table check (
    table_name in (
      'pgn_courses',
      'custom_lessons',
      'line_progress',
      'lesson_progress',
      'saved_reviews',
      'played_games',
      'active_game',
      'puzzle_sets',
      'puzzle_cycles',
      'puzzle_attempts',
      'woodpecker_sets',
      'prefs',
      'user_ratings'
    )
  );
