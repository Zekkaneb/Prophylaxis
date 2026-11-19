# Building a PGN Parser — a six-part course

A guided tour of `src/pgn/`: the module that reads Portable Game Notation, turns
it into a move tree, and writes it back out without losing anything.

The course is written for developers who know TypeScript but have never built a
parser. Every decision that looks arbitrary — why a character scanner instead of
a regex, why comments attach backwards, why variations are siblings — is
explained where it happens in the code, and again in the lesson that covers it.

---

## 1. What this module is (and is not)

`src/pgn` does **three** things and nothing else:

| Stage | File | Input → output |
| --- | --- | --- |
| Lexing | `tokenizer.ts` | text → flat token stream |
| Parsing | `parser.ts` | tokens → move tree |
| Writing | `writer.ts` | move tree → text |

It has **no chess rules**. It cannot tell you whether `Nf3` is legal — that needs
a board, and a board belongs to `chess.js`. Legality is verified one layer up, in
the services that own a `Chess` instance. This separation is the reason the parser
is 400 lines instead of 4,000, and the reason it runs in Node for tests.

```
                 tokenize()                parsePgn()              gameToPgn()
  PGN text  ──────────────────▶  tokens  ──────────────▶  tree  ──────────────▶  PGN text
  "1. e4 {…}"                    tag/word/             root ─ e4 ─ e5
                                 nag/(/)/…                      └─ c5 (variation)
```

## 2. How this codebase was merged

This project had two PGN implementations that had drifted apart:

**Legacy — `pgn-parser.js`** from the original static app (archived in
`archive/legacy-static-app.tar.gz`; see `archive/README.md`).
A hand-written character scanner that produced a real move tree, understood
variations, NAGs, both comment syntaxes, multi-game files, and could serialise a
chapter back to PGN. It also carried `buildChapter`, which replayed the tree on a
rules engine to normalise SAN and store a FEN per node.

**New — `src/review/gameReviewService.ts` and `src/lessons/customLessons.ts`**
(the React app). Both delegated to `chess.js`'s `loadPgn`. That is short and
well-tested, but it is lossy for this app's purposes: variations and NAGs are
flattened, comments are keyed by FEN (so two comments in the same position
collide), and there is no way to tell *why* a file failed to load.

**The merge:** the legacy scanner's understanding of the notation was ported into
a typed, tested module (`src/pgn/`), and the new codebase kept its responsibilities.

| Capability | Legacy | New before merge | After merge |
| --- | --- | --- | --- |
| Tag pairs, escaped quotes | ✅ | via chess.js | ✅ `tokenizer.ts` |
| `{ }` and `;` comments | ✅ | partial (chess.js) | ✅ `tokenizer.ts` |
| Comment → move attachment | ✅ | via FEN map (collides) | ✅ `parser.ts` |
| Nested variations `( … )` | ✅ | ❌ flattened | ✅ `parser.ts` |
| NAGs (`$1`, `!?`) | ✅ | ❌ dropped | ✅ `annotations.ts` |
| Multi-game files | ✅ | first game only | ✅ `parser.ts` |
| Warnings instead of exceptions | ✅ | ❌ throws | ✅ `parser.ts` |
| Move tree with `children[0]` mainline | ✅ | ❌ linear array | ✅ `types.ts` |
| PGN writer, variations intact | ✅ | ❌ none | ✅ `writer.ts` |
| SAN normalisation + FEN per node | ✅ (`buildChapter`) | ✅ chess.js | ✅ `gameReviewService.ts` |
| Typed API, unit tests | ❌ | ❌ | ✅ this course |

Deliberately **not** ported: `buildChapter`'s opinionated chapter model
(`ChapterName`, `Orientation`, course titles). Those are features of the old
product's course format, not of PGN; the new app expresses the same ideas as
`Lesson` / `ParsedGame`. The writer keeps `ChapterName` support through
`extraTags`, which is how lesson export still produces old-style files.

