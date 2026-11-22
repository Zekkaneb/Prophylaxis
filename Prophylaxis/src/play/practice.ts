/**
 * Opening-practice sparring: the course tree, the partner's book replies and
 * the scorecard the player is shown while and after the game.
 *
 * The partner is not a personality and does not use the personality books. It
 * reads exactly one thing — the course the player chose — and answers from it:
 * the trunk when the mode is strict, the written side lines when the player
 * asked to be tested on them, and a sound engine move off the book when the
 * mode allows deviations. The moment the tree runs out, the live game's normal
 * engine path takes over, so the game still finishes like any other game.
 *
 * Nothing here touches React, chess.js or the engine: it maps a position to the
 * moves the course holds for it and counts what happened.
 */

import type { PgnCourseRecord } from '../courses/types.ts';
import type { OpponentProfile } from './opponents.ts';
import type { PlayColor } from './types.ts';
import { normalizeFen } from './repertoire.ts';

/**
 * The sparring partner's own card.
 *
 * A general bot, not a personality: it has no dialogue, no declared repertoire
 * and no style dials, because its opening is the player's course. Its rating is
 * the strength the engine plays at once the course runs out, and the setup
 * screen lets the player raise or lower it.
 */
export const PRACTICE_PARTNER: OpponentProfile = {
  id: 'practice-partner',
  kind: 'general',
  category: 'intermediate',
  name: 'Sparring partner',
  shortName: 'Partner',
  elo: 1800,
  style: 'Plays your chosen course from the book, then the engine takes over.',
  portraitPath: null,
  initials: 'SP',
  usesRepertoire: true,
};

/** Rating range offered on the practice setup screen. */
export const PRACTICE_ELO = { min: 800, max: 2600, step: 100, default: 1800 } as const;

export type PracticeMode = 'strict' | 'sidelines' | 'random';

export const PRACTICE_MODES: ReadonlyArray<{
  id: PracticeMode;
  label: string;
  hint: string;
}> = [
  {
    id: 'strict',
    label: 'Strict main line',
    hint: 'The partner only plays the trunk of your course.',
  },
  {
    id: 'sidelines',
    label: 'Side lines',
    hint: 'The partner answers with your course’s written alternatives.',
  },
  {
    id: 'random',
    label: 'Random deviations',
    hint: 'The partner now and then leaves the book with a sound engine move.',
  },
];

/** One move the course holds for a position. */
export interface PracticeEntry {
  uci: string;
  san: string;
  color: PlayColor;
  /** On the chapter's main line (the trunk), not a written alternative. */
  main: boolean;
  chapterId: string;
  chapterTitle: string;
}

/** Position (without counters) → every course move played from it. */
export type PracticeTree = Map<string, PracticeEntry[]>;

function addEntry(
  tree: PracticeTree,
  fen: string,
  entry: PracticeEntry,
): void {
  const key = normalizeFen(fen);
  const rows = tree.get(key);
  if (!rows) {
    tree.set(key, [entry]);
    return;
  }
  const existing = rows.find((row) => row.uci === entry.uci);
  if (!existing) {
    rows.push(entry);
    return;
  }
  /* A move that is the trunk of one chapter and an alternative in another is
     the trunk: the mode that follows side lines should still recognise it. */
  if (entry.main && !existing.main) existing.main = true;
}

/**
 * Every move the course knows, keyed by the position before it.
 *
 * The main line and the written variations are flattened into one map: a
 * variation replaces the move it follows, so both arrive at the same position
 * and can be compared there. Keying by position (not by chapter) also makes the
 * course's transpositions work.
 */
export function buildPracticeTree(course: PgnCourseRecord): PracticeTree {
  const tree: PracticeTree = new Map();

  for (const chapter of course.chapters) {
    /* Variations inside a variation are not built at import time, so one level
       of `alternatives` is the whole tree. */
    for (const ply of chapter.plies) {
      addEntry(tree, ply.fen_before, {
        uci: ply.uci,
        san: ply.san,
        color: ply.color,
        main: true,
        chapterId: chapter.chapter_id,
        chapterTitle: chapter.title,
      });

      for (const variation of ply.alternatives ?? []) {
        const first = variation.plies[0];
        if (first) {
          addEntry(tree, ply.fen_before, {
            uci: first.uci,
            san: first.san,
            color: first.color,
            main: false,
            chapterId: chapter.chapter_id,
            chapterTitle: chapter.title,
          });
        }
        for (const side of variation.plies) {
          addEntry(tree, side.fen_before, {
            uci: side.uci,
            san: side.san,
            color: side.color,
            main: false,
            chapterId: chapter.chapter_id,
            chapterTitle: chapter.title,
          });
        }
      }
    }
  }

  return tree;
}

