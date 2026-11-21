import { usesOpeningBook } from './humanStrength.ts';

/**
 * One definition of "this bot may still use prepared theory here".
 *
 * Regular Play and Watch Bots both read it, so the same personality at the same
 * rating answers the same position the same way whether it is playing a human or
 * another bot. The window gates *every* theory source — the compiled/declared
 * repertoire, Nina's principle skeleton and the King's Indian plan — never the
 * engine: once it closes, ordinary search and personality selection take over.
 */

/**
 * Deepest ply of prepared theory a personality may keep following, by rating.
 *
 * A repertoire is a memory, and memory is part of strength: an 1150 who recites
 * twelve moves of grandmaster theory is not an 1150 any more. The cap counts
 * **plies already played** (White's first move is ply 0), not full moves.
 */
export const BOOK_PLY_CAP = {
  beginner: 4,
  club: 6,
  expert: 8,
  master: 12,
} as const;

export function bookPlyLimit(elo: number): number {
  if (elo <= 1000) return BOOK_PLY_CAP.beginner;
  if (elo <= 1500) return BOOK_PLY_CAP.club;
  if (elo <= 2000) return BOOK_PLY_CAP.expert;
  return BOOK_PLY_CAP.master;
}

export interface TheoryWindow {
  /** Prepared theory may speak on this turn. */
  open: boolean;
  /** Plies of theory this rating still remembers. */
  limit: number;
  /** Plies already played in this game. */
  plies: number;
}

export function theoryWindow(elo: number, plies: number): TheoryWindow {
  const limit = bookPlyLimit(elo);
  return { open: plies < limit && usesOpeningBook(elo), limit, plies };
}

/** Convenience form for call sites that only need the decision. */
export function theoryOpen(elo: number, plies: number): boolean {
  return theoryWindow(elo, plies).open;
}
