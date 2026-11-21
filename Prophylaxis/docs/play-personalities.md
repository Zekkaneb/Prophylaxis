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

## Ladder bands

The Play screen lists the cards in five headed bands, in this order. Membership
is an explicit field on each profile, never a rating lookup: a card can sit
above its band's range by designation (Mabinti) or beside a stronger one in the
same band.

| Band | Range | Cards, in display order |
|---|---|---|
| Beginner | 100–1000 Elo | Emmanuel Domah, Edward Chen, Faadi Granillo Garcia |
| Novice | 1001–1300 Elo | Nina Yang (Freshman), Johnfer Quispe (Freshman), Alex Tang, Erik Wiessmann, Sophia Kuan (Senior) |
| Intermediate | 1301–1600 Elo | Bryan Martinez-Hernandez (Sophomore), Bryan Widjaja, Johnfer Quispe (Sophomore), Nina Yang (Sophomore), Brandon Tran (Freshman), Jonah Pachikara |
| Varsity | 1601–2000 Elo | Bryan Martinez-Hernandez (Junior), Johnfer Quispe (Senior), Brandon Tran (Sophomore) |
| The Big 4 | Special designation | Brandon Tran (Prime), Johnfer Quispe (Junior), Bryan Martinez-Hernandez (Prime), Mabinti Mansaray |

## Emmanuel Domah (Senior) — 150, Beginner

| | |
|---|---|
| id | `emmanuel` |
| Name / subtext | Emmanuel Domah · Senior |
| Rating | 150, Beginner band (100–1000) |
| Opening | none — no book, no theory, no bias |
| Profile file | `src/play/personality/styles.ts` (`emmanuel`) |
| Dialogue | `DIALOGUE_BANKS.emmanuel` in `src/play/personality/dialogue.ts` |
| Portrait | `public/opponents/emmanuel.webp` (monogram `ED` if missing) |

The reluctant player. He is not a beginner who is studying: he turned up, he
knows how the pieces move, and he is not going to pretend otherwise. Every dial
is low and none of them is a plan — positional and tactical awareness at 15,
king safety 35, material 45, active pieces 25 — so his taste barely outranks the
engine's evaluation of the position.

His strength is three strength dials, not a label:

- `depthCap: 6` — the shallowest search in the roster (the 800-rated beginner
  searches 10), so he sees a couple of moves and misses the reply.
- **accuracy at the floor** of the rating scale (0.85), which every profile
  below 1300 shares.
- `mistakeChance: 0.55` — a per-character override of the shared mistake curve,
  which floors at 45% for anything rated 800 or below. This is the dial that a
  rating alone could not express (`blunderChance(150)` is the same 0.45 as
  `blunderChance(800)`), and no other profile sets it, so every other opponent's
  mistake rate is unchanged.

His slips are still engine-priced moves from the MultiPV list, never random
legal moves: `chooseBlunder` keeps them inside the beginner severity and refuses
a line that walks into a forced mate. On a turn where no candidate is bad enough
to be a mistake, the roll simply produces nothing and he plays the ordinary
personality move — which is why he is not hanging a piece on every single move.

That is his **Watch Bots** path, where the personality selector chooses. In the
Play room the same 150 card is calibrated instead, so it runs the sub-200 tier:
65% blunder, 25% mistake, an 8-12 node budget and an off-list probe whenever the
rolled band is empty. Playing him is playing a beginner who loses pieces — the
voice still comes from the dialogue layer, the moves come from the tier.

**No repertoire.** He is deliberately absent from `PERSONALITY_REPERTOIRES`, so
`personalityBookFor('emmanuel', colour)` is empty from the first ply in both
colours, no `book`/`deviation` remark can fire from a prepared line, and
`openingBias` is empty. His 1st move and his 40th come from the same path.

