# archive/old-lesson-trainer/

Kept for reference only — nothing here is built, imported or served.

This is the custom lesson dialog that belonged to the old Classroom / Tools tabs.
Those tabs were replaced by the merged Courses library plus the chapter quiz
(`src/components/LineQuiz.tsx`) and the Drill tab (`src/components/Drill.tsx`), so
the dialog has no callers left and was moved here instead of deleted.

| File | Was used for |
| --- | --- |
| `CustomLessonDialog.tsx` / `.css` | dialog for importing a custom PGN lesson |

The files it depended on are **not** archived, because they still do real work:

- `src/lessons/lessonPgn.ts` — the lesson PGN importer; imported by
  `learn/tests/writer.test.ts` and `learn/examples/03-lesson-export.ts`.
- `src/lessons/customLessons.ts` — the documented re-export shim for that importer
  (see `learn/README.md`).
- `src/lessons/sampleLessons.ts` — the game review builds its sample positions from it.

Course imports now go through `src/courses/courseService.ts` (`importCoursePgn`),
which stores a `repertoire_color` and writes `line_progress` when a chapter is
quizzed.

If you ever want the dialog back, move the two files into `src/components/` and
restore their import paths. Safe to delete once you are satisfied nothing is missing.
