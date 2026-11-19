# Play personalities — Phase 3 reference

The four Johnfer opponents in Play share a name and a portrait family but not a
repertoire, a move-selection profile or a voice. The General Bot is separate: it
plays the user's imported courses and never reads anything on this page.

## Target strength and identity

| Character | Role | Target Elo | White | Black vs 1.e4 | Black vs 1.d4 |
|---|---|---|---|---|---|
| Freshman | The Defender | 1250 | Ruy Lopez, principle-based | 1...e5 | 1...d5 (Slav lines) |
| Sophomore | The Opportunist | 1450 | Catalan (supplied) | Pirc (supplied) | King's Indian, principles |
| Junior | The Strategist | 2150 | Catalan (supplied) | Pirc (supplied) | King's Indian, principles |
| Senior | The Tactician | 2250 | Catalan (supplied) | Pirc (supplied) | Grünfeld (supplied) |

The Elo values are target approximations for the bot's playing strength, not
FIDE or Chess.com ratings. Every character — and the General Bot — searches to
the same depth (`SEARCH_DEPTH = 16`, capped by the clock's movetime), so the
move on the board is a genuinely calculated one. Rating is expressed as the
chance of a deliberate mistake, plus the candidate-gap tolerance and evaluation
accuracy in `src/play/personality/styles.ts`. None of it changes a character's
tendencies.

`blunderChance` in `src/play/strength.ts` is an exponential decay anchored at
800 Elo (45%) with a 400-Elo e-folding: about 15% at 1250, 7% at 1550, 2% at 2050
and 0.9% at 2200 — roughly one mistake in 110 moves at the top of the ladder,
and none of them fabricated. When the roll fires, `chooseBlunder` picks a line
from Stockfish's own MultiPV list whose score is worse by a rating-capped amount
(700cp for a beginner, 200cp at 2200), never one that walks into mate.

Senior therefore steps up from Junior through the blunder curve, the tighter
60cp candidate gap (vs 70) and accuracy 2.2 (vs 2.05), not through a shallower
search. His aggression, risk and tactical tendencies are unchanged.

## Repertoire data

`src/play/personality/repertoires/*.ts` contains the declared SAN lines.
`book.ts` replays each line and registers only that character's moves under the
position they were made from, so shared stems, branches and transpositions
merge automatically, and a player deviation leaves the book immediately. Every
stored move is re-checked against legal move generation before it is offered.

The supplied material covers Freshman's Ruy Lopez, the Catalan and Pirc shared
by Sophomore/Junior/Senior, and Senior's Grünfeld. There is no King's Indian
PGN, and none is pretended to exist.

## King's Indian preferences (Sophomore and Junior)

`repertoires/kid.ts` is a preference layer, not a book. In a position that
still looks like a King's Indian (bot is Black, White opened 1.d4/1.c4 or
transposed, no ...d5, bishop still fianchetto-able), it states what the
structure wants:

1. ...Nf6
2. ...g6
3. ...Bg7
4. ...d6
5. ...O-O
6. then ...e5 against a broad centre, or ...c5 when White's c4 pawn is the
   target

Those are preferences, not a forced sequence. A move is offered only if it is
legal and does not give away more than the character's Elo allowance. A move
the engine's MultiPV list already contains is judged on that score; when the
top lines leave out a planned setup move (common for an early ...g6), the bot
evaluates the resulting position directly and still follows the plan only if
the change stays within a fixed allowance. If White's play makes the
structure inappropriate (early 1.e4, a ...d5 Queen's Gambit structure, a
committed bishop), the module returns nothing and ordinary personality
selection takes over. That keeps the Pirc assignment (1.e4) and the King's
Indian (1.d4) logically separate.

The two characters read the same structure differently:

- **Sophomore** may break with ...e5 or ...c5 before castling, prefers the more
  committal ...e5 even when the structure points at ...c5, accepts up to 60cp
  of engine disagreement for a break, and occasionally swings the f6 knight to
  h5 once ...e5 is fixed. This is the "may become overambitious" side of him.
- **Junior** completes the setup and castles first, follows the structurally
  correct break, and only plays it when the engine is within 20cp of its best.
  He never makes the h5 gesture unless ordinary evaluation independently
  chooses it.

Neither character reads Senior's Grünfeld lines.

## Opening priority: theory first

Every bot decides its opening in one order (`personality/opening.ts`):

1. **Prepared repertoire** — a legal move exists for this exact position in the
   character's book (or, for the General Bot, in the imported courses). It is
   played immediately; no search is spent and nothing overrides it.
2. **Principle-based system** — Sophomore/Junior against 1.d4 have no PGN, so
   the King's Indian preference plays the developed setup before ordinary engine
   play. It is treated as prepared theory, not as a fallback.
3. **Stockfish** — once no prepared move covers the position, the engine takes
   over and the game continues as normal engine chess.

The blunder roll is a midgame strength handicap, not an opening choice: while a
prepared move or King's Indian plan is available it is never taken. The position
is always searched first, and a fired roll costs one weaker engine line chosen
by `chooseBlunder` rather than an unpriced random legal move. That guarantee
lives in `shouldTakeBlunder` and is pinned by `tests/play/opening.test.ts`,
which also checks every declared line move is present in the book and that the
book reports "engine" once exhausted.