Dialogue is triggered by the existing event layer and paced by `maybeReact`; his
cadence is deliberately slower than the default (`ordinaryGap: 8`, `repeatGap:
18`) because he is not a talker. Lines stay casual and understated in a lost
position as well as a won one, and none of them references a tactic, an
evaluation or a search.

## Mabinti Mansaray (Junior) — 1550, Strong

| | |
|---|---|
| id | `mabinti` |
| Name / subtext | Mabinti Mansaray · Junior |
| Rating | 1550, The Big 4 (special designation) |
| White | Queen's Gambit: 1.d4, 2.c4, normal development |
| Black vs 1.e4 | 1...e5, classical development (Ruy Lopez, Italian, Scotch) |
| Black vs 1.d4 | 1...d5, Queen's Gambit Declined / Semi-Slav set-up |
| Profile file | `src/play/personality/styles.ts` (`mabinti`) |
| Repertoire | `src/play/personality/repertoires/mabinti.ts` |
| Dialogue | `DIALOGUE_BANKS.mabinti` in `src/play/personality/dialogue.ts` |
| Portrait | `public/opponents/mabinti.webp` (monogram `MM` if missing) |

The enthusiast: balanced and principled. Positional understanding, defence,
king safety and material care all sit above the midpoint (70/65/75/65),
aggression and risk just below it (50/45), and complexity at 45 because she
would rather keep a position clean than sharp. No dial is a speciality and none
is a weakness. Strength is the rating's own: accuracy, the candidate-gap
tolerance and the blunder curve all come from 1550, and she is capped at the
standard search depth — she is not artificially weak in tactics or positional
play.

Her repertoire is deliberately short and ordinary, so the book runs out where a
1550's knowledge does and Stockfish plus her tendencies take over. Opening
familiarity is not a strength dial: outside her lines she improvises legally,
and a repertoire lookup can never produce an illegal move (`book.ts` re-checks
every stored move against legal move generation).

Dialogue is trigger-driven by the existing event layer (`events.ts`) and paced by
`maybeReact`: her cadence is slightly quicker than the default
(`ordinaryGap: 5`, `repeatGap: 12`) because she talks to the room, but the
never-repeat-a-line pool and the repeat gap still apply. Her voice is warmth and
punctuation, never phonetic spelling or an accent written into words, and no line
mentions an engine, an evaluation or a search.

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

## Bryan Widjaja (Prime) — 1400, Intermediate

| | |
|---|---|
| id | `bryan-widjaja` |
| Name / subtext | Bryan Widjaja · Prime |
| Rating | 1400, Intermediate band (1301–1600) |
| White | Queen's Gambit: 1.d4, 2.c4, sound development |
| Black vs 1.e4 | Caro-Kann: 1...c6, then 2...d5 (Classical, Advance, Exchange) |
| Black vs 1.d4 | King's Indian set-up: ...Nf6, ...g6, ...Bg7, ...d6, ...O-O, then ...e5 or ...c5 |
| Profile file | `src/play/personality/styles.ts` (`bryan-widjaja`) |
| Repertoire | `src/play/personality/repertoires/bryanWidjaja.ts` |
| Dialogue | `DIALOGUE_BANKS['bryan-widjaja']` in `src/play/personality/dialogue.ts` |
| Portrait | `public/opponents/bryan-widjaja.webp` (monogram `BW` if missing) |

The Wall: the defensive speciality of the roster. Defensive and king safety are
the maximum dial values (98/98), material care 90, simplification 80 and
positional 75; aggression (30), risk (20), initiative (40) and complexity (25)
are all low, so he steers towards stable structures, sensible exchanges and a
safe king. `sacrifice` is 10 and the opening bias favours solid, positional,
developing tags while penalising sharp and initiative ones. "Prime" here is the
card subtext, not a strength group — he is an Intermediate card at 1400.

