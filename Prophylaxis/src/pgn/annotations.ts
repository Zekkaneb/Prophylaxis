/**
 * Annotation Glyphs (NAGs) — the numeric vocabulary behind `!`, `?!`, `⩲` …
 *
 * PGN allows two spellings for the same idea:
 *
 *   e4!?      a suffix glued to the move
 *   e4 $5     the numeric form
 *
 * The suffix form is only defined for the six judgement marks below; every
 * other annotation (positional evaluations like `⩲`) exists only as a number.
 * The parser normalises suffixes to numbers so downstream code has exactly one
 * representation, and the writer turns numbers back into symbols when it can.
 */

/** The only suffixes PGN defines as NAG shorthands. */
export const SUFFIX_TO_NAG: Readonly<Record<string, number>> = {
  '!': 1,
  '?': 2,
  '!!': 3,
  '??': 4,
  '!?': 5,
  '?!': 6,
};

/**
 * Numeric → display symbol.
 *
 * The first six are "move judgement" NAGs that appear constantly in annotated
 * games; the rest are the standard positional assessments. Returning an empty
 * string means "no glyph exists" — the caller falls back to `$n`.
 */
export const NAG_SYMBOL: Readonly<Record<number, string>> = {
  1: '!',
  2: '?',
  3: '!!',
  4: '??',
  5: '!?',
  6: '?!',
  10: '=',
  13: '∞',
  14: '⩲',
  15: '⩱',
  16: '±',
  17: '∓',
  18: '+−',
  19: '−+',
};

/** `5` → `!?`; unknown NAGs return `''` so callers can print `$5` instead. */
export function nagToSymbol(nag: number): string {
  return NAG_SYMBOL[nag] ?? '';
}

/** `!?` → `5`; returns 0 for anything that is not a PGN suffix. */
export function symbolToNag(symbol: string): number {
  return SUFFIX_TO_NAG[symbol] ?? 0;
}

/**
 * Splits a trailing judgement suffix off a SAN token.
 *
 * `Nf3!?` → `{ san: 'Nf3', nag: 5 }`
 * `Qxh7#` → `{ san: 'Qxh7#', nag: 0 }`   (mate sign is not a NAG)
 *
 * A regex is used rather than trimming characters one by one because `!` and
 * `?` are only annotations when they appear at the *end* — a SAN token can
 * never contain them in the middle, so a trailing run of one or two is always
 * an annotation.
 */
export function splitSuffix(raw: string): { san: string; nag: number } {
  const match = /^(.+?)([!?]{1,2})$/.exec(raw);
  if (!match) return { san: raw, nag: 0 };
  const nag = SUFFIX_TO_NAG[match[2]];
  if (!nag) return { san: raw, nag: 0 };
  return { san: match[1], nag };
}
