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
lines by a six-bucket **move-quality distribution** over 100-2800 USCF.

With `s = (clamp(elo, 100, 2800) - 100) / 2700`:

- **Blunder** (`??`, 20%+ win drop) `0.0005 + 0.56 * exp(-5.4 * s^1.15)`
- **Mistake** (`?`, 10-20%) `0.008 + 0.28 * exp(-3.1s)`
- **Inaccuracy** (`?!`, 4.5-10%)
  `0.035 + 0.21 * sin(pi * s^0.75) * exp(-0.6s)`
- **Good** (`✓`, 1.8-4.5%) `0.06 + 0.34 * sin(pi * s^0.85)`
- **Excellent** (`⦿`, 0.4-1.8%) `0.03 + 0.30 * s^0.9`
- **Best** (`*`, under 0.4%) `max(0.01, 1 - the other five)`

The six sum to 1 at every rating. Phase and time control only scale the three
error buckets; the displaced mass moves proportionally into good, excellent and
best and the six are re-normalized, so a fast game makes the same player worse
rather than differently rated. At 100 USCF a bot blunders 56% of the time; at
2800 it is under 1%.

Below 1000 USCF the beginner curves add error mass on top of that: the three
error buckets grow by up to 1.5x toward the floor and the blunder share by up to
2x below 900, fading to nothing at each boundary (`beginnerScaling`). A 700 bot
is then suboptimal on ~58% of turns with 20-25% outright blunders; a 300 bot
blunders roughly half the time.

Recapture awareness is one monotone curve,
`0.50 + 0.49 * (1 - exp(-4.2 * s^0.55))`: 50% at 100 USCF, ~85% at 400, ~91% at
700, ~94% at 1000 and ~98% at the top. A direct equal trade is therefore almost
always taken back from 400 up, and the ~1-in-10 the curve leaves open is the
hidden defender or the intermediate move. The curve depends on the *trade*,
classified by `recaptureTrade`: a **costly** recapture (winning back less than
was just lost, such as a queen retaking a pawn) keeps only
`COSTLY_RECAPTURE_SHARE` (45%) of that chance - the trade a weaker bot really
does miscalculate - while a favourable recapture (their queen took our pawn) is
automatic.

Depth `max(2, round(2 + 12 * s^1.3) + depthOffset)`: 5 at 1100, 14 at 2800. The
sub-1000 node cap is a depth cap in this engine path: 2 plies below 500 USCF and
3 up to 1000, so a 700 frequently misses a two-move tactic. Temperature
`max(0.20, 1.35 * exp(-1.7s))`.

On normal (non-error) turns below 1000 USCF the softmax weight of the #1 engine
move is multiplied by 0.08 and the #2 by 0.25 (`suppressTopLines`), so a beginner
plays a plausible, slightly loose move instead of echoing Stockfish.

Every game also rolls a **phase proficiency profile** (`rollPhaseProfile`): one
level per phase, from 1 (Weak / Sloppy, -200 Elo, errors x1.35) to 5 (Peak /
Sharp, +175, errors x0.68), with 2, 3 and 4 at -100 / 0 / +100 and 1.15 / 1.00 /
0.82. Under 1600 Elo the three phases are three different levels; from 1600 up
matching phases are allowed, drawn with weights 5 / 15 / 30 / 30 / 20 so Level 1
stays at or under 5%. At or below 1400 a second Level 1 is replaced by Level 3,
so a bot never collapses in two phases at once. Positive boosts are capped at
`min(180, 25% of the card rating)`: a 700 bot's peak phase is 875, not 1500.

`usePlayGame` rolls the profile once per game id and plays each phase at
`getEffectivePhaseElo`, which feeds the six-bucket distribution, the depth, the
recapture curve and the tunnel-vision filter. In DEV the roll is logged as
`[play] bot phase profile O: L4 (800) | M: L1 (500) | E: L5 (875)`.