Moving away from the prepared line by the player ends the theory for that game,
by design; there is no fabricated continuation.

## Thinking pace

`personality/thinking.ts` returns a `deliberationMs` floor that applies to every
move, including a repertoire move and a position with one obvious best move. It
is 1.5–6s by phase, tension and character (Freshman shortest, Senior longest),
measured from the start of the bot's turn, and capped by the clock-safe budget so
a bot with seconds left still moves in time. The hook waits out the remainder of
that floor after the search or book lookup, which is why even a 16-ply prepared
line now looks like someone considering the position rather than a board refill.

## Dialogue and UI

`personality/dialogue.ts` holds four banks of short, human lines and the
cooldown rules; `personality/events.ts` turns engine facts into candidate
events. The opponent seat reserves one line (two on phones) so a remark cannot
move the board, and the end dialog always gets a closing line.

## USCF-classical strength (General Bot)

`play/humanStrength.ts` calibrates the Elo-rated bot to USCF classical standards
instead of shrinking the engine. There is no `UCI_Elo` anywhere: the position is
searched with `MultiPV 10`, and the move is chosen from those engine-assessed
lines by two continuous exponential curves over 400-2800 USCF.

With `s = (clamp(elo, 400, 2800) - 400) / 2400`:

- **Bad Move Index** `B = 0.04 + 0.64 * exp(-2.4s)` - how often the bot plays
  anything but its best move: 68% at 400, 46.9% at 800, 35.8% at 1100, 27.5% at
  1400, 18.3% at 1900, 9.8% at 2800. The curve is deliberately steep below 1500,
  where the old one let a club player pass for a tournament one.
- **Move Range Index** - how that error budget is split: blunders (`??`, 22%+
  win drop) `0.005 + 0.55 * exp(-4.2s)`, mistakes (`?`, 12-22%)
  `0.12 + 0.38 * exp(-1.9s)`, inaccuracies (`?!`, 5-12%) the rest, minimum 0.05;
  the three are normalized to sum to 1. At 1100 that is 49.5% / 33.8% / 16.7% of
  the errors, i.e. roughly 17.7% inaccuracies, 12.1% mistakes and 6% blunders
  per move.
- Depth `max(2, round(2 + 12 * s^1.3) + depthOffset)`: 2 at 400, 3 at 800, 4 at
  1100, 6 at 1400, 14 at 2800 - an 1100 USCF bot looks 4-5 plies ahead instead of
  the 7-8 that made it find 1600-level tactics. Temperature
  `max(0.20, 1.35 * exp(-1.7s))` is unchanged.

The probability is scaled by phase (opening `<= 8` moves x0.35, middlegame
x1.20, endgame x0.95) and time control (`classical` x1.0 / depth +0 / time x1,
`rapid` x1.18 / -1 / x0.55, `blitz` x1.45 / -2 / x0.25, `bullet` x1.80 / -3 /
x0.12). Under 30 seconds left with less than 5 seconds of increment the
probability is x1.5 again, the blunder share x1.6 (shares re-normalized), depth
stops at 3 and the turn is compressed to 250-850ms.

`planHumanSearch` decides depth, error budget and thinking time **before** the
search, so Stockfish really spends it on `go depth <d> movetime <t>`: forced
moves and recaptures 350-850ms x time scale (at least 250ms), quiet turns
1500-3800ms (one turn in seven at 1.5x), sharp turns with several captures and
checks 4500-10500ms, capped at 12% of the remaining clock so the bot never
flags.

`selectHumanBotMove` then applies, in order: a forced move immediately; a 93%
recapture bias from 550 Elo; one roll against `badMoveProb` - when it fires, a
second roll against the normalized shares picks the inaccuracy, mistake or
blunder bucket, candidates are matched by win drop (dropping mate-in-one
blunders from 1000 Elo up unless nothing else fits), and an empty bucket falls
back down the chain (blunder -> mistake -> inaccuracy -> the lowest-ranked line
in `MultiPV 10`, so a quiet position yields the worst move the engine saw rather
than the second-best one); otherwise only moves under a 5% win drop are
considered and weighted `exp(-cpLoss / (temperature * 120))`, with the #1 line's
weight multiplied by `0.35 + 0.65 * elo / 1500` below 1500 USCF (0.52 at 400,
0.83 at 1100, no damping from 1500 up), so a 2800 leans on the #1 move while a
sub-1500 bot drifts to its #2-#4 human choices instead of echoing Stockfish. Personality opponents keep their own style,
repertoire and thinking planner.

## Verification

`tests/play/repertoires.test.ts`, `kid.test.ts`, `personality.test.ts`,
`dialogue.test.ts`, `thinking.test.ts` and `humanStrength.test.ts` cover the
repertoire data, the King's Indian preference gates and style differences, move
selection, dialogue timing, the clock-aware thinking planner and the USCF
calibration (base profiles, phase and time-control scaling, time trouble,
thinking-time bands and the cap, forced moves, recaptures, the blunder and
mistake rolls, and the softmax/mate filter). Run `npm test`, `npx tsc -b`,
`npx oxlint` and `npm run build` after changes.
