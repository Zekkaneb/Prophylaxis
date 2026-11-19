/**
 * Stage 1 — the lexer (tokenizer).
 *
 * WHY A CHARACTER SCANNER INSTEAD OF REGEXES?
 * -------------------------------------------
 * PGN looks regex-friendly until you meet its real-world edge cases:
 *
 *   [Event "Rated blitz game \"quoted\" title"]
 *   { a comment with (parentheses) and a ] bracket }
 *   e4 ; a line comment that swallows ) and { }
 *
 * Splitting on whitespace first (the tempting one-liner) breaks all of those,
 * and a single mega-regex becomes unmaintainable and impossible to blame when
 * it fails. A cursor over the string solves each case locally, in one pass,
 * without ever backtracking — which is also how production parsers (and
 * chess.com/Lichess importers) do it.
 *
 * The lexer's only job is classification. It decides "this is a comment",
 * "this is a tag pair", "this is a bare word". It never decides whether a word
 * is a legal move — that needs a rules engine and belongs further downstream.
 */

import type { Token } from './types.ts';

/**
 * PGN files arrive with BOMs, Windows line endings and stray trailing spaces.
 * Normalising once, up front, means every later stage can assume `\n` only.
 */
export function normalizePgnText(input: string): string {
  return String(input ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n');
}

/** `1-0`, `0-1`, `1/2-1/2`, the unicode `½-½`, and the "unknown" `*`. */
const RESULT_PATTERN = /^(?:1-0|0-1|1\/2-1\/2|½-½|\*)$/;

/** `12.`, `12...`, and the ellipsis form `12…` all introduce a move number. */
const MOVE_NUMBER_PATTERN = /^\d+(?:\.{1,3}|…)$/;

/** Characters that end a bare word. Note `[` and `]` are deliberately absent. */
const WORD_BREAK = /[\s(){};]/;

interface TagRead {
  token: Token;
  next: number;
}

/**
 * Reads `[Name "value"]` starting at `start`.
 *
 * Returns `null` — rather than throwing — when the text is malformed, because
 * real PGN files contain half-copied tag lines. The caller then treats the
 * opening `[` as ordinary text, which produces one clear warning instead of
 * losing the rest of the file to an exception.
 */
function readTagPair(text: string, start: number): TagRead | null {
  let i = start + 1;

  // Allow `[ Event "…"]`: whitespace after the bracket is legal.
  while (text[i] === ' ' || text[i] === '\t') i += 1;

  const nameStart = i;
  while (i < text.length && /[A-Za-z0-9_]/.test(text[i])) i += 1;
  if (i === nameStart) return null;
  const name = text.slice(nameStart, i);

  while (text[i] === ' ' || text[i] === '\t') i += 1;
  if (text[i] !== '"') return null;
  i += 1;

  // Tag values may escape `"` and `\`; everything else is literal, including
  // newlines (some exporters wrap long event names).
  let value = '';
  while (i < text.length && text[i] !== '"') {
    if (text[i] === '\\' && (text[i + 1] === '"' || text[i + 1] === '\\')) {
      value += text[i + 1];
      i += 2;
      continue;
    }
    value += text[i];
    i += 1;
  }
  if (text[i] !== '"') return null;
  i += 1;

  while (text[i] === ' ' || text[i] === '\t') i += 1;
  if (text[i] !== ']') return null;

  return {
    token: { kind: 'tag', name, value, at: start },
    next: i + 1,
  };
}

/**
 * Turns normalised PGN text into tokens.
 *
 * `warnings` is passed in (rather than returned) so the parser can collect
 * lexer and parser complaints in one chronological list — the same array ends
 * up on `PgnGame.warnings`.
 *
 * A generator is used because lexing is inherently streaming: the parser pulls
 * one token at a time and the lexer keeps its cursor in a closure.
 */
export function* tokenize(text: string, warnings: string[] = []): Generator<Token> {
  let i = 0;
  const length = text.length;

  while (i < length) {
    const char = text[i];

    // 1. Whitespace is a separator, never a token.
    if (char === ' ' || char === '\t' || char === '\n') {
      i += 1;
      continue;
    }

    // 2. `%` at the very start of a line is PGN's "escape" mechanism: the whole
    //    line is a producer comment, usually a licence header. It is skipped
    //    rather than tokenised because it is not part of the game.
    if (char === '%' && (i === 0 || text[i - 1] === '\n')) {
      const newline = text.indexOf('\n', i);
      i = newline < 0 ? length : newline + 1;
      continue;
    }

    // 3. Tag pairs.
    if (char === '[') {
      const tag = readTagPair(text, i);
      if (tag) {
        yield tag.token;
        i = tag.next;
        continue;
      }
      warnings.push(`Malformed tag pair at offset ${i}; reading it as text.`);
      // Fall through: the generic word scanner will consume `[Event` and the
      // parser will report it as an unrecognised token.
    }

    // 4. Brace comments `{ … }`. PGN does not allow nesting, so the first `}`
    //    closes the comment. An unterminated comment is a warning, not a crash:
    //    the rest of the file is still worth tokenising.
    if (char === '{') {
      const close = text.indexOf('}', i + 1);
      const body = close < 0 ? text.slice(i + 1) : text.slice(i + 1, close);
      if (close < 0) warnings.push(`Unterminated { comment starting at offset ${i}.`);
      yield { kind: 'comment', text: body, inline: false, at: i };
      i = close < 0 ? length : close + 1;
      continue;
    }

    // 5. Line comments `; …` run to the end of the line. Because `(` and `)`
    //    are legal inside them, they must be consumed here — never by the
    //    variation logic — or a comment could unbalance the tree.
    if (char === ';') {
      const newline = text.indexOf('\n', i);
      const body = text.slice(i + 1, newline < 0 ? length : newline);
      yield { kind: 'comment', text: body, inline: true, at: i };
      i = newline < 0 ? length : newline + 1;
      continue;
    }

    // 6. Variation delimiters are tokens of their own: the parser needs to see
    //    them to know when it is entering or leaving a side line.
    if (char === '(') {
      yield { kind: 'variation-start', at: i };
      i += 1;
      continue;
    }
    if (char === ')') {
      yield { kind: 'variation-end', at: i };
      i += 1;
      continue;
    }

    // 7. Everything else is a bare word: SAN, `$12`, `1-0`, `12.` or junk.
    let end = i;
    while (end < length && !WORD_BREAK.test(text[end])) end += 1;
    const word = text.slice(i, end);
    i = end;

    if (!word) {
      // A single stray character (e.g. `]` after a malformed tag line).
      warnings.push(`Stray character "${text[i]}" ignored.`);
      i += 1;
      continue;
    }

    if (RESULT_PATTERN.test(word)) {
      yield { kind: 'result', value: word, at: i - word.length };
      continue;
    }

    if (MOVE_NUMBER_PATTERN.test(word)) {
      yield { kind: 'number', raw: word, at: i - word.length };
      continue;
    }

    if (word[0] === '$' && /^\$\d+$/.test(word)) {
      yield { kind: 'nag', value: Number.parseInt(word.slice(1), 10), at: i - word.length };
      continue;
    }

    yield { kind: 'word', value: word, at: i - word.length };
  }
}

/** Convenience wrapper used by tests and tools that do not need streaming. */
export function tokenizeAll(text: string): { tokens: Token[]; warnings: string[] } {
  const warnings: string[] = [];
  const tokens = [...tokenize(normalizePgnText(text), warnings)];
  return { tokens, warnings };
}
