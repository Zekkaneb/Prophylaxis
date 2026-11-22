-- Earned titles (one row per account) sync like any other row. The allow-list
-- has to know the table name, or every upload of `user_titles` is refused.

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
      'user_ratings',
      'user_titles'
    )
  );
