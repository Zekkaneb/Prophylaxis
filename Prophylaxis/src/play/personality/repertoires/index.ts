import type { PlayColor } from '../../types.ts';
import {
  booksForRepertoire,
  type BookMove,
  type BuiltBook,
  type PersonalityBook,
} from './book.ts';
import type { PersonalityRepertoire } from './types.ts';
import type { PersonalityId } from '../styles.ts';
import { FRESHMAN_REPERTOIRE } from './freshman.ts';
import { SOPHOMORE_REPERTOIRE } from './sophomore.ts';
import { JUNIOR_REPERTOIRE } from './junior.ts';
import { SENIOR_REPERTOIRE } from './senior.ts';
import { BRANDON_BOOK } from './brandonBook.ts';
import { NINA_BOOK } from './ninaBook.ts';
import { FAADI_REPERTOIRE } from './faadi.ts';
import { EDWARD_REPERTOIRE } from './edward.ts';
import { MABINTI_REPERTOIRE } from './mabinti.ts';
import { BRYAN_WIDJAJA_REPERTOIRE } from './bryanWidjaja.ts';
import {
  BRANDON_FRESHMAN_MAINLINES,
  BRANDON_FRESHMAN_SHARED_BLACK_PREFIX,
  BRANDON_FRESHMAN_SHARED_WHITE_PREFIX,
} from './brandonFreshman.ts';

export { BRANDON_BOOK_STATS } from './brandonBook.ts';
export { NINA_BOOK, NINA_BOOK_STATS } from './ninaBook.ts';

/**
 * The declared repertoires (Brandon's, Nina's and the Bryans' compiled books
 * are separate).
 *
 * Written as standard main lines from opening literature (Ruy Lopez, Catalan,
 * Pirc, Slav, Grünfeld), not imported from a database: a handful of short lines
 * per character and colour, enough to give each one a recognisable first fifteen
 * moves without shipping a large opening book. The General Bot never reads
 * these — it builds its book from the user's courses in `src/play/repertoire.ts`.
 *
 * Sophomore's and Junior's answer to 1.d4 is deliberately absent from this
 * record: no King's Indian PGN was supplied, so it lives in `kid.ts` as a
 * principle-based preference (setup first, then ...e5/...c5 as the centre
 * requires) rather than a fabricated line.
 */
export const PERSONALITY_REPERTOIRES: Record<
  /* The Bryans have no declared lines of their own: their book is a filtered
     view over Brandon's Vienna chapters and Johnfer's Pirc lines (see below). */
  Exclude<
    PersonalityId,
    | 'brandon'
    | 'brandon-freshman'
    | 'nina'
    | 'nina-freshman'
    | 'bryan'
    | 'bryan-prime'
    | 'bryan-sophomore'
    /* Emmanuel Domah has no repertoire at all — not a short one, none. Every
       move of every game, including the first, comes from his own strength
       path, so leaving him out of this record is the implementation. */
    | 'emmanuel'
  >,
  PersonalityRepertoire
> = {
  freshman: FRESHMAN_REPERTOIRE,
  sophomore: SOPHOMORE_REPERTOIRE,
  junior: JUNIOR_REPERTOIRE,
  senior: SENIOR_REPERTOIRE,
  faadi: FAADI_REPERTOIRE,
  edward: EDWARD_REPERTOIRE,
  mabinti: MABINTI_REPERTOIRE,
  'bryan-widjaja': BRYAN_WIDJAJA_REPERTOIRE,
};

export interface PersonalityBooks {
  w: BuiltBook;
  b: BuiltBook;
}

const cache = new Map<PersonalityId, PersonalityBooks>();
const EMPTY: BuiltBook = { book: new Map(), issues: [] };

/**
 * Brandon's and Nina's books are compiled from PGN studies into position →
 * move pairs, so they bypass the SAN-line declarations used by the other four.
 * Each side still gets its own map, keyed by the side to move in the entry, so
 * one colour cannot leak into the other (or into another personality's book).
 */
interface CompiledEntry {
  key: string;
  uci: string;
  san: string;
  lineIds: string[];
  tags: BookMove['tags'];
  weight: number;
}

function compiledBooks(entries: readonly CompiledEntry[]): PersonalityBooks {
  const w: PersonalityBook = new Map();
  const b: PersonalityBook = new Map();
  for (const entry of entries) {
    const target = entry.key.split(' ')[1] === 'w' ? w : b;
    const move: BookMove = {
      uci: entry.uci,
      san: entry.san,
      lineIds: [...entry.lineIds],
      tags: [...entry.tags],
      weight: entry.weight,
    };
    const list = target.get(entry.key);
    if (list) list.push(move);
    else target.set(entry.key, [move]);
  }
  return { w: { book: w, issues: [] }, b: { book: b, issues: [] } };
}

/* One character, three strength profiles: they share one repertoire. */
const BRYAN_PROFILE_IDS: ReadonlySet<string> = new Set([
  'bryan',
  'bryan-prime',
  'bryan-sophomore',
]);

/**
 * Every id that owns a book, and only those.
 *
 * A personality can legitimately have none — Emmanuel Domah is deliberately not
 * in `PERSONALITY_REPERTOIRES` — so this predicate is the accurate list rather
 * than "any personality id".
 */
