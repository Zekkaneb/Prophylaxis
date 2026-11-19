# Lesson 3 — Building the move tree

> Code: [`src/pgn/parser.ts`](../../src/pgn/parser.ts), [`src/pgn/tree.ts`](../../src/pgn/tree.ts)
> Tests: [`learn/tests/parser.test.ts`](../tests/parser.test.ts)

## Why a tree, not a list

A game with variations is not a sequence — it is a sequence *with branches*:

```
1. e4 e5 (1... c5 2. Nf3) 2. Nf3 Nc6
```

```
root
└── e4
    ├── e5            ← children[0] — the main line
    │   └── Nf3
    │       └── Nc6
    └── c5            ← children[1] — the Sicilian variation
        └── Nf3
```

Flattening this to `['e4','e5','Nf3','c5','Nf3','Nc6']` destroys the one thing a
study tool needs: which moves follow which. The legacy parser got this right and
the new app had lost it, because `chess.js`'s `history()` returns exactly that
flattened list.

## The node

```ts
export interface PgnNode {
  san: string;        // "Nf3" — as written; later normalised by the rules engine
  comment: string;    // prose attached to this move
  nags: number[];     // $1, $14 … (see Lesson 4)
  children: PgnNode[];
}
```

There is no `parent` pointer and no `variation` node type. Both omissions are
deliberate:

- **No parent** keeps the structure acyclic and trivially serialisable; the
  writer and UI walk downward, and a "breadcrumb" can be built from the path.
- **No variation type** means a variation is simply "a child that is not
  `children[0]`". Every walker then handles nesting for free, and the tree has
  exactly one shape to reason about.

## The state machine

Parsing movetext is a job for a small state machine. Six fields describe
everything the parser needs to know:

```ts
interface GameState {
  cursor: PgnNode;        // whose `children` the next move is appended to
  lastNode: PgnNode | null;    // most recent move — target for comments/NAGs
  lastParent: PgnNode | null;  // its parent — where a `(` returns to
  stack: Array<{ cursor, lastNode, lastParent }>;  // one per open `(`
  skipDepth: number;      // parentheses to ignore entirely
  pending: string;        // comment waiting for a move
  // …headers, result, warnings, started, finished
}
```

The three moving parts look redundant but are not:

| Field | Answers |
| --- | --- |
| `cursor` | "where does the next move attach?" |
| `lastNode` | "which move does this comment / `$14` belong to?" |
| `lastParent` | "which node does a new variation branch from?" |

A move advances all three:

```ts
function addMove(game: GameState, san: string): void {
  const node = createNode(san, game.pending);
  game.pending = '';
  game.cursor.children.push(node);
  game.lastParent = game.cursor;
  game.lastNode = node;
  game.cursor = node;
}
```

## From word to move

The lexer emits `word`; the parser decides whether it is a move:

```ts
function readWord(game: GameState, token: Extract<Token, { kind: 'word' }>): void {
  let word = token.value.replace(/^0-0-0/, 'O-O-O').replace(/^0-0/, 'O-O');
  word = word.replace(/^\d+(?:\.{1,3}|…)/, '');   // "1.e4" → "e4"

  if (!word || /^\d+$/.test(word) || /^\.+$/.test(word)) return;

  const { san, nag } = splitSuffix(word);          // "Nf3!?" → "Nf3", 5
  if (!SAN_SHAPE.test(san)) { game.warnings.push(...); return; }

  addMove(game, san);
  if (nag) game.lastNode!.nags.push(nag);
}
```

Two deliberate limits:

1. **`SAN_SHAPE` is lexical, not legal.** `/^[A-Za-z-][A-Za-z0-9=+#x\-@]*$/` accepts
   anything shaped like SAN — including `hello`. The parser cannot know that `hello`
   is not a move without a board, and pretending otherwise would duplicate chess
   rules badly. Legality is checked in the service layer (Lesson 6), where a real
   `Chess` exists and the error message can name the move number.
2. **Castling with zeros is normalised here.** `0-0` and `O-O` are both common;
   fixing it once, at admission, keeps every downstream comparison simple.

## Walking the result

Three helpers cover almost every use:

```ts
// Follow children[0] to the end.
export function mainline(game: PgnGame): PgnNode[] { … }

// Every complete line's last move.
export function leaves(root: PgnNode): PgnNode[] { … }

// Depth-first with ply numbers, for UI or export.
export function* walk(root: PgnNode, ply = 0): Generator<{ node; ply; line }> { … }
```

`walk` is a generator because most consumers want to stop early (find the node at
ply 12, or the first comment containing "Sicilian") and building an array first
would be wasted work.

## Where the tree meets a board

The tree stores SAN strings with no positions. To show a board you need a FEN per
node, which means replaying the line on a rules engine. That happens in
`gameReviewService.parsePgn`:

```ts
const nodes = mainline(game);
const moves = nodes.map((node) => {
  const fenBefore = board.fen();
  const move = board.move(node.san);   // throws for an illegal move
  return { san: move.san, uci: …, fenBefore, fenAfter: move.after };
});
```

This is the same two-stage design as the legacy `buildChapter` — parse first,
validate second — with one improvement: because the tree is available, a validation
failure can be reported with the exact move number and SAN instead of "invalid PGN".

## Complexity

| Operation | Cost |
| --- | --- |
| Lex + parse | O(n) characters, single pass, no backtracking |
| `mainline` | O(depth) |
| `countNodes` / `leaves` | O(nodes), iterative (no stack overflow on 10k-move files) |
| Replay with chess.js | O(moves × legal-move generation) — the expensive step, and the only one that needs a board |

## Exercises

1. Add `pathTo(root, ply, line)` and use it to highlight the current variation in a
   UI breadcrumb.
2. `walk` yields `line` as child indices. Extend the example in
   `learn/examples/02-walk-the-tree.ts` to print `1.e4 e5 (c5)`-style annotations.
3. Make `addMove` reject a second identical child (`e4 e5` twice in one line).
   What should happen instead — warning, merge, or both?