Defence is a selection preference, not accuracy. His strength dials come from
1400 exactly as they do for any other profile: `accuracyForElo(1400)` = 1.05,
`candidateGapForElo(1400)` = 115, the standard search depth and the standard
blunder curve (about 15% at 1250, 7% at 1550). Tactical awareness is 35, below
the other cards at his rating, so complicated forcing lines are still missed at
the rate a 1400 misses them.

One small per-character guard keeps the defence honest rather than strong: when
the blunder roll fires, `bryanWidjajaAllowsMistake` in
`src/play/personality/bryanWidjaja.ts` rejects a deliberate slip that is a
blatant material blunder or allows mate in one, following the existing
`faadiAllowsMistake` / `edwardAllowsMistake` pattern. He still slips; he does not
throw a piece or walk into mate on purpose. The guard is wired into both blunder
paths (`chooseMove.ts` and `usePlayGame.ts`) and touches no other profile or
engine setting.

The repertoire is short and ordinary. White plays the Queen's Gambit (main,
Exchange and a Slav-style set-up); Black answers 1.e4 with the Caro-Kann in its
Classical, Advance and Exchange forms; against 1.d4 he registers in the shared
King's Indian layer (`repertoires/kid.ts`) as a patient builder — set-up and
castling first, and a break only when the engine is clearly behind it
(`breakTolerance: 40`). That layer is a preference, not a script: it declines
after 1.e4 or when the structure is wrong, and ordinary Stockfish selection takes
over. Book lookups are always re-checked for legality.

Dialogue is event-driven by `events.ts` and paced by `maybeReact` with a reserved
cadence (`ordinaryGap: 8`, `repeatGap: 18`): short, chill, understated lines,
never a narrated tactic, an evaluation or a number, and never a cue to the move
chooser. The never-repeat-a-line pool and the once-per-game events still apply.

## Alex Tang (Sophomore) — 1100, Novice

| | |
|---|---|
| id | `alex-tang` |
| Name / subtext | Alex Tang · Sophomore |
| Rating | 1100, Novice band (1001–1300) |
| White | London System: 1.d4, ...Bf4, ...e3, ...Nf3/...Nbd2, ...c3, kingside castling |
| Black vs 1.e4 | No assigned repertoire: the book is empty and principled selection plays a legal move |
| Black vs 1.d4 | King's Indian setup: ...Nf6, ...g6, ...Bg7, ...d6, ...O-O, then ...e5 or ...c5 |
| Profile file | `src/play/personality/styles.ts` (`alex-tang`) |
| Repertoire | `src/play/personality/repertoires/alexTang.ts` |
| Dialogue | `DIALOGUE_BANKS['alex-tang']` in `src/play/personality/dialogue.ts` |
| Portrait | `public/opponents/alex-tang.webp` (monogram `AT` if missing) |

The energetic goofball: a straightforward beginner's table — aggression 35,
risk 30, positional 45, tactical 40, defensive 50, initiative 40,
simplification 60, complexity 30, king safety 65, material 70. Nothing is maxed
and nothing is a speciality; he develops, takes the centre and castles when he
can. The humour lives in the dialogue only: `risk` and `complexity` stay low, so
being funny never becomes a chaotic move.

Strength is the rating's: `accuracyForElo(1100)` = 0.85,`candidateGapForElo(1100)`
is wider than a 1400's, the standard search depth is used (no `depthCap`, no
`mistakeChance`), and the ordinary slip curve gives a 1100 more realistic
mistakes than a 1550. He keeps his own thinking factors (a quick, interested
look, slightly longer in a sharp position) and his own cadence
(`ordinaryGap: 4`, `repeatGap: 11`), so he talks often without looping a
catchphrase.

White plays the London System only: 1.d4, ...Bf4 outside the pawn chain, ...e3
and ...c3 supporting the centre, knights on f3/d2, kingside castling, in three
short lines. Black against 1.d4 registers in the shared King's Indian layer
(`repertoires/kid.ts`) as a patient builder — setup and castling first, break
later. Against 1.e4 there is deliberately no repertoire: the book is empty, so
ordinary principled selection answers with a legal, sensible move. Book moves are
always re-checked for legality, and outside his lines he improvises normally.

