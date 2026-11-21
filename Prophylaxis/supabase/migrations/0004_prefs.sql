-- Cosmetics and gameplay preferences now sync (board palette, piece set,
-- ground, accent, board size, sound, premoves). They are stored one row per
-- setting, so the allow-list has to know the table name.

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
      'prefs'
    )
  );