The error rate is scaled by phase (opening `<= 8` moves x0.70 below 1400 USCF
and x0.40 above, middlegame x1.20, endgame x0.95) and time control (`classical`
x1.0 / depth +0 / time x1, `rapid` x1.18 / -1 / x0.55, `blitz` x1.45 / -2 /
x0.25, `bullet` x1.80 / -3 / x0.12). Under 30 seconds left with less than 5
seconds of increment the error buckets are x1.4 again, depth stops at 3 and the
turn is compressed to 250-850ms.

`planHumanSearch` decides depth, error budget and thinking time **before** the
search, so Stockfish really spends it on `go depth <d> movetime <t>`: forced
moves and recaptures 350-850ms x time scale (at least 250ms), quiet turns
1500-3800ms (one turn in seven at 1.5x), sharp turns with several captures and
checks 4500-10500ms, capped at 12% of the remaining clock so the bot never
flags.

`selectHumanBotMove` applies, in order: a forced move immediately; a recapture
at the rating's own rate for the trade it actually is; then one roll against the
six quality probabilities. The matching candidates are filtered by **intent**,
which is what removed the alien rank-32 blunders:

- from 400 USCF up a **free hang** is never played as an error. `freeHangAfter`
  refuses a move that leaves a queen, rook, bishop or knight attacked with
  nothing defending it, so a blunder roll in a calm position cannot be spent on
  a piece dropped in the middle of nowhere. The escapes are answering a check,
  giving check (a forcing sacrifice), and a piece that was already loose before
  the move. A piece something defends is an exchange rather than a free hang,
  which is exactly the 800-1200 error: taking material while walking into a pin,
  a fork or a trap;
- below 600 USCF (beginner blindness) any other candidate in the band is
  allowed - a step onto an attacked square, a missed recapture - and an empty
  band can ask the caller to probe off-list moves;
- 600-1500 (tactical tunnel vision) allows only a greedy capture that loses
  material (18%+), a check or forward attack, a pawn pushed at the king, an
  ambitious queen sortie, a move into contested central tension, or one of the
  first six shallow (`depth 3`) lines;
- 1500+ (deep calculation slip) allows only one of the first four shallow lines
  that the depth-9 reference pass refutes.

Inside an error band the weights are multiplied by a temptation factor before
being re-normalized: x2.4 for a capture or a check, x1.5 for a heavy attack, a
queen sortie or central tension, x0.35 for a quiet unforced move. A blunder roll
in a calm position therefore lands on an active mistake - a premature pawn push,
an aggressive queen sortie, a miscalculated exchange - rather than a dull piece
drop.

An empty band falls to the milder ones (blunder -> mistake -> inaccuracy -> good
-> excellent -> best) instead of forcing a bizarre move; if no band has anything
the candidate nearest the rolled band's centre wins, skipping free hangs. The
off-list probe (`probeErrorMove`) is only offered below 600 USCF; from 400 up it
skips free hangs and orders candidates by `temptationRank` - captures and checks
first, central tension next, quiet edge pawns last - so a band is filled by a
tempting miss rather than a random `a2a3`. Picks are weighted
`exp(-cpLoss / (temperature * 120))`, the #1 line is damped below 1500 USCF
(`0.35 + 0.65 * elo / 1500`), and a move allowing mate in one is refused from
1000 Elo up.

Personalities keep their own style, repertoire and thinking planner, but their
theory is capped by rating in `usePlayGame`: 4 plies up to 1000 USCF, 6 up to
1500, 8 up to 2000 and 12 above, with the early book-exit roll retained below
1600 (one move in five).

## Verification

`tests/play/repertoires.test.ts`, `kid.test.ts`, `personality.test.ts`,
`dialogue.test.ts`, `thinking.test.ts` and `humanStrength.test.ts` cover the
repertoire data, the King's Indian preference gates and style differences, move
selection, dialogue timing, the clock-aware thinking planner and the USCF
calibration (base profiles, phase and time-control scaling, time trouble,
thinking-time bands and the cap, forced moves, recaptures, the blunder and
mistake rolls, and the softmax/mate filter). Run `npm test`, `npx tsc -b`,
`npx oxlint` and `npm run build` after changes.
