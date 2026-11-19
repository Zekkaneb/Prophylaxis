# Lesson 1 — Lexical analysis

> Code: [`src/pgn/tokenizer.ts`](../../src/pgn/tokenizer.ts)
> Tests: [`learn/tests/tokenizer.test.ts`](../tests/tokenizer.test.ts)

## The problem

A PGN file is a mix of four languages at once:

```pgn
[Event "Club \"A\""]          ← tag pairs (quoted strings with escapes)
1. e4 { best by test }        ← movetext plus a comment
1... e5 ; the open game       ← a second comment syntax
2. Nf3 (2. Bc4 Nf6) Nc6 $14   ← variations and annotations
```

Before the parser can think about *structure*, something has to decide where one
thing ends and the next begins. That is the lexer's entire job: it produces a flat
list of classified tokens, with no opinions about chess.

## Why not a regex?

The tempting implementation is:

```ts
// Do not do this
const words = pgn.split(/\s+/);
```

It breaks immediately:

| Input | Naïve split | Why it is wrong |
| --- | --- | --- |
| `[Event "Rated blitz game"]` | `[Event`, `"Rated`, `blitz`, `game"]` | tag values contain spaces |
| `{ a (comment) }` | `{`, `a`, `(comment)`, `}` | comments contain PGN punctuation |
| `[Site "C:\\games"]` | — | escapes need character-level handling |
| `; note with ) inside` | — | a line comment would unbalance the tree |

A single mega-regex runs into the same wall from the other side: comment bodies
contain parentheses and quotes, so any pattern that is simple enough to maintain
is also wrong, and when it fails you cannot say *where*.

A cursor that advances character by character handles each form locally, in one
pass, with no backtracking. Every production PGN importer works this way.

## The token vocabulary

From `src/pgn/types.ts`:

```ts
export type Token =
  | { kind: 'tag'; name: string; value: string; at: number }
  | { kind: 'comment'; text: string; inline: boolean; at: number }
  | { kind: 'nag'; value: number; at: number }
  | { kind: 'number'; raw: string; at: number }
  | { kind: 'result'; value: string; at: number }
  | { kind: 'variation-start'; at: number }
  | { kind: 'variation-end'; at: number }
  | { kind: 'word'; value: string; at: number };
```

Three choices are worth noticing:

- **`at`** is the character offset. Warnings say *"Unrecognised token "&" at
  offset 7"*, which is the difference between a bug report and a shrug.
- **`number`** (`12.`, `12...`, `12…`) is a token even though the parser throws it
  away. Keeping it means the lexer does not have to know that move numbers are
  decorative — and a future UI could use them for line splitting.
- **`word`** is deliberately vague. `e4`, `O-O`, `$14` and `hello` all start life
  as a word; deciding which are moves is the parser's (and then chess.js's) job.

## Walking the scanner

`tokenize()` is a generator, so the parser can pull one token at a time:

```ts
export function* tokenize(text: string, warnings: string[] = []): Generator<Token> {
  let i = 0;
  while (i < length) {
    const char = text[i];
    if (char === ' ' || char === '\t' || char === '\n') { i += 1; continue; }
    ...
  }
}
```

The branch order matters. Each rule is checked *before* the generic word scan, so
that punctuation with meaning is never swallowed as text:

1. **Whitespace** — separator only, never a token.
2. **`%` at the start of a line** — a producer escape (licence headers). The whole
   line is skipped. Note the `i === 0 || text[i-1] === '\n'` guard: a `%` in the
   middle of a line is ordinary text.
3. **`[`** — attempt `readTagPair`. On failure, warn and fall through, so a
   half-copied tag line does not eat the rest of the file.
4. **`{`** — brace comment. PGN comments do **not** nest, so the first `}` closes
   it; an unterminated comment warns and consumes the remainder.
5. **`;`** — line comment to end of line. This must happen before variation
   handling: `(`, `)` and `{` inside a line comment are just text.
6. **`(` / `)`** — their own tokens, because the parser needs them to build the tree.
7. **Anything else** — scan to the next whitespace or `(){};`, then classify the
   word as a result, a move number, a NAG, or a bare word.

### Escapes inside tag values

```ts
while (i < text.length && text[i] !== '"') {
  if (text[i] === '\\' && (text[i + 1] === '"' || text[i + 1] === '\\')) {
    value += text[i + 1];
    i += 2;
    continue;
  }
  value += text[i];
  i += 1;
}
```

Only `\"` and `\\` are special. A backslash before anything else is literal —
which matters for Windows paths in `[Site]`. Note that the loop consumes pairs, so
`\\"` (escaped backslash followed by a closing quote) terminates correctly.

## Normalise first, lex second

```ts
export function normalizePgnText(input: string): string {
  return String(input ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}
```

Three line endings, BOMs from Windows editors, and `null` from a broken file input
all disappear in one place. Every later stage can then assume `\n` and non-null
strings — a very cheap invariant to buy.

## Warnings instead of exceptions

```ts
if (close < 0) warnings.push(`Unterminated { comment starting at offset ${i}.`);
```

`warnings` is passed *into* the lexer rather than returned, so the parser can keep
one chronological list per game. The lexer never throws: an unterminated comment
still yields a comment token holding the rest of the file, and the parse continues.
A trainer that refuses to open a study because of one stray brace is a worse
product than one that opens it with a note in the corner.

## What the tokens look like

`tokenizeAll('1. e4 { best } e5 (1... c5) *')`:

```
number   "1."
word     "e4"
comment  " best "
word     "e5"
variation-start
number   "1..."
word     "c5"
variation-end
result   "*"
```

Notice what the lexer did **not** do: it did not pair the parentheses, attach the
comment to `e4`, or check that `c5` is a legal reply. Those are structural
questions, and structure is Lesson 3.

## Exercises

1. Add a `clock` token for `[%clk 0:03:00]` instead of stripping it in
   `cleanComment`. Where does it belong — lexer or parser? (Hint: it is only
   meaningful inside a comment.)
2. The lexer accepts `12.` and `12...`. Add support for `12. ... e5` (a
   space between the number and the dots) and a test for it.
3. Make `readTagPair` tolerate a missing closing `]` and explain, in a comment,
   why that might be *worse* than warning.