type RepertoireId =
  | keyof typeof PERSONALITY_REPERTOIRES
  | 'brandon'
  | 'brandon-freshman'
  | 'nina'
  | 'nina-freshman'
  | 'bryan'
  | 'bryan-prime'
  | 'bryan-sophomore';

export function isRepertoireId(id: string): id is RepertoireId {
  return (
    id === 'brandon' ||
    id === 'brandon-freshman' ||
    id === 'nina' ||
    id === 'nina-freshman' ||
    BRYAN_PROFILE_IDS.has(id) ||
    id in PERSONALITY_REPERTOIRES
  );
}

/*
 * Bryan's shared opening knowledge, used by both of his strength profiles.
 *
 * Opening knowledge is shared; taste is not. His White book is a filtered view
 * of Brandon's compiled Vienna chapters (the same immutable entries, no PGN
 * copied), and his Black book is a filtered view of Johnfer's Pirc lines from
 * the Junior repertoire. Everything filtered out — Brandon's Sicilian, French,
 * Grünfeld and Austrian chapters, Johnfer's Catalan — stays available to its own
 * character and is simply not Bryan's.
 */
const BRYAN_VIENNA = BRANDON_BOOK.filter((entry) =>
  entry.lineIds.some((id) => id.startsWith('brandon-vienna-')),
);
const BRYAN_PIRC = JUNIOR_REPERTOIRE.asBlack.filter((line) => line.id.startsWith('junior-pirc-'));

function bryanBooks(): PersonalityBooks {
  return {
    w: compiledBooks(BRYAN_VIENNA).w,
    b: booksForRepertoire({ asWhite: [], asBlack: BRYAN_PIRC }).b,
  };
}

/*
 * Freshman Brandon's opening, 1600.
 *
 * Prime's Vienna (White) and French (Black) chapters, selected out of the very
 * same compiled entries — no line is copied and no PGN is duplicated — plus his
 * own hand-written Open Sicilian and ...d5 mainlines.
 *
 * Prime's dedicated studies are deliberately not selected: the Keres 2.Ne2
 * Sicilian, the Austrian Attack and the Grünfeld chapter stay in Prime's book,
 * because they are exactly what the earlier Brandon has not learned yet.
 */
const BRANDON_FRESHMAN_VIENNA = BRANDON_BOOK.filter((entry) =>
  entry.lineIds.some((id) => id.startsWith(BRANDON_FRESHMAN_SHARED_WHITE_PREFIX)),
);
const BRANDON_FRESHMAN_FRENCH = BRANDON_BOOK.filter((entry) =>
  entry.lineIds.some((id) => id.startsWith(BRANDON_FRESHMAN_SHARED_BLACK_PREFIX)),
);

/** Combines two position → moves maps without sharing their arrays. */
function mergeBooks(first: PersonalityBook, second: PersonalityBook): PersonalityBook {
  const merged: PersonalityBook = new Map();
  for (const [key, moves] of first) merged.set(key, [...moves]);
  for (const [key, moves] of second) {
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, [...moves]);
      continue;
    }
    for (const move of moves) {
      if (!existing.some((entry) => entry.uci === move.uci)) existing.push(move);
    }
  }
  return merged;
}

function brandonFreshmanBooks(): PersonalityBooks {
  const sharedWhite = compiledBooks(BRANDON_FRESHMAN_VIENNA).w;
  const sharedBlack = compiledBooks(BRANDON_FRESHMAN_FRENCH).b;
  const own = booksForRepertoire(BRANDON_FRESHMAN_MAINLINES);
  return {
    w: { book: mergeBooks(sharedWhite.book, own.w.book), issues: [...own.w.issues] },
    b: { book: mergeBooks(sharedBlack.book, own.b.book), issues: [...own.b.issues] },
  };
}

/** Both colours for one character, built once per session. */
export function personalityBooks(id: string): PersonalityBooks {
  if (!isRepertoireId(id)) return { w: EMPTY, b: EMPTY };
  const cached = cache.get(id);
  if (cached) return cached;
  const built =
    id === 'brandon'
      ? compiledBooks(BRANDON_BOOK)
      : id === 'brandon-freshman'
        ? brandonFreshmanBooks()
        : id === 'nina' || id === 'nina-freshman'
        ? compiledBooks(NINA_BOOK)
        : id === 'bryan' || id === 'bryan-prime' || id === 'bryan-sophomore'
          ? bryanBooks()
          : booksForRepertoire(PERSONALITY_REPERTOIRES[id]);
  cache.set(id, built);
  return built;
}

export function personalityBookFor(id: string, color: PlayColor): PersonalityBook {
  return personalityBooks(id)[color].book;
}

/** Validation hook for tests: every declaration must replay without issues. */
export function repertoireIssues(): Array<{ id: PersonalityId; issues: BuiltBook['issues'] }> {
  const ids = [
    ...(Object.keys(PERSONALITY_REPERTOIRES) as PersonalityId[]),
    'brandon' as const,
    'brandon-freshman' as const,
    'nina' as const,
    'nina-freshman' as const,
    'bryan' as const,
    'bryan-prime' as const,
    'bryan-sophomore' as const,
  ];
  return ids.map((id) => ({
    id,
    issues: personalityBooks(id).w.issues.concat(personalityBooks(id).b.issues),
  }));
}