/** How much of the course the partner can actually answer from. */
export function practiceBookSize(course: PgnCourseRecord): { positions: number; moves: number } {
  const tree = buildPracticeTree(course);
  let moves = 0;
  for (const rows of tree.values()) moves += rows.length;
  return { positions: tree.size, moves };
}

/* -------------------------------- runtime -------------------------------- */

/** A written side line, or an off-book move, that the partner actually played. */
export interface PartnerLine {
  /** 1-based ply number in this game. */
  ply: number;
  san: string;
  chapterTitle: string;
  kind: 'side' | 'off-book';
  /** Whether the player's reply stayed in the course, once it was played. */
  answeredInBook: boolean | null;
}

/** The player's first move that the course did not have. */
export interface PracticeDeviation {
  ply: number;
  moveNumber: number;
  color: PlayColor;
  playedSan: string;
  expectedSans: string[];
  chapterTitle: string;
}

export interface PracticeState {
  courseId: string;
  courseTitle: string;
  mode: PracticeMode;
  playerColor: PlayColor;
  tree: PracticeTree;
  /** Plies played so far. */
  plies: number;
  /** The player's moves, and how many of them were course moves. */
  playerMoves: number;
  bookMoves: number;
  /** Course moves kept in a row, ending with the latest player move. */
  streak: number;
  bestStreak: number;
  /** First ply at which the course had nothing to say, either side. */
  bookEndedPly: number | null;
  deviation: PracticeDeviation | null;
  partnerLines: PartnerLine[];
  /** Partner moves that came from the course. */
  partnerBookMoves: number;
  /** True once the partner has left the book on purpose. */
  deviated: boolean;
}

export function createPracticeState(
  course: PgnCourseRecord,
  mode: PracticeMode,
  playerColor: PlayColor,
): PracticeState {
  return {
    courseId: course.course_id,
    courseTitle: course.title,
    mode,
    playerColor,
    tree: buildPracticeTree(course),
    plies: 0,
    playerMoves: 0,
    bookMoves: 0,
    streak: 0,
    bestStreak: 0,
    bookEndedPly: null,
    deviation: null,
    partnerLines: [],
    partnerBookMoves: 0,
    deviated: false,
  };
}

function entriesFor(state: PracticeState, fen: string, color: PlayColor): PracticeEntry[] {
  const rows = state.tree.get(normalizeFen(fen));
  if (!rows) return [];
  return rows.filter((row) => row.color === color);
}

/** Every course move for `color` in this position, in UCI. */
export function bookMovesFor(
  state: PracticeState,
  fen: string,
  color: PlayColor,
): string[] {
  return entriesFor(state, fen, color).map((row) => row.uci);
}

/** Course moves for `color` in this position, trunk first. */
export function partnerCandidates(
  state: PracticeState,
  fen: string,
  color: PlayColor,
): PracticeEntry[] {
  const rows = entriesFor(state, fen, color);
  return [...rows].sort((a, b) => Number(b.main) - Number(a.main));
}

function pick<T>(rows: readonly T[], random: () => number): T | null {
  if (rows.length === 0) return null;
  const index = Math.min(rows.length - 1, Math.floor(random() * rows.length));
  return rows[index] ?? rows[0] ?? null;
}

/**
 * The partner's course reply for this position, or `null` when the course has
 * nothing here (the caller then plays the ordinary engine move).
 *
 * `ply` is the number of plies already played, so the first few moves are
 * always the trunk: a partner that springs a side line on move one teaches
 * nothing.
 */
export function choosePartnerBookMove(
  state: PracticeState,
  fen: string,
  color: PlayColor,
  ply: number,
  random: () => number = Math.random,
): PracticeEntry | null {
  const entries = partnerCandidates(state, fen, color);
  if (entries.length === 0) return null;

  const main = entries.filter((entry) => entry.main);
  const side = entries.filter((entry) => !entry.main);
  const trunk = main.length > 0 ? main : entries;

  if (state.mode === 'strict') return pick(trunk, random);

  /* The written alternatives are what this mode exists for; after the first
     two moves, so the position still becomes the player's own line. */
  const sideChance = state.mode === 'sidelines' ? 0.55 : 0.35;
  if (ply >= 4 && side.length > 0 && random() < sideChance) {
    return pick(side, random);
  }

  return pick(trunk, random);
}

/**
 * Whether the partner should leave the book here on purpose — one sound,
 * non-course move, played through the engine. Only the random-deviation mode
 * does this, only once, and only while the course still has a reply: that is
 * the test.
 */
export function partnerShouldDeviate(
  state: PracticeState,
  fen: string,
  color: PlayColor,
  ply: number,
  random: () => number = Math.random,
): boolean {
  if (state.mode !== 'random' || state.deviated) return false;
  if (ply < 6 || ply > 26) return false;
  if (entriesFor(state, fen, color).length === 0) return false;
  return random() < 0.4;
}

