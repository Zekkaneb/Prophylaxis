-- The Puzzles page's "Available sets" list is built from `woodpecker_sets`, not
-- from `puzzle_sets`: freezing a set on that page writes there, and the trainer
-- replays from there. The first migration left the table out of the allow-list
-- on the assumption it was superseded, so a set could be created and queued
-- locally but every push would be rejected by the check constraint.

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
      'woodpecker_sets'
    )
  );
