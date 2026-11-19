# Lesson 6 — Integration and testing

> Code: [`gameReviewService.ts`](../../src/review/gameReviewService.ts), [`lessonPgn.ts`](../../src/lessons/lessonPgn.ts)
> Tests: [`learn/tests/`](../tests) · Runner: `npm run test:pgn`

## The boundary that makes everything else simple

`src/pgn` answers *"what does the text say?"*. The services answer *"is it legal, and
what does the board look like?"*. Keeping those apart is what lets the parser stay
small and be tested without a chess engine.

```
UI (paste / upload)
   │
   ▼
parsePgn(text)            ← tokens + tree (src/pgn), never throws
   │
   ▼
Chess replay              ← legality, SAN normalisation, FEN per node
   │
   ├── analyzeGame()       → Stockfish
   └── ParsedGame          → dashboard
```

## Integration 1 — game review

Before the merge, `parsePgn` was three lines of `chess.js`. Now it parses with the
tree and uses `chess.js` only as a validator:

```ts
export function parsePgn(pgn: string): ParsedGame {
  const trimmed = pgn.trim();
  if (!trimmed) throw new Error('Paste a PGN or upload a .pgn file first.');

  const { games } = parsePgnText(trimmed);          // ← src/pgn
  const game = games[0];
  if (!game) throw new Error('That PGN contains no moves.');

  const headerFen = game.headers.FEN?.trim();
  const board = headerFen ? new Chess(headerFen) : new Chess();

  const nodes = mainline(game);                     // main line only
  const moves = nodes.map((node) => {
    const fenBefore = board.fen();
    try {
      const move = board.move(node.san);
      return { san: move.san, uci: …, fenBefore, fenAfter: move.after,
               comment: node.comment, nags: node.nags };
    } catch {
      throw new Error(`Illegal move ${moveNumber}. ${node.san} — check the PGN …`);
    }
  });
  …
}
```

What this buys, compared with the pre-merge version:

| Before | After |
| --- | --- |
| `chess.js` error string ("Invalid move") | `Illegal move 23… Qh4 — check the PGN around that point.` |
| Variations flattened silently | Main line used deliberately; tree available via `parsePgn` |
| Comments keyed by FEN (collide) | Per-move comments on `ParsedMove.comment` |
| NAGs dropped | `ParsedMove.nags`, ready for badges |
| `startingFen` from `moves[0].before` | Same, plus `SetUp`/`FEN` honoured explicitly |

The public type only gained **optional** fields, so every existing caller — the
dashboard, the coach text builder, the saved-review records — compiles and behaves
exactly as before.

## Integration 2 — custom lesson import

The old importer used `game.loadPgn()` and mapped comments by FEN. The new one uses
the tree's main line:

```ts
const game = parseSingleGame(trimmed);
const nodes = mainline(game);
if (nodes.length === 0) throw new Error('That PGN contains no moves.');

const board = new Chess(startingFen ?? START_FEN);
const moves = nodes.map((node) => {
  const move = board.move(node.san);       // throws → named error below
  return { uci: …, san: move.san, explanation: node.comment };
});
```

Two behaviours are intentional:

- **Variations are not imported into a lesson.** A lesson is one ordered line; the
  player steps through it. Silently picking a branch would teach the wrong move.
  (The tree is still one `parsePgn` call away if a study mode is added.)
- **A bad move names itself**: `The move "Nf6" is not legal in this line.` rather
  than "That PGN could not be read".

## Integration 3 — lesson export (ported legacy format)

The legacy app could serialise a chapter back to PGN; the React app had lost that.
`lessonToPgn` restores it, including the `[ChapterName]` tag the old format used:

```ts
export function lessonToPgn(lesson: Lesson): string {
  const root = createNode();
  let cursor = root;
  for (const move of lesson.moves) {            // a lesson is a single chain
    const node = createNode(move.san, move.explanation);
    cursor.children.push(node);
    cursor = node;
  }
  return gameToPgn({ … }, {
    startFen: lesson.startingFen ?? null,
    extraTags: { ChapterName: lesson.title },
    annotations: 'symbol',
  });
}
```

It is wired to the UI: **Export PGN** in the lesson panel downloads a `.pgn` whose
comments are the coaching notes, which re-imports through `parseLessonPgn` with
notes intact (asserted in `writer.test.ts`).

## Testing without a test framework

There is no Vitest here on purpose. Node 26 runs TypeScript directly, so the same
files the app imports are the ones under test:

```bash
npm run test:pgn     # node --test learn/tests/
```

Two consequences you must respect when editing `src/pgn`:

1. **Import siblings with explicit `.ts` extensions.** Plain Node ESM does not
   resolve extensionless paths; Vite and `tsc` both accept `.ts`, so one form works
   for both.
2. **No type-only runtime imports.** `import type` is erased by the stripper; a
   plain `import { SomeType }` would fail at runtime.

### What the suite covers

| Area | Representative test |
| --- | --- |
| Escapes in tags | `reads tag pairs, including escaped quotes and backslashes` |
| Comment syntaxes | `reads both comment syntaxes as comments` |
| Comments swallowing parens | `keeps parentheses inside comments from becoming variation tokens` |
| Producer `%` lines | `a percent line at the start of a line is a producer escape` |
| Malformed input | `never throws on junk; reports it as warnings` |
| Tree shape | `builds a tree where children[0] is the main line…` |
| Backwards comments | `a comment belongs to the move before it` |
| NAG normalisation | `converts !? suffixes and $n annotations to numeric NAGs` |
| Multi-game files | `handles multiple games in one file` |
| Round trip | `round-trips a game with variations, comments and NAGs` |
| FEN numbering | `numbers a line that starts with Black to move` |
| Legacy export format | `lessons survive a PGN round trip` |

## Checklist for extending the parser

When you add a feature, keep the layers honest:

1. **Lexer** — only if a new *lexical form* appears (a new bracket syntax). Never
   make it decide chess semantics.
2. **Parser** — if structure changes (new node field, new attachment rule). Update
   `types.ts` first; the compiler then lists every place that must adapt.
3. **Writer** — every new field needs an emission rule and a round-trip test.
4. **Service** — only if legality, FENs or persistence are involved.
5. **Course** — add the decision and its *why* to the relevant lesson.

Run, in this order:

```bash
npm run test:pgn     # parser contract
npm run build        # types + bundle
npm run dev          # paste a real Lichess/chess.com PGN in Game review
```

## Exercises

1. Surface `ParsedGame.warnings` in the review dashboard as a dismissable notice.
   Where should it render — above the board, or in the toast system?
2. Add a `parseLessonPgn` option that imports a chosen variation as the lesson line
   (e.g. `line: ['c5']`), using `tree.walk` to resolve the path.
3. Benchmark parsing a 5,000-game database. Which stage dominates — lexing, tree
   building, or the chess.js replay? Measure before optimising.