/** Records the partner's move: a course move, a written side line, or a deviation. */
export function notePartnerMove(
  state: PracticeState,
  played: { entry: PracticeEntry | null; offBook?: boolean; san: string },
): void {
  state.plies += 1;

  if (played.entry) {
    state.partnerBookMoves += 1;
    if (!played.entry.main) {
      state.partnerLines.push({
        ply: state.plies,
        san: played.san,
        chapterTitle: played.entry.chapterTitle,
        kind: 'side',
        answeredInBook: null,
      });
    }
    return;
  }

  if (played.offBook) {
    state.deviated = true;
    state.partnerLines.push({
      ply: state.plies,
      san: played.san,
      chapterTitle: state.courseTitle,
      kind: 'off-book',
      answeredInBook: null,
    });
  }
}

/**
 * Records the player's move against the course: kept, misplaced, or made in a
 * position the course does not cover.
 */
export function notePlayerMove(
  state: PracticeState,
  input: {
    fenBefore: string;
    fenAfter: string;
    uci: string;
    san: string;
  },
): void {
  state.plies += 1;
  state.playerMoves += 1;

  const entries = entriesFor(state, input.fenBefore, state.playerColor);
  const kept = entries.some((entry) => entry.uci === input.uci);

  if (entries.length === 0) {
    /* Already outside the course for the player: a book-end, not an error. */
    if (state.bookEndedPly === null) state.bookEndedPly = state.plies;
  } else if (kept) {
    state.bookMoves += 1;
    state.streak += 1;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
  } else {
    state.streak = 0;
    if (!state.deviation) {
      state.deviation = {
        ply: state.plies,
        moveNumber: Math.ceil(state.plies / 2),
        color: state.playerColor,
        playedSan: input.san,
        expectedSans: [...new Set(entries.map((entry) => entry.san))].slice(0, 3),
        chapterTitle: entries[0]?.chapterTitle ?? state.courseTitle,
      };
    }
  }

  /* The last side line the partner played is answered by this move. */
  for (let index = state.partnerLines.length - 1; index >= 0; index -= 1) {
    const line = state.partnerLines[index];
    if (line.answeredInBook === null) {
      line.answeredInBook = kept;
      break;
    }
  }

  /* The course runs out for the other side too: nothing to answer with. */
  const opponent: PlayColor = state.playerColor === 'w' ? 'b' : 'w';
  if (state.bookEndedPly === null && entriesFor(state, input.fenAfter, opponent).length === 0) {
    state.bookEndedPly = state.plies;
  }
}

/** What the panel and the end-of-game feedback read. */
export interface PracticeSnapshot {
  courseId: string;
  courseTitle: string;
  mode: PracticeMode;
  playerColor: PlayColor;
  plies: number;
  playerMoves: number;
  bookMoves: number;
  streak: number;
  bestStreak: number;
  bookEndedPly: number | null;
  deviation: PracticeDeviation | null;
  partnerLines: PartnerLine[];
  partnerBookMoves: number;
}

export function practiceSnapshot(state: PracticeState): PracticeSnapshot {
  return {
    courseId: state.courseId,
    courseTitle: state.courseTitle,
    mode: state.mode,
    playerColor: state.playerColor,
    plies: state.plies,
    playerMoves: state.playerMoves,
    bookMoves: state.bookMoves,
    streak: state.streak,
    bestStreak: state.bestStreak,
    bookEndedPly: state.bookEndedPly,
    deviation: state.deviation,
    partnerLines: state.partnerLines.map((line) => ({ ...line })),
    partnerBookMoves: state.partnerBookMoves,
  };
}

/** Percentage of the player's moves that matched the course. */
export function bookAccuracy(snapshot: PracticeSnapshot): number {
  if (snapshot.playerMoves === 0) return 0;
  return Math.round((snapshot.bookMoves / snapshot.playerMoves) * 100);
}

/** The side lines the partner played and how the player answered them. */
export function sideLineTally(snapshot: PracticeSnapshot): {
  faced: number;
  handled: number;
} {
  const faced = snapshot.partnerLines.length;
  const handled = snapshot.partnerLines.filter((line) => line.answeredInBook === true).length;
  return { faced, handled };
}

export function practiceModeLabel(mode: PracticeMode): string {
  return PRACTICE_MODES.find((entry) => entry.id === mode)?.label ?? 'Practice';
}

/** "3.4.Nf3" — how feedback names a move without needing the SAN of the rest. */
export function moveLabel(ply: number, san: string): string {
  const color: PlayColor = ply % 2 === 1 ? 'w' : 'b';
  const number = Math.ceil(ply / 2);
  return `${number}${color === 'w' ? '.' : '…'}${san}`;
}
