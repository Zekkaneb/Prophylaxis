# Lesson 5 — Writing PGN and round-tripping

> Code: [`src/pgn/writer.ts`](../../src/pgn/writer.ts)
> Tests: [`learn/tests/writer.test.ts`](../tests/writer.test.ts)

## Why the writer is the real test

It is easy to write a parser that produces "good enough" PGN for a screenshot and
loses a variation on export. The writer is where every data-model mistake becomes
visible: if the tree cannot be serialised faithfully, the tree is wrong.

The contract is a round trip:

```
parse(text) → tree → gameToPgn(tree) → text′ → parse(text′) → tree′
                                     tree′ must equal tree
```

That equality is what `writer.test.ts` asserts, using a structural signature:

```ts
function signature(node: PgnNode) {
  return { san: node.san, comment: node.comment, nags: node.nags,
           children: node.children.map(signature) };
}
```

## Rule 1 — only White's moves carry a number (in the main line)

```pgn
1. e4 e5 2. Nf3 Nc6
```

Not `1. e4 1... e5`. The number is printed when `ply % 2 === 0`, i.e. on White's
half-moves:

```ts
const moveNumber = Math.floor(ply / 2) + 1;
if (ply % 2 === 0) out.push(`${moveNumber}.`);
else if (forceNumber) out.push(`${moveNumber}...`);
```

`forceNumber` exists because the reader can lose its place:

```ts
forceNumber = hadVariation || Boolean(node.comment);
```

After `( … )` or `{ … }` the next Black move must repeat its number (`2... Nc6`), or
the output is ambiguous to both humans and parsers.

## Rule 2 — numbering starts from the FEN, not from 1

A game from a custom position does not start at move 1. The writer reads the clock
straight out of the FEN:

```ts
export function fenClock(fen?: string | null): { turn: 'w' | 'b'; fullmove: number } {
  if (!fen) return { turn: 'w', fullmove: 1 };
  const fields = fen.trim().split(/\s+/);
  return { turn: fields[1] === 'b' ? 'b' : 'w', fullmove: Number(fields[5]) || 1 };
}
```

Then the first ply is offset:

```ts
const startPly = (fullmove - 1) * 2 + (turn === 'b' ? 1 : 0);
```

For `… b - - 0 5`, `startPly = 9`, so the first move prints as `5...` — exactly what
the source PGN said. Parsing a FEN's two trailing fields by hand keeps this module
free of a chess-rules dependency; the writer only counts, it never judges.

## Rule 3 — a suffix glues, a NAG token separates

This distinction is invisible in prose and obvious in output:

```pgn
e4!?        ← suffix glued to the move
e4 $5       ← numeric token, space-separated
```

Both are legal; mixing them up produces files that parse but read badly. The writer
handles it per-annotation:

```ts
let moveText = node.san;
const nagTokens: string[] = [];
for (const nag of node.nags) {
  const symbol = annotations === 'symbol' ? nagToSymbol(nag) : '';
  if (symbol) moveText += symbol;          // e4!?
  else nagTokens.push(`$${nag}`);          // e4 $14
}
out.push(moveText, ...nagTokens);
```

`annotations: 'number'` (the default) is canonical and lossless; `'symbol'` is for
files a human will read, and falls back to `$n` for NAGs with no glyph.

## Rule 4 — escaping order matters

```ts
export function escapeTagValue(value: string): string {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')   // first
    .replace(/"/g, '\\"');    // second
}
```

Reverse the order and `"` becomes `\"`, then the backslash you just inserted becomes
`\\"` — a different, broken value. The same class of bug appears in every language;
the rule is "escape the escape character first".

Comments need the opposite treatment: they are free text, and only `}` can end one
early, so it is dropped rather than escaped (PGN has no comment escape mechanism):

```ts
function escapeComment(value: string): string {
  return value.replace(/\}/g, '');
}
```

## Rule 5 — variations are printed beside the move they replace

```ts
const walk = (parent: PgnNode, index: number, ply: number): void => {
  while (cursor.children[slot]) {
    emitMove(node, ply, forceNumber);

    let hadVariation = false;
    if (slot === 0) {
      for (let alternative = 1; alternative < cursor.children.length; alternative += 1) {
        out.push('(');
        walk(cursor, alternative, ply);   // same ply: alternatives are siblings
        out.push(')');
        hadVariation = true;
      }
    }
    …
  }
};
```

Three details:

- The recursion passes **the same `ply`**, because a variation replaces a move at
  that depth rather than continuing after it.
- Variations are emitted **after** the main move, but *before* the main line
  continues — the `while` loop moves on only when the sibling loop is done.
- Nested variations come out naturally: the recursive call hits the same sibling
  loop one level down.

## Rule 6 — tags, movetext, result

```ts
return `${lines.join('\n')}\n\n${movetext ? `${movetext} ` : ''}${result}\n`;
```

A blank line between tags and movetext is required by the format. The result token
appears twice — once as `[Result]` and once at the end of the movetext — and both
must agree; `gameToPgn` uses one variable for both so they cannot diverge.

## Reading the output of the tests

Input:

```pgn
1. e4! { king pawn } e5 (1... c5 2. Nf3 { Sicilian } (2. Nc3)) 2. Nf3 Nc6 $14 *
```

Written back (default options):

```pgn
[Event "Round trip"]
…

1. e4 $1 { king pawn } e5 (1... c5 2. Nf3 { Sicilian } (2. Nc3)) 2. Nf3 Nc6 $14 *
```

Note `e4!` became `e4 $1` — the suffix was normalised on the way in and re-emitted in
canonical numeric form. With `{ annotations: 'symbol' }` it comes back as `e4!`.
Both are correct; the test asserts the *tree* survives, not the spelling.

## Exercises

1. Add an option `lineLength` that wraps movetext at 80 characters without breaking
   inside a comment or variation. (Hint: emit into an array of "atoms" first, then
   join with wrapping.)
2. Write a round-trip test for a game whose first move is Black's and whose
   `[FEN]` says move 42.
3. Prove the escaping-order bug: swap the two `replace` calls, run
   `npm run test:pgn`, and describe the failing assertion.
