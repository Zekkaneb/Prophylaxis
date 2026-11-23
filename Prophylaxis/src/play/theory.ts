import { usesOpeningBook } from './humanStrength.ts';
import { classBookPlies } from './uscfClasses.ts';

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
 * twelve moves of grandmaster theory is not an 1150 any more. The cap is the
 * USCF class's book depth (Class E 3, D 5, C 7, B 9, A 11, Expert+ 14 plies);
 * below 1000 the beginner's four plies stay. It counts **plies already played**
 * (White's first move is ply 0), not full moves.
 */
export const BOOK_PLY_CAP = {
  beginner: 4,
  classE: 3,
  classD: 5,
  classC: 7,
  classB: 9,
  classA: 11,
  expert: 14,
} as const;

export function bookPlyLimit(elo: number, override?: number): number {
  const limit = classBookPlies(elo);
  if (override === undefined || !Number.isFinite(override)) return limit;
  /* A personality can remember more than its class would (`monkey`'s Hippo),
     never less: the override is an extension of the class window, not a way to
     take theory away from another opponent. */
  return Math.max(limit, Math.round(override));
}

export interface TheoryWindow {
  /** Prepared theory may speak on this turn. */
  open: boolean;
  /** Plies of theory this rating still remembers. */
  limit: number;
  /** Plies already played in this game. */
  plies: number;
}

export function theoryWindow(
  elo: number,
  plies: number,
  bookPlies?: number,
): TheoryWindow {
  const limit = bookPlyLimit(elo, bookPlies);
  return { open: plies < limit && usesOpeningBook(elo), limit, plies };
}

/** Convenience form for call sites that only need the decision. */
export function theoryOpen(elo: number, plies: number, bookPlies?: number): boolean {
  return theoryWindow(elo, plies, bookPlies).open;
}