## Erik Wiessmann (Teacher) — 1100, Novice

| | |
|---|---|
| id | `erik-wiessmann` |
| Name / subtext | Erik Wiessmann · Teacher |
| Rating | 1100, Novice band (1001–1300) |
| White | 1.e4, then principled development (Italian, Open Sicilian, French) |
| Black vs 1.e4 | 1...e5 (Italian, Ruy Lopez, Scotch responses) |
| Black vs 1.d4 | 1...d5 (Tarrasch, Slav, and a ...d5 answer to the London) |
| Profile file | `src/play/personality/styles.ts` (`erik-wiessmann`) |
| Repertoire | `src/play/personality/repertoires/erikWiessmann.ts` |
| Dialogue | `DIALOGUE_BANKS['erik-wiessmann']` in `src/play/personality/dialogue.ts` |
| Portrait | `public/opponents/erik-wiessmann.webp` (monogram `EW` if missing) |

The chill logician: the most principled table on the roster. Positional 75,
king safety 75 and material 75 all point at sound, purposeful moves; aggression
35, risk 25, complexity 25 and initiative 40 keep him away from speculation, and
sacrifice is 10 — nothing is given without a concrete reason. The opening bias
favours developing, solid and positional tags and penalises sharp ones.

That is all taste. Strength still comes from the 1100 rating:
`accuracyForElo(1100)` = 0.85, the same candidate gap as any other 1100, the
standard search depth (no `depthCap`, no `mistakeChance`) and the ordinary slip
curve — a logical personality does not calculate better than its rating.

White opens 1.e4 with three short, principled lines (Italian, Open Sicilian,
French), Black answers 1.e4 with 1...e5 (Italian, Ruy Lopez, Scotch) and 1.d4
with 1...d5 (Tarrasch, Slav, London reply). No King's Indian layer and no
theoretical branches: `kid.ts` declines for his id, and outside the book the
ordinary engine choice plus his tendencies take over. Every book move is
re-checked for legality.

Dialogue is event-driven through the existing layer with a reserved cadence
(`ordinaryGap: 7`, `repeatGap: 16`): relaxed, friendly and quietly competitive,
with no lecturing, no digits and no engine or theory vocabulary. The
never-repeat-a-line pool and the once-per-game events still apply.

## Jonah Pachikara — 1400, Intermediate

| | |
|---|---|
| id | `jonah-pachikara` |
| Name / subtext | Jonah Pachikara · *(none specified)* |
| Rating | 1400, Intermediate band (1301–1600) |
| White | Jobava London (1.d4, Bf4, Nc3, e3) |
| Black vs 1.e4 | 1...d5, Scandinavian (...Qa5, ...Qd8 and the ...Nf6 recapture) |
| Black vs 1.d4 | 1...d5, Queen's Gambit Declined structure |
| Profile file | `src/play/personality/styles.ts` (`jonah-pachikara`) |
| Repertoire | `src/play/personality/repertoires/jonahPachikara.ts` |
| Dialogue | `DIALOGUE_BANKS['jonah-pachikara']` in `src/play/personality/dialogue.ts` |
| Portrait | `public/opponents/jonah-pachikara.webp` (monogram `JP` if missing) |

No subtext has been specified for him, so he follows the convention used by the
General Bot: no `title`, and a `shortName` already contained in the name, which
makes `opponentStage` return `null`. The card prints the name and `1400 Elo`
alone, PGN headers carry `Jonah Pachikara`, and no school-year label is invented.

The silent threat. Positional 90 and tactical 85 are the whole character:
improving, quiet moves that keep the pieces working, and the same profile makes
him notice the tactics that appear once the placement is right. Defence 75, king
safety 80, simplification 60 and sacrifice 20 keep him from speculative attacks,
and aggression stays at 55 — he pressures, he does not blitz.

