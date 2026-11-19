/**
 * Example 3 — a lesson becoming PGN and coming back.
 *
 *   node learn/examples/03-lesson-export.ts
 *
 * This is the legacy "chapter export" format, restored on top of the new
 * parser: Seven Tag Roster + [ChapterName], coaching notes as { comments }.
 */

import { lessonToPgn, parseLessonPgn } from '../../src/lessons/lessonPgn.ts';

const lesson = {
  id: 'demo',
  title: 'Italian Game — Giuoco Piano',
  repertoireColor: 'white' as const,
  moves: [
    { uci: 'e2e4', san: 'e4', explanation: 'Claim the centre.' },
    { uci: 'e7e5', san: 'e5', explanation: 'Black mirrors.' },
    { uci: 'g1f3', san: 'Nf3', explanation: 'Develop with tempo.' },
  ],
};

const pgn = lessonToPgn(lesson);
console.log('--- exported PGN ---');
console.log(pgn);

const roundTripped = parseLessonPgn(pgn);
console.log('--- re-imported ---');
for (const move of roundTripped.moves) {
  console.log(`${move.san.padEnd(4)} ${move.uci.padEnd(5)} ${move.explanation}`);
}
