/**
 * Data shapes shared by every stage of the PGN pipeline.
 *
 * The pipeline is deliberately three-stage — text → tokens → tree → PGN text —
 * because each stage is independently testable:
 *
 *   tokenize()   turns characters into a flat token stream
 *   parsePgn()   folds tokens into a move TREE (one root, many branches)
 *   gameToPgn()  flattens the tree back into text
 *
 * Nothing in this module depends on chess.js, React or the DOM: the parser is
 * pure data in, pure data out. Validation of legality happens later, in the
 * services that own a rules engine.
 */

/** One half-move (a "ply") plus everything annotating it. */
export interface PgnNode {
  /** Standard Algebraic Notation as written in the source, e.g. `Nf3`, `O-O`, `exd8=Q+`. */
  san: string;
  /**
   * Free text that belongs to this move.
   *
   * PGN has no explicit "comment for move X" marker: a `{ comment }` attaches
   * to the move that precedes it. When several comments land on the same move
   * they are joined with newlines (see `appendComment` in parser.ts).
   */
  comment: string;
  /**
   * Numeric Annotation Glyphs (`$1`, `$14`, …) and the `!?`-style suffixes
   * converted to their numeric equivalents. Stored, not interpreted: a GUI
   * decides whether to render `?!` as text, a badge or a colour.
   */
  nags: number[];
  /**
   * Ordered continuations. `children[0]` is the main line; `children[1..]` are
   * the alternatives written as `( … )` in the source.
   */
  children: PgnNode[];
}

/** A parsed game: its tag pairs, its tree, and whatever upset the parser. */
export interface PgnGame {
  /** Zero-based position of the game in the source file (multi-game PGN files exist). */
  index: number;
  /** Seven Tag Roster first in practice, but stored as written. */
  headers: Record<string, string>;
  /** Synthetic pre-move node. Root comments describe the starting position. */
  root: PgnNode;
  /** `1-0`, `0-1`, `1/2-1/2` or `*`, or `null` when the file never said. */
  result: string | null;
  warnings: string[];
}

export interface ParseResult {
  games: PgnGame[];
  /** Warnings that could not be attributed to a single game (e.g. a stray `)`). */
  warnings: string[];
}

/* -------------------------------------------------------------------------- */
/*                                  Tokens                                    */
/* -------------------------------------------------------------------------- */

/**
 * A lexical token. `at` is the character offset in the normalised source, so
 * warnings can point at the exact offending character instead of just saying
 * "something went wrong somewhere".
 *
 * `kind` (rather than `type`) is used so a token can never be confused with a
 * `PgnNode['type']`-style field if these types are ever mixed in one union.
 */
export type Token =
  | { kind: 'tag'; name: string; value: string; at: number }
  | { kind: 'comment'; text: string; inline: boolean; at: number }
  | { kind: 'nag'; value: number; at: number }
  | { kind: 'number'; raw: string; at: number }
  | { kind: 'result'; value: string; at: number }
  | { kind: 'variation-start'; at: number }
  | { kind: 'variation-end'; at: number }
  /** Any other bare word: a SAN candidate, or junk the parser must judge. */
  | { kind: 'word'; value: string; at: number };

/** Hint for the parser's error messages: a short, quotable token description. */
export function describeToken(token: Token): string {
  switch (token.kind) {
    case 'tag':
      return `[${token.name} "${token.value}"]`;
    case 'comment':
      return token.inline ? `;${token.text}` : `{${token.text}}`;
    case 'nag':
      return `$${token.value}`;
    default:
      return 'value' in token ? String(token.value) : token.kind;
  }
}
