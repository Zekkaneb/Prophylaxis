# Lesson 2 — Tag pairs and metadata

> Code: [`readTagPair`](../../src/pgn/tokenizer.ts), [`gameToPgn`](../../src/pgn/writer.ts)
> Tests: `tokenizer.test.ts` (tag cases), `writer.test.ts` (escaping, SetUp/FEN)

## What a tag pair is

Tags are the metadata header of a game:

```pgn
[Event "Rated blitz game"]
[Site "https://lichess.org/abcd1234"]
[Date "2024.05.01"]
[Round "-"]
[White "Ada"]
[Black "Grace"]
[Result "1-0"]
[WhiteElo "2140"]
```

The first seven — Event, Site, Date, Round, White, Black, Result — are the **Seven
Tag Roster**. Every other tag is optional and application-specific, which is why a
parser must preserve unknown tags rather than pick the ones it recognises.

## The grammar is almost regular

```ebnf
tag-pair     = "[" tag-name string "]" ;
tag-name     = identifier ;
string       = '"' { character | escape } '"' ;
escape       = "\" ( '"' | "\" ) ;
```

Three details cause most bugs in the wild:

1. **Spaces inside the value are ordinary.** `[Event "Club Championship"]` is one
   tag, not two. This alone rules out whitespace splitting.
2. **Only `"` and `\` are escaped.** Not `\n`, not `\t`. `\n` inside a value is a
   literal backslash and an `n`.
3. **Whitespace around the parts is tolerated.** `[ Event  "x" ]` is legal; real
   exporters emit it after copy-paste.

## Reading one tag

```ts
function readTagPair(text: string, start: number): TagRead | null {
  let i = start + 1;
  while (text[i] === ' ' || text[i] === '\t') i += 1;        // [ Event …

  const nameStart = i;
  while (i < text.length && /[A-Za-z0-9_]/.test(text[i])) i += 1;
  if (i === nameStart) return null;
  const name = text.slice(nameStart, i);

  while (text[i] === ' ' || text[i] === '\t') i += 1;
  if (text[i] !== '"') return null;                            // missing value
  ...
  if (text[i] !== ']') return null;                            // [Event "x"
  return { token: { kind: 'tag', name, value, at: start }, next: i + 1 };
}
```

Returning `null` rather than throwing is the important part. The caller warns once
and falls back to treating the line as text:

```ts
if (char === '[') {
  const tag = readTagPair(text, i);
  if (tag) { yield tag.token; i = tag.next; continue; }
  warnings.push(`Malformed tag pair at offset ${i}; reading it as text.`);
}
```

The alternative — `throw new Error('bad tag')` — turns one broken line into a
refused import. In a desktop trainer, a warning is always the better trade.

## Tags also delimit games

A PGN "database" is many games concatenated. There is no explicit separator; the
next `[Event …]` *is* the separator. The parser keys off that:

```ts
if (token.kind === 'tag') {
  if (!game || game.started || game.finished) {   // tags after moves ⇒ new game
    flush();
    game = createGameState(games.length);
  }
  game.headers[token.name] = token.value;
  continue;
}
```

`started` flips to true on the first move or comment, and `finished` flips on the
result token. Either one means "a tag now is a new game". This is how a file with
ten games becomes ten `PgnGame` objects — a legacy feature that the new app had
lost when it moved to `chess.js` (which only ever returns one game).

## The two tags that change the rules: `SetUp` and `FEN`

```pgn
[SetUp "1"]
[FEN "8/8/8/8/8/8/4K3/7k w - - 0 42"]
```

`SetUp "1"` says "this game does not start from the initial array"; `FEN` supplies
the position. A parser that ignores them will replay moves from the wrong board and
report false illegal moves.

In this codebase the FEN is not interpreted by `src/pgn` at all (it has no rules
engine). It is carried in `headers`, and the service that *does* own a board uses
it:

```ts
// gameReviewService.ts
const headerFen = headers.FEN?.trim();
const board = headerFen ? new Chess(headerFen) : new Chess();
```

The writer emits the pair together, which is what makes an export reloadable:

```ts
const startFen = options.startFen ?? headers.FEN ?? null;
if (startFen) {
  lines.push('[SetUp "1"]');
  lines.push(`[FEN "${escapeTagValue(startFen)}"]`);
}
```

> Rule of thumb: `SetUp` without `FEN` is meaningless, and `FEN` without `SetUp`
> is technically invalid. Always write both.

## Writing tags back

`gameToPgn` prints the roster first, in the specification's order, then any
surviving header alphabetically-as-stored:

```ts
const lines = SEVEN_TAG_ROSTER.map(
  (name) => `[${name} "${escapeTagValue(roster[name] ?? '?')}"]`,
);

const handled = new Set([...SEVEN_TAG_ROSTER, 'FEN', 'SetUp']);
for (const [name, value] of Object.entries(headers)) {
  if (handled.has(name)) continue;      // never duplicate a roster tag
  lines.push(`[${name} "${escapeTagValue(value)}"]`);
}
```

Escaping is symmetric with reading:

```ts
export function escapeTagValue(value: string): string {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')   // backslash FIRST, or you double-escape later
    .replace(/"/g, '\\"');
}
```

Reversing those two `replace` calls is a classic bug: escaping quotes first and
backslashes second corrupts every `\"` you just produced.

Defaults (`?`, `????.??.??`, `*`) are supplied only when writing, never when
reading — a missing tag is information ("the exporter did not know"), and
inventing a value at read time would erase it.

## Exercises

1. Add validation: a `result` that contradicts `[Result]` should produce a warning.
   Where does that check belong — lexer, parser, or writer?
2. `gameToPgn` currently prints unknown tags in object order. Make it sort them
   alphabetically and add a test.
3. A tag value may legally contain a newline. Confirm the tokenizer handles it and
   write the test that proves it.