None of that changes his strength. `accuracyForElo(1400)` = 1.05, the standard
1400 candidate gap and the ordinary slip curve (no `depthCap`, no
`mistakeChance`): high tactical ambition means he looks at tactical candidates
more often, not that he calculates like a master.

White plays the Jobava London in three short lines: 1.d4, bishop to f4, knight
to c3, e3, then a solid centre and quiet pressure. Black answers 1.e4 with the
Scandinavian 1...d5 — the ...Qa5 main line with the long castle, the ...Qd8
version and the ...Nf6 recapture — and 1.d4 with 1...d5 into a Queen's Gambit
Declined structure, plus a calm answer to the London. No King's Indian layer.
Outside the book the ordinary engine choice and his tendencies take over.

Dialogue is event-driven with `ordinaryGap: 6`, `repeatGap: 15`: understated,
casual, occasionally dry ("Oh, okay.", "That's interesting.", "I think there's
something here."), level in won and lost games, and free of theory or engine
talk. The anti-repetition pool and once-per-game events apply.

## Sophia Kuan (Senior) — 1300, Novice

| | |
|---|---|
| id | `sophia-kuan` |
| Name / subtext | Sophia Kuan · Senior |
| Rating | 1300, Novice band (1001–1300) |
| White | Vienna Game, the quiet set-up (1.e4, Nc3, Bc4 or Bg2, d3, O-O) |
| Black vs 1.e4 | 1...e6, French (Rubinstein/trade line, Tarrasch, Advance, Exchange) |
| Black vs 1.d4 | 1...d5, a sound Queen's Gambit Declined set-up |
| Profile file | `src/play/personality/styles.ts` (`sophia-kuan`) |
| Repertoire | `src/play/personality/repertoires/sophiaKuan.ts` |
| Dialogue | `DIALOGUE_BANKS['sophia-kuan']` in `src/play/personality/dialogue.ts` |
| Portrait | `public/opponents/sophia-kuan.webp` (monogram `SK` if missing) |

The gentle defender. Simplification 95 is her signature: the engine's trade
term weighs heavily, so among near-equal moves she takes the one that reduces
the position, and defence 85 with king safety 90 and material 90 keeps her
sound. Aggression 20, risk 15, complexity 10 and sacrifice 8 mean she never
sharpens for its own sake or speculates with material.

That taste never becomes strength: `accuracyForElo(1300)` is the dial, with the
standard 1300 candidate gap and slip curve (no `depthCap`, no `mistakeChance`).
A trade that loses material, a clearly better quiet move, or a winning capture
all still outrank taste, so she is not a blind exchanger.

White plays the Vienna quietly — 1.e4, 2.Nc3, the bishop to c4 or g2, d3,
development and castling. No Vienna Gambit and no premature f4, either in the
book or outside it. Black meets 1.e4 with 1...e6: the Rubinstein line trades in
the centre early, the Tarrasch keeps a compact structure, and the Advance and
Exchange lines meet White's space calmly. Black meets 1.d4 with 1...d5 into a
sound Queen's Gambit Declined set-up, plus a calm answer to the London. No
King's Indian layer; outside the book, engine choice plus her tendencies play.

Dialogue is event-driven with `ordinaryGap: 7`, `repeatGap: 16`: soft-spoken,
hesitant and exceptionally kind ("Oh, okay.", "I think that's alright.", "Maybe
I should trade here.", "I hope this works."), polite in won and lost games and
never taunting. The anti-repetition pool and once-per-game events apply.

## Brandon Tran (Sophomore) — 1850, Varsity

| | |
|---|---|
| id | `brandon-varsity` |
| Name / subtext | Brandon Tran · Sophomore |
| Rating | 1850, Varsity band (1601–2200) |
| White | Vienna Game, the sharp one (Vienna Gambit 3.f4; Bc4/Ng5) |
| Black vs 1.e4 | 1...e6, French (Winawer, open Tarrasch, Advance) |
| Black vs 1.d4 | 1...d5 (Queen's Gambit Accepted) — no Grünfeld |
| Profile file | `src/play/personality/styles.ts` (`brandon-varsity`) |
| Repertoire | `src/play/personality/repertoires/brandonVarsity.ts` |
| Dialogue | shared immutable `BANKS.brandon` |
| Portrait | `public/opponents/brandon-varsity.webp` (monogram `BT` if missing) |

The third Brandon: the Freshman's voice and appetite for a fight, developed.
Aggression 90 and initiative 90 stay, complexity drops slightly to 85, but
positional 65 (against 40), tactical 85 (against 75), defence 45 (against 35) and
material 40 (against 30) make him a real Varsity player. He is not the Prime:
95 aggression, 98 tactical and 100 complexity stay Prime's, and his sacrifice
appetite (88) sits between Freshman's 80 and Prime's 95.

Strength is the rating dial: `accuracyForElo(1850)`, with the gap and slip curve
of a 1850 — smaller than the Freshman's, larger than the Prime's. No extra depth
cap or mistake chance was added to either version.

White plays the sharp Vienna: the Vienna Gambit with 3.f4 (`...d5 fxe5 Nxe4 Qf3`),
the `...exf4` branch, and a Bc4/Ng5 line when the gambit is not on. Black meets
1.e4 with 1...e6 and counterattacks — the Winawer with `...Bb4 ...c5 ...Bxc3+`,
the open Tarrasch with `...c5` and `exd5`, and an active Advance — and 1.d4 with
1...d5 into a Queen's Gambit Accepted. Deliberately no Grünfeld: that belongs to
Prime, and his book never offers it.

The voice is literally the other Brandons': `DIALOGUE_BANKS['brandon-varsity']`
is `BANKS.brandon`, the same immutable data the Freshman and Prime use, with the
ordinary event/cooldown/repeat machinery and the default cadence. Only the chess
configuration is independent.

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

- **Blunder** (`??`, 20%+ win drop) `0.46 * exp(-5.8 * s^1.15)`, off at 2100
- **Mistake** (`?`, 10-20%) `0.34 * exp(-3.4s)`, off at 2400
- **Inaccuracy** (`?!`, 5-10%)
  `0.02 + 0.25 * sin(pi * s^0.72) * exp(-0.45s)`
- **Good** (`✓`, 2-5%) `0.05 + 0.33 * sin(pi * s^0.85)`
- **Excellent** (`⦿`, under 2%, non-#1) `0.02 + 0.34 * s^1.05`
- **Best** (`*`, the #1 move only) `max(0.01, 1 - the other five)`

**Below 400 USCF** a share of turns is not model play at all:
`randomMoveChance(elo) = ((400 - elo) / 300) ^ 1.8` - 100% at 100 USCF, ~48% at
200, ~14% at 300 and 0 from 400 up. On that roll `selectHumanBotMove` ignores
the candidates, the reference pass and the bucket model entirely and plays a
uniformly random legal move. The turn is booked at the blunder floor
(`RANDOM_MOVE_WIN_DROP` 20) rather than at 0, so accuracy accounting cannot read
a random legal move as if it were the engine's first choice.

**Below 200 USCF** the curves are replaced by one tier rather than interpolated
between them: `BOTTOM_TIER_SHARES` rolls 65% blunder, 25% mistake and under 10%
for everything else (`inaccuracy` 4, `good` 4, `excellent` 1.5, `best` 0.5), and
that tier is not scaled again. A sub-200 bot also gets an 8-12 node budget
(`beginnerNodeCap`, 8 at 100 and 12 at 200), less than a single complete look at
the board, so a one-move threat and the recapture are both invisible. When the
rolled band has no usable member it always probes off-list (`probeErrorMove`),
and below 200 the probe returns its worst-scoring legal move even when the
reference calls it only slightly worse - a piece dropped for nothing, or a pawn
pushed for no reason.

The six sum to 1 at every rating, and the names double as the **vision window**.
After the depth-9 reference pass, `classifyCandidate` puts the engine's #1 move
alone in `best` and buckets every other candidate by its win drop (`excellent`
under 2, `good` 2-5, `inaccuracy` 5-10, `mistake` 10-20, `blunder` 20+), so a
strong bot's mistakes are limited to what its own window can still see.
`getBucketWeights` decides how often each bucket is asked for, and the severe
ends close: blunders leave the distribution entirely at 2100 USCF and mistakes at
2400, their mass re-normalized into the other buckets rather than played.

Phase and time control only scale the three error buckets; the displaced mass
moves proportionally into good, excellent and best and the six are re-normalized,
so a fast game makes the same player worse rather than differently rated. At 100
USCF every turn is a random legal move, so the tier's weights never get to
fire; at 200 the tier blunders 65% of the time and errs on 94% of the turns the
random roll misses, and about half of all turns are random anyway; at 300 it is
back on the smooth curve (34% blunders, 74% overall); at 700 it is 16% blunders and
54% overall; at 1800, 1.5% blunders and 22% overall; at 2800 it has no blunder or
mistake bucket left at all.

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
3 up to 1000, so a 700 frequently misses a two-move tactic. Below 200 the node
budget itself is 8-12 nodes, which is not even one complete ply of Stockfish's
node accounting. Temperature
`max(0.20, 1.35 * exp(-1.7s))`.

Inside a quality bucket below 1000 USCF the leading line's softmax weight is
multiplied by 0.08 and the runner-up by 0.25 (`suppressTopLines`), so a beginner's
good and excellent choices spread across its plausible moves instead of echoing
the engine's ranking. The `best` bucket holds a single move, so a beginner only
reaches the top line on a `best` roll.

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
six quality probabilities. The roll names a bucket, and the buckets are filled
from the depth-9 reference pass; a bucket that is empty on this board steps
inward toward the rating's median bucket before it may fall to `best`
(`bucketFallbackChain`), so a missing band never forces an unnatural move. Error
bucket candidates are then filtered by **intent**, which is what removed the
alien rank-32 blunders:

- from 1000 USCF up a **free hang** is never played as an error. `freeHangAfter`
  refuses a move that leaves a queen, rook, bishop or knight attacked with
  nothing defending it, so a blunder roll in a calm position cannot be spent on
  a piece dropped in the middle of nowhere. The escapes are answering a check,
  giving check (a forcing sacrifice), and a piece that was already loose before
  the move. A piece something defends is an exchange rather than a free hang,
  which is exactly the 800-1200 error: taking material while walking into a pin,
  a fork or a trap;
- below 1000 USCF (beginner blindness) any other candidate in the band is
  allowed - a step onto an attacked square, a missed recapture, an unprovoked
  piece drop - and an empty band asks the caller to probe off-list moves;
- 1000-1500 (tactical tunnel vision) allows only a greedy capture that loses
  material (18%+), a check or forward attack, a pawn pushed at the king, an
  ambitious queen sortie, a move into contested central tension, or one of the
  first six shallow (`depth 3`) lines;

Under 1500 USCF a `mistake` or `blunder` roll with no usable member is filled
from **off the list** - a bucket that is empty, or one whose every move the
rating's intent filter will not allow. The engine's MultiPV lines are all
playable in a quiet position - a typical 700 sees only three or four - so the
rolled band often has nothing to spend the roll on and would otherwise fall into
`good`. `probeErrorMove` scores a handful of
plausible legal moves at depth 8 against the depth-9 reference and keeps the
first that lands in the band (10-20 or 20-45 percentage points). From 1000 up
the probe only offers moves with a human point (`requireIntent`); below it the
bot may simply hang something. The probe is a move the caller has to allow, and
`usePlayGame` falls back to the milder buckets when it finds nothing.
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
