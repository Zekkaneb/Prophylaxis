import type { CustomLessonRecord } from '../db';
import type { Lesson } from './sampleLessons';

/**
 * Custom lessons: the DB record → domain object hop, plus the PGN importer.
 *
 * The importer itself lives in `lessonPgn.ts` and is re-exported here so the
 * existing `import { parseLessonPgn } from '../lessons/customLessons'` call
 * sites keep working — the merge into the new PGN toolkit must not break the
 * public surface of this module.
 */

export { parseLessonPgn, type ParsedLessonPgn } from './lessonPgn';

export function recordToLesson(record: CustomLessonRecord): Lesson {
  return {
    id: record.lesson_id,
    title: record.title,
    repertoireColor: record.repertoire_color,
    startingFen: record.starting_fen,
    moves: record.moves,
  };
}