Nothing in the new public surface changed: `parsePgn` (review), `parseLessonPgn`
(custom lessons) and `recordToLesson` keep their signatures and error messages.

## 3. Syllabus

Each lesson is self-contained but they build in order.

| # | Lesson | You will learn | Code |
| --- | --- | --- | --- |
| 1 | [Lexical analysis](lessons/01-lexing.md) | Why a character scanner beats regexes; how comments, escapes and `%` lines are tokenised | `src/pgn/tokenizer.ts` |
| 2 | [Tags and metadata](lessons/02-tags-and-metadata.md) | Tag pairs, the Seven Tag Roster, `SetUp`/`FEN`, detecting a new game | `readTagPair`, `gameToPgn` |
| 3 | [The move tree](lessons/03-move-tree.md) | Why `children[0]` is the main line; walking and mainlining a tree | `src/pgn/parser.ts`, `tree.ts` |
| 4 | [Variations, comments, NAGs](lessons/04-variations-comments-nags.md) | The variation stack; PGN's backwards comment rule; suffix → NAG normalisation | `src/pgn/parser.ts`, `annotations.ts` |
| 5 | [Writing and round-tripping](lessons/05-writing-and-round-tripping.md) | Movetext numbering, escaping, glue-vs-token annotations, round-trip testing | `src/pgn/writer.ts` |
| 6 | [Integration and testing](lessons/06-integrating-and-testing.md) | Putting the parser behind a rules engine; running tests in plain Node | `gameReviewService.ts`, `lessonPgn.ts`, `learn/tests/` |

## 4. Running things

Everything works from the repository root.

```bash
npm install            # once
npm run test:pgn       # 23 unit tests, no build step, no test framework
npm run dev            # the app: paste a PGN in "Game review"
npm run build          # type-check + production build
```

Run any example directly — Node executes TypeScript natively here:

```bash
node learn/examples/01-parse-and-inspect.ts
node learn/examples/02-round-trip.ts
node learn/examples/03-lesson-export.ts
```

`npm run test:pgn` is `node --test learn/tests/`. There is no Vitest/Jest
dependency: Node 26 strips the types, so the same `.ts` files the app imports are
the ones under test. That is also why `src/pgn/*` imports its siblings with
explicit `.ts` extensions — plain Node ESM needs them, and Vite/tsc accept them.

### Using the parser in five lines

```ts
import { parsePgn, gameToPgn, mainline } from './src/pgn/index.ts';

const { games } = parsePgn('1. e4 e5 (1... c5 2. Nf3) 2. Nf3 Nc6');
console.log(mainline(games[0]).map((node) => node.san)); // e4 e5 Nf3 Nc6
console.log(gameToPgn(games[0]));                         // full PGN, variation intact
```

## 5. Design rules worth remembering

1. **Never throw on malformed input.** A chess trainer must open a file with one
   bad token. Problems accumulate in `game.warnings` and parsing continues.
2. **Comments belong to the move before them.** That is PGN's rule; the parser
   stores it literally instead of inventing a "leading comment" concept.
3. **Variations are siblings, not a separate type.** `e4` has two children,
   `e5` and `c5`; the first is the main line. No `variation` node is needed, and
   any tree walk naturally handles nesting.
4. **The parser never judges legality.** Shape checks are lexical; `chess.js`
   decides what is a legal move, one layer up.
5. **Text in, text out.** No DOM, no storage, no React — which is what makes the
   whole module testable with `node --test`.

## 6. Where to go next

- The PGN specification (Standard: Seven Tag Roster, movetext) is short and worth
  reading once: <https://www.saremba.de/chessgml/standards/pgn/pgn-complete.htm>
- Exercises that extend the module are at the end of each lesson.
- If you change the tokenizer or parser, `npm run test:pgn` is the contract:
  every legacy edge case listed in the merge table has a test.
