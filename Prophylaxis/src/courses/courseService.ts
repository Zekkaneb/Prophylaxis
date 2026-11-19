/**
 * PGN courses: parse a multi-game file into replayable chapters, persist it.
 *
 * The parsing itself is `src/pgn` (pure tree building). This layer adds chess.js
 * so every chapter gets legal SAN, UCI and pre/post FENs, then stores the result
 * in IndexedDB. Nothing here touches React or the DOM.
 */

import { Chess } from 'chess.js';
import { countNodes, mainline, parsePgn, type PgnNode } from '../pgn/index.ts';
import { db } from '../db';
import type { CourseChapter, CoursePly, CourseVariation, PgnCourseRecord } from './types';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** A single file is a study; anything larger is almost certainly a mistake. */
const MAX_CHAPTERS = 500;

function newId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid
    ? `${prefix}-${uuid}`
    : `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function tag(headers: Record<string, string>, name: string): string {
  return (headers[name] ?? '').trim();
}

/** `Italian-Game.pgn` → `Italian Game`. */
export function courseTitleFromFile(fileName: string): string {
  return (
    fileName
      .replace(/\.pgn$/i, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'Untitled course'
  );
}

/** Chapter label: an explicit chapter name first, then the players, then a number. */
function chapterTitle(headers: Record<string, string>, index: number): string {
  const explicit = tag(headers, 'ChapterName') || tag(headers, 'Chapter');
  if (explicit) return explicit;

  const white = tag(headers, 'White');
  const black = tag(headers, 'Black');
  if (white || black) {
    return `${white || 'White'} – ${black || 'Black'}`;
  }
  return `Chapter ${index + 1}`;
}

export interface CourseStats {
  chapters: number;
  plies: number;
  notes: number;
  variations: number;
}

export function courseStats(course: PgnCourseRecord): CourseStats {
  let plies = 0;
  let notes = 0;
  let variations = 0;
  for (const chapter of course.chapters) {
    plies += chapter.plies.length;
    variations += chapter.variation_count;
    for (const ply of chapter.plies) {
      if (ply.comment) notes += 1;
    }
  }
  return { chapters: course.chapters.length, plies, notes, variations };
}

/** Side lines are quizzed too, but a 30-ply branch is not a drill. */
const MAX_VARIATION_PLIES = 16;

/**
 * Replays one written alternative from the position it replaces, following its
 * own main continuation. Gives the quiz a segment it can actually play.
 */
function buildVariation(node: PgnNode, before: string): CourseVariation {
  const board = new Chess(before);
  const plies: CoursePly[] = [];
  let cursor: PgnNode | null = node;

  while (cursor && plies.length < MAX_VARIATION_PLIES) {
    const fenBefore = board.fen();
    try {
      const move = board.move(cursor.san);
      /* FEN is `<placement> <turn> …`, so the mover is field 1. */
      const turn = fenBefore.split(' ')[1] === 'b' ? 'b' : 'w';
      plies.push({
        san: move.san,
        uci: `${move.from}${move.to}${move.promotion ?? ''}`,
        fen_before: fenBefore,
        fen_after: board.fen(),
        comment: (cursor.comment ?? '').trim(),
        nags: cursor.nags ?? [],
        move_number: Number(fenBefore.split(' ')[5]) || 1,
        color: turn,
      });
    } catch {
      break;
    }
    cursor = cursor.children[0] ?? null;
  }

  return { san: node.san, comment: (node.comment ?? '').trim(), plies };
}

/**
 * Turns one parsed game into a chapter.
 *
 * Returns `null` when the game cannot be replayed at all (unreadable FEN), and
 * truncates at the first illegal move instead of throwing: a study with one bad
 * line should not fail the whole import.
 */
function buildChapter(
  game: ReturnType<typeof parsePgn>['games'][number],
  index: number,
  warnings: string[],
): CourseChapter | null {
  const nodes = mainline(game);
  const label = chapterTitle(game.headers, index);
  const headerFen = tag(game.headers, 'FEN');
  const startingFen = headerFen && headerFen !== START_FEN ? headerFen : undefined;

  let board: Chess;
  try {
    board = new Chess(startingFen ?? START_FEN);
  } catch {
    warnings.push(`“${label}” was skipped: its FEN tag is not a readable position.`);
    return null;
  }

  const plies: CoursePly[] = [];
  /* Alternatives to a move are its siblings: the parser keeps `children[0]` as
     the main continuation and `children[1..]` as the written variations, and a
     variation replaces the move it follows, not the previous ply. */
  let parent = game.root;
  for (const node of nodes) {
    const before = board.fen();
    const alternatives = parent.children
      .filter((child) => child !== node)
      .map((child) => buildVariation(child, before));
    try {
      const move = board.move(node.san);
      /* FEN is `<placement> <turn> …`, so the mover is field 1. */
      const turn = before.split(' ')[1] === 'b' ? 'b' : 'w';
      plies.push({
        san: move.san,
        uci: `${move.from}${move.to}${move.promotion ?? ''}`,
        fen_before: before,
        fen_after: board.fen(),
        comment: node.comment.trim(),
        nags: node.nags,
        move_number: Number(before.split(' ')[5]) || 1,
        color: turn,
        // Kept for the coaching panel; the main line stays linear.
        alternatives,
      });
      parent = node;
    } catch {
      warnings.push(`“${label}” stops at ${node.san}: not legal in this line.`);
      break;
    }
  }

  if (plies.length === 0 && !startingFen) return null;

  return {
    chapter_id: newId('chapter'),
    title: label,
    result: game.result ?? '*',
    ...(startingFen ? { starting_fen: startingFen } : {}),
    headers: { ...game.headers },
    plies,
    variation_count: Math.max(0, countNodes(game.root) - nodes.length),
  };
}

/**
 * Parses and stores a PGN file.
 *
 * Throws only when nothing usable came out of the file — individual bad games
 * are reported in `warnings` on the saved course.
 */
export async function importCoursePgn(
  pgnText: string,
  sourceName: string,
  repertoireColor: 'w' | 'b' = 'w',
): Promise<PgnCourseRecord> {
  const text = pgnText.trim();
  if (!text) throw new Error('That file is empty — drop a PGN with at least one game.');

  const parsed = parsePgn(text);
  if (parsed.games.length === 0) {
    throw new Error('No games found in that file. Check that it is a PGN export.');
  }

  const warnings = [...parsed.warnings];
  const chapters: CourseChapter[] = [];
  for (const [index, game] of parsed.games.slice(0, MAX_CHAPTERS).entries()) {
    const chapter = buildChapter(game, index, warnings);
    if (chapter) chapters.push(chapter);
  }

  if (chapters.length === 0) {
    throw new Error('Every game in that file was unreadable or had no legal moves.');
  }

  const first = parsed.games[0].headers;
  const title =
    tag(first, 'StudyName') ||
    tag(first, 'Event') ||
    courseTitleFromFile(sourceName);

  const record: PgnCourseRecord = {
    course_id: newId('course'),
    title,
    repertoire_color: repertoireColor,
    source_name: sourceName || 'pasted PGN',
    imported_at: Date.now(),
    chapters,
    warnings: warnings.slice(0, 25),
  };

  await db.pgn_courses.put(record);
  return record;
}

/** Courses imported before the colour field existed read as White. */
function withColor(course: PgnCourseRecord): PgnCourseRecord {
  return course.repertoire_color ? course : { ...course, repertoire_color: 'w' };
}

/** Newest first. */
export async function listCourses(): Promise<PgnCourseRecord[]> {
  const rows = await db.pgn_courses.orderBy('imported_at').reverse().toArray();
  return rows.map(withColor);
}

/** Flip which side a course is written for; drills follow immediately. */
export async function setCourseColor(courseId: string, color: 'w' | 'b'): Promise<void> {
  const course = await db.pgn_courses.get(courseId);
  if (!course) return;
  await db.pgn_courses.put({ ...course, repertoire_color: color });
}

/* ------------------------------- quiz lines ------------------------------- */

/** One playable line handed to the quiz: the trunk, or one written side line. */
export interface QuizSegment {
  id: string;
  label: string;
  startFen: string;
  moves: Array<{ san: string; uci: string; color: 'w' | 'b' }>;
}

function toMoves(plies: CoursePly[]): QuizSegment['moves'] {
  return plies.map(({ san, uci, color }) => ({ san, uci, color }));
}

/**
 * Everything a chapter can quiz: the main line first, then every written side
 * line from the position it replaces. Order is stable so drills feel the same
 * each run.
 */
export function chapterQuizSegments(chapter: CourseChapter): QuizSegment[] {
  const segments: QuizSegment[] = [];

  if (chapter.plies.length > 0) {
    segments.push({
      id: `${chapter.chapter_id}:main`,
      label: chapter.title,
      startFen: chapter.starting_fen ?? START_FEN,
      moves: toMoves(chapter.plies),
    });
  }

  for (const ply of chapter.plies) {
    for (const [index, variation] of (ply.alternatives ?? []).entries()) {
      if (variation.plies.length === 0) continue;
      segments.push({
        id: `${chapter.chapter_id}:alt:${ply.uci}:${index}`,
        label: `Side line: ${ply.move_number}${ply.color === 'w' ? '.' : '…'} ${variation.san} instead of ${ply.san}`,
        startFen: ply.fen_before,
        moves: toMoves(variation.plies),
      });
    }
  }

  return segments;
}

/**
 * How many moves the quiz will actually ask the player for.
 * The opposite side is auto-played, so only their own moves count.
 */
export function quizMoveCount(segments: QuizSegment[], color: 'w' | 'b'): number {
  return segments.reduce(
    (total, segment) => total + segment.moves.filter((move) => move.color === color).length,
    0,
  );
}

/**
 * How many quiz answers a whole course holds for one side, side lines
 * included. A study is often written for the other colour than the course is
 * set to; the library checks this before it offers a quiz with no moves.
 */
export function courseQuizMoveCount(course: PgnCourseRecord, color: 'w' | 'b'): number {
  let total = 0;
  for (const chapter of course.chapters) {
    for (const ply of chapter.plies) {
      if (ply.color === color) total += 1;
      for (const variation of ply.alternatives ?? []) {
        for (const side of variation.plies) {
          if (side.color === color) total += 1;
        }
      }
    }
  }
  return total;
}

/* --------------------------- reading progress ---------------------------- */

/** Where the reader stopped in a course — localStorage, not the database. */
function studyProgressKey(courseId: string): string {
  return `chess-trainer.study-progress.${courseId}`;
}

export function readStudyProgress(courseId: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(studyProgressKey(courseId));
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function writeStudyProgress(courseId: string, progress: Record<string, number>): void {
  try {
    localStorage.setItem(studyProgressKey(courseId), JSON.stringify(progress));
  } catch {
    /* storage is optional */
  }
}

/** True once the reader has stepped onto the chapter's last move. */
export function chapterReviewed(chapter: CourseChapter, reached: number | undefined): boolean {
  return chapter.plies.length > 0 && (reached ?? -1) >= chapter.plies.length - 1;
}

/**
 * A chapter counts as learned only when both halves of the loop are done: the
 * line has been read to its end *and* a test was finished. A quiz run on an
 * unread chapter does not earn the mark, and neither does reading alone.
 */
export function chapterLearned(
  chapter: CourseChapter,
  reached: number | undefined,
  attempts: number,
): boolean {
  return chapterReviewed(chapter, reached) && attempts > 0;
}

/* ------------------------------ drill history ----------------------------- */

export function lineKey(courseId: string, chapterId: string): string {
  return `${courseId}:${chapterId}`;
}

/** Records one finished quiz: percent = clean moves / asked moves. */
export async function recordDrill(
  courseId: string,
  chapterId: string,
  percent: number,
): Promise<void> {
  const id = lineKey(courseId, chapterId);
  const existing = await db.line_progress.get(id);
  const attempts = (existing?.attempts ?? 0) + 1;
  const clean = percent >= 90;
  const mastery = Math.min(3, clean ? (existing?.mastery ?? 0) + 1 : existing?.mastery ?? 0);
  await db.line_progress.put({
    id,
    course_id: courseId,
    chapter_id: chapterId,
    attempts,
    best_percent: Math.max(existing?.best_percent ?? 0, percent),
    last_percent: percent,
    last_drilled: Date.now(),
    mastery,
  });
}

export async function deleteCourse(courseId: string): Promise<void> {
  await db.pgn_courses.delete(courseId);
}
