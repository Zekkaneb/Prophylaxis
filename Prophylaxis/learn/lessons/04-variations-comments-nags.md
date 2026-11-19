# Lesson 4 — Variations, comments and NAGs

> Code: [`src/pgn/parser.ts`](../../src/pgn/parser.ts), [`src/pgn/annotations.ts`](../../src/pgn/annotations.ts)
> Tests: `parser.test.ts` (comments, NAGs, warnings); `writer.test.ts` (round trip)

Three features separate a toy PGN reader from a usable one. All three are small
once the tree exists.

## 1. Variations: a stack of saved positions

When the parser meets `(`, it has to answer: *branch from where?* The answer is the
parent of the last move — the position the last move was played in.

```ts
case 'variation-start':
  if (skipDepth > 0) { skipDepth += 1; break; }
  if (!lastNode || !lastParent) {
    warnings.push('A variation appeared before any move and was skipped.');
    skipDepth = 1;
    break;
  }
  stack.push({ cursor, lastNode, lastParent });   // save where we were
  cursor = lastParent;                            // rewind to the branch point
  lastNode = null;                                // next comment is pending
  lastParent = null;
  break;
```

Stepping through `1. e4 e5 (1... c5 2. Nf3) 2. Nf3`:

| Token | cursor | lastNode | Note |
| --- | --- | --- | --- |
| `e4` | e4 | e4 | appended under root |
| `e5` | e5 | e5 | appended under e4 |
| `(` | e4 | — | rewind to **e4**, the parent of e5 — where the alternative belongs |
| `c5` | c5 | c5 | appended under e4 as `children[1]` |
| `Nf3` | Nf3 | Nf3 | appended under c5 |
| `)` | e5 | e5 | restored from the stack |
| `Nf3` | Nf3 | Nf3 | main line continues under e5 |

Because the alternative is appended after the existing child, `children[0]` remains
the main line no matter how many variations were written and in what order.

### The skip counter

Some variations cannot be attached — `(1. e4)` before any move, or a second `(`
inside a variation that is already being skipped. Instead of dropping the tokens
into the tree at the wrong place, the parser counts parens:

```ts
if (skipDepth > 0) { skipDepth += 1; break; }   // nested unplaceable variation
```

Every move, comment and NAG inside is ignored while `skipDepth > 0`, and the
matching `)` decrements it. One counter handles arbitrary nesting.

### Unclosed variations

If the file ends mid-variation, `flush()` reports it and still returns the game:

```ts
if (game.stack.length > 0) {
  game.warnings.push(`${game.stack.length} unclosed variation(s) at end of game.`);
}
```

The partial branch is preserved. Refusing to load would lose the entire study over a
missing `)`.

## 2. Comments attach backwards

This is PGN's least intuitive rule, and the one that most naive parsers get wrong:

```pgn
1. e4 { king pawn } e5
```

`{ king pawn }` belongs to **e4**, the move *before* it — not to e5. From the
specification: a comment applies to the move it follows.

Implementation is therefore "append to `lastNode`, or park it":

```ts
function addComment(game: GameState, text: string): void {
  const clean = cleanComment(text);
  if (!clean) return;

  if (game.lastNode) { appendComment(game.lastNode, clean); return; }

  // No move yet: it is either the game preamble or right after a `(`.
  if (game.stack.length === 0 && game.root.children.length === 0) {
    appendComment(game.root, clean);
    return;
  }
  game.pending = game.pending ? `${game.pending}\n${clean}` : clean;
}
```

`pending` is drained by the next `addMove`, which is why a comment written *before*
a move (legal, and common in hand-edited files) still lands somewhere sensible
instead of being dropped.

Multiple comments on one move are joined with newlines rather than overwritten:

```ts
node.comment = node.comment ? `${node.comment}\n${clean}` : clean;
```

### Why not key comments by FEN?

The pre-merge implementation used `chess.getComments()`, which keys comments by
position FEN. Two comments in the same position — one on the main line, one in a
variation — collide and one is lost. Attaching to a node has no such ambiguity,
because a node *is* a unique move instance.

### Cleaning

```ts
export function cleanComment(text: string): string {
  return text
    .replace(/\[%[^\]]*\]/g, '')   // [%clk 0:03:00] and other embedded commands
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
```

Lichess writes clock and evaluation commands into comments. They are machine data,
not coaching prose, and a lesson note polluted with `[%clk 0:02:58]` looks broken to
a student.

## 3. NAGs: one representation for two spellings

PGN has two ways to say the same thing:

```pgn
e4!?          suffix form
e4 $5         numeric form
```

The suffix form only exists for six values, so the parser normalises everything to
numbers:

```ts
export const SUFFIX_TO_NAG = { '!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6 };

export function splitSuffix(raw: string): { san: string; nag: number } {
  const match = /^(.+?)([!?]{1,2})$/.exec(raw);
  if (!match) return { san: raw, nag: 0 };
  const nag = SUFFIX_TO_NAG[match[2]];
  return nag ? { san: match[1], nag } : { san: raw, nag: 0 };
}
```

Why normalise at all? Because downstream code should not have to check both. A
single `nags: number[]` can be rendered, counted, or exported, and the writer
converts back to symbols on request:

```ts
export function nagToSymbol(nag: number): string {
  return NAG_SYMBOL[nag] ?? '';    // '' means "no glyph, print $n"
}
```

NAGs with no move to attach to are a warning, not a crash:

```ts
else current.warnings.push(`Annotation $${token.value} has no move to attach to.`);
```

## Order of operations inside a variation

Comments inside a variation attach to moves *inside that variation*, because
`addComment` always looks at the current `lastNode`. After `)` the stack restores
the outer `lastNode`, so a comment after the closing paren attaches to the main-line
move — which is what the PGN says:

```pgn
1. e4 e5 (1... c5) { main line note } 2. Nf3
```

`{ main line note }` belongs to **e5**, not to `c5`.

## Exercises

1. Add `#` (checkmate) notation to `NAG_SYMBOL`? Careful: `#` is part of SAN, not a
   NAG. Explain why in a comment.
2. Support `$` glyphs in the writer for NAGs above 19 (`$36` etc.) — currently
   `nagToSymbol` returns `''` and the writer falls back to `$n`. Test both paths.
3. A variation can start *before* a move's comment ends. Add a test with a comment
   inside a variation and confirm it attaches to the variation's last move.
