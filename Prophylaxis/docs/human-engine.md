# The human-mimicking engine (100–2800 USCF)

What the calibrated play path actually does, end to end. Every number below was
read from the source or produced by calling the real functions — none of it is
aspirational. Where behaviour differs from the design brief it is called out in
[§8](#8-spec-vs-code-synchronisation).

The pipeline lives in two files:

| Concern | File |
| --- | --- |
| Calibration, buckets, weights, probing, selection | `src/play/humanStrength.ts` |
| Game analysis, classification, accuracy | `src/review/gameReviewService.ts` |
| Wiring (search, reference pass, probe call, clocks) | `src/play/usePlayGame.ts` |
| Wiring for bot-vs-bot | `src/play/personality/chooseMove.ts` |

---

## 1. The pipeline

```
elo ──► clampElo / skillOf ──► humanCalibration
                                   ├── quality shares (six buckets)
                                   ├── depth, temperature, error rate
                                   └── phase profile (opening/middlegame/endgame)

position ──► shallow search (depth 3, MultiPV 6)
              └──► main search (tier depth, MultiPV 10, tier node cap)
                     └──► reference pass (depth 9, one line per PV move)
                            └──► winProb → winDrop → bucketCandidates
                                   └──► random roll (quality shares)
                                          └──► pick inside the rolled bucket
                                                 └──► probe if the bucket is empty
```

`sub-400 random floor` runs **before** any of this: it replaces the whole
selection with a uniform legal move.

Personality bots (`style !== null`) do not take the reference pass — their
candidates are scored by `choosePersonalityMove` — so the six-bucket model and
the depth-9 reference described here are the **General Bot / calibrated** path.

---

## 2. The sub-400 random floor

`randomMoveChance(elo)` — `src/play/humanStrength.ts`:

```ts
const target = clampElo(elo);
if (target >= 400) return 0;
return Math.pow((400 - target) / (400 - ELO_MIN), 1.8); // ELO_MIN = 100
```

| Elo | Chance of a pure random legal move |
| --- | --- |
| 100 | **1.000** (every move) |
| 200 | **0.482** |
| 300 | **0.138** |
| 400+ | 0.000 |

Measured with the real function (`randomMoveChance`), matching the design
curve exactly. When the roll succeeds the selector takes
`legalMoves()` and picks uniformly: no reference pass, no bucket, no intent
filter, booked at `RANDOM_MOVE_WIN_DROP = 20` (the blunder floor) so accuracy
accounting cannot read a random move as an engine first choice.

`usesOpeningBook(elo)` is `randomMoveChance(elo) === 0`, so 100–399 also has no
opening book (see `docs/play-personalities.md`).

---

## 3. The six buckets

`SELECTION_BANDS` in `humanStrength.ts` and `WIN_THRESHOLDS` in
`gameReviewService.ts` hold the same numbers, so a move the bot chose as an
Excellent is graded an Excellent in review.

| Bucket | Label | Win drop | Constant |
| --- | --- | --- | --- |
| `best` | `*` | the #1 reference move (win drop 0) | identity test |
| `excellent` | `⦿` | `0 < drop < 2.0` | `SELECTION_BANDS.excellent = 2.0` / `WIN_THRESHOLDS.good = 2` |
| `good` | `✓` | `2.0 ≤ drop < 5.0` | `good = 5.0` / `inaccuracy = 5` |
| `inaccuracy` | `?!` | `5.0 ≤ drop < 10.0` | `inaccuracy = 10.0` / `mistake = 10` |
| `mistake` | `?` | `10.0 ≤ drop < 20.0` | `mistake = 20.0` / `blunder = 20` |
| `blunder` | `??` | `drop ≥ 20.0` | `SELECTION_BANDS.mistake = 20.0` |

- **Best is an identity, not a band.** `classifyCandidate(winDrop, top)` marks
  `top` — the candidate with the lowest win drop — as `best`, and `winDrop` is
  computed against the reference-best score, so that candidate's drop is exactly
  `0`. Review applies the stricter version: `isTopEngineMove` compares the UCI
  with the engine's own first line, so a #2 move with a 0.1% gap is an
  Excellent. Both agree with the rule "Best means #1".
- `bucketCandidates` groups the scored candidates in one pass.

### Measured distributions

Produced by calling `getBucketWeights` and `humanCalibration` directly
(percentages).

| Elo | random | blunder | mistake | inaccuracy | good | excellent | best | depth | error rate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | 100% | 65.0 | 25.0 | 4.0 | 4.0 | 1.5 | 0.5 | 2 | 94% |
| 200 | 48% | 65.0 | 25.0 | 4.0 | 4.0 | 1.5 | 0.5 | 2 | 94% |
| 300 | 14% | 34.4 | 26.4 | 13.2 | 16.1 | 4.2 | 5.6 | 2 | 74% |
| 400 | 0 | 28.9 | 23.3 | 16.3 | 20.4 | 5.4 | 5.7 | 2 | 69% |
| 600 | 0 | 20.0 | 18.1 | 20.5 | 27.5 | 7.8 | 6.2 | 3 | 59% |
| 800 | 0 | 13.5 | 14.1 | 22.6 | 32.7 | 10.2 | 6.8 | 3 | 50% |
| 1000 | 0 | 8.9 | 10.9 | 23.3 | 36.2 | 12.7 | 8.0 | 5 | 43% |
| 1200 | 0 | 5.8 | 8.5 | 22.8 | 37.8 | 15.2 | 9.8 | 6 | 37% |
| 1500 | 0 | 3.0 | 5.8 | 20.3 | 37.2 | 19.1 | 14.6 | 7 | 29% |
| 1800 | 0 | 1.5 | 4.0 | 16.6 | 33.1 | 22.9 | 21.8 | 9 | 22% |
| 2100 | 0 | 0 | 2.7 | 12.3 | 26.4 | 26.8 | 31.7 | 10 | 15% |
| 2400 | 0 | 0 | 0 | 7.7 | 17.9 | 30.7 | 43.7 | 12 | 8% |
| 2800 | 0 | 0 | 0 | 2.0 | 5.0 | 36.0 | 57.0 | 14 | 2% |

`BOTTOM_TIER_ELO = 200` replaces the fitted curves with a fixed
`BOTTOM_TIER_SHARES` (65 / 25 / 4 / 4 / 1.5 / 0.5) rather than interpolating;
`BUCKET_GATES = { blunder: 2100, mistake: 2400 }` removes those buckets
entirely and re-normalises their mass into the quality buckets.

`scaleErrors(shares, multiplier)` grows/shrinks the three error buckets and
moves the difference in and out of good/excellent/best proportionally — used
for phase, time control and "trouble" offsets.

---

## 4. Vision, depth and node budgets

| Knob | Value | Effect |
| --- | --- | --- |
| `HUMAN_MULTI_PV` | 10 | main search lines |
| `SHALLOW_DEPTH` / `SHALLOW_MULTI_PV` | 3 / 6 | "what does this look like" pass |
| `REFERENCE_DEPTH` | 9 | pass 2, one line per PV move |
| `PROBE_DEPTH` | 8 | scoring an off-list probe move |
| `PROBE_MULTI_PV` | 32 | wide tail that supplies probe candidates |
| `PROBE_ELO` | 1500 | probing is available below this |
| `BEGINNER_NODE_FLOOR` / `_PER_ELO` | 12 + 0.055·(elo−100) | beginner node cap; 8–12 below 200 |
| `HANG_GUARD_ELO` | 1000 | from here a free hang is never a rolled error |
| `TUNNEL_VISION_ELO` | 1000 | from here an error needs human intent |
| `SELF_MATE_GUARD_ELO` | 1000 | mate in one is never played |
| `BEGINNER_ELO` | 600 | beginner curves / spread probe pool |
| `DEEP_SLIP_ELO` | 1500 | slips must survive the deep calculation |

The search depth in the table above is `humanSearchDepth(elo)` before the
time-control offset; `humanCalibration` exposes it as `depth`.

---

## 5. Bucket-empty behaviour and off-list probing

`bucketFallbackChain(rolled, median)` steps **inward toward the rating's median
bucket and then toward best**, never outward:

- `excellent → good → best`
- `blunder → mistake → inaccuracy → good → excellent → best`
- `good → best` when the median is `good`/`best`

`probeErrorMove` fills a rolled error bucket that the MultiPV list cannot:

1. Candidate pool: the wide search's ranks 11–20 (below 600 the pool is spread
   across ranks 21–32), plus `probeMoveCandidates` — captures, checks, central
   tension, exposed pieces, pawn pushes, quiet moves, taken round-robin so six
   pawn pushes cannot hide the move that actually loses.
2. A move that allows mate in one is never offered.
3. From 1000 up a free hang is skipped (`freeHangAfter`) and moves are ordered by
   `temptationRank`.
4. Each candidate is scored at `PROBE_DEPTH` and converted to win drop; the first
   one inside the rolled window wins — `mistake: 10–20`, `blunder: 20–45`
   (`PROBE_WINDOWS`).
5. Below 200 the probe never returns empty: the worst scored move is played even
   if the reference calls it only slightly worse.

---

## 6. Game review synchronisation

- **Bands** — identical to selection (§3). `WIN_THRESHOLDS.good/inaccuracy/
  mistake/blunder` = 2 / 5 / 10 / 20.
- **Best** — `isTopEngineMove`: the played UCI must equal the MultiPV #1 (or
  `bestMove` when only one line exists). Escalations to `great`/`brilliant`
  happen above this rule and are decided by uniqueness
  (`secondBestWinGap`) plus sacrifice and soundness metrics.
- **Accuracy** — layer 1 is
  `baseAccuracyScore(winDrop) = 100 · exp(−0.045 · winDrop^1.15)`, then
  classification overrides (best/book/great/brilliant/clutch → 100; blunder and
  throw → 0; escalated mistake capped at 35), then a per-move weight
  (`forced` 0, `book` 0.5, `mistake` 1.6, `blunder`/`throw` 2.5, brilliant 1.3,
  great 1.15, sharp positions 1.4, quiet 0.75). Game accuracy is the weighted
  mean, 1 dp.
- **Defending-position escalation** — `CONTEXT_ESCALATION` (deficit ≥ 150 cp or
  win% < 35) can lift an inaccuracy to mistake (≥ 100 cp / 12 win%) and a
  mistake to blunder (≥ 250 cp or 20 win%).

---

## 7. UI rules (this codebase)

There is no `PlayMenu.tsx` / `ChessBoard.tsx` here; the equivalents are
`src/components/play/*` plus `src/board/*`.

- **Player plates** — `.play-seat` is a reserved band (`min-height: 58px`,
  `overflow: hidden`, `min-width: 0` on the text column), names and metadata
  truncate with ellipsis, and the captured-material row and remark line reserve
  their height, so a capture or a remark never grows the plate.
- **Bot header band** — `.bot-side__selected` has a fixed `height: 76px` with
  `overflow: hidden`; `.bot-choice` names truncate inside their grid column.
- **Board** — `.board-slot` is `aspect-ratio: 1 / 1`, sized from
  `--board-fit = min(100%, 100dvh − chrome, 540px)` and multiplied by the user's
  zoom (`--board-px`). Measured stable across moves: 413×413 at 1280×900,
  327×327 at 390×844, and exactly 540×540 at 1900×1200 where the ceiling binds.
  Nothing content-dependent feeds the size, so move transitions cannot resize
  or shift the square.

---

## 8. Spec vs code synchronisation

| Brief | Code | Status |
| --- | --- | --- |
| Random floor `((400−elo)/300)^1.8`, uniform legal move | exact, `randomMoveChance` + uniform pick | ✅ synchronised |
| Six buckets at 2 / 5 / 10 / 20, Best = #1 | `SELECTION_BANDS`, `WIN_THRESHOLDS`, `classifyCandidate`, `isTopEngineMove` | ✅ synchronised |
| Continuous weights, severe buckets gated off for strong bots | `getBucketWeights`, `BUCKET_GATES` | ✅ (gates at **2100** / **2400**) |
| "1800 Elo excludes blunders" | at 1800 the fitted blunder share is **1.5%**; zero starts at 2100 | ⚠️ **mismatch** — the curve is smooth, not gated at 1800 |
| Probe uses `cpDrop ≥ 150 / 300` | probe uses **win-drop windows** 10–20 / 20–45; the 100/150/250 cp thresholds live in review `CONTEXT_ESCALATION` / `pieceHangCp` | ⚠️ **mismatch** — mechanism differs, effect comparable |
| Median-directed fallback | `medianBucket` + `bucketFallbackChain` | ✅ synchronised |
| Accuracy `100·exp(−0.045·winDrop^1.15)` | `baseAccuracyScore` | ✅ synchronised |
| Garbage-time downweighting (`winProb > 95` or `< 5`) | **not implemented**: `calculateGameAccuracy` weights only by classification and `secondBestWinGap` | ❌ **missing** |
| Best strictly #1, else Excellent or below | review identity rule; selector top-of-list rule | ✅ synchronised |
| Fixed board / non-growing plates | `.board-slot` ceiling, `.play-seat`, `.bot-side__selected` | ✅ synchronised |

### Recommended follow-ups (not applied)

1. **Garbage-time downweighting** — in `src/review/gameReviewService.ts`,
   `moveAccuracyWeight`, multiply the returned weight by ~0.35 when
   `move.winBefore >= 95 || move.winBefore <= 5` (before the `forced`/`book`
   cases or after, as a deliberate choice). It changes published accuracy
   numbers, so it should be a separate, measured change.
2. **Decide the blunder gate** — either move `BUCKET_GATES.blunder` to 1800
   (a real strength change for 1800–2099) or amend the brief; the current
   smooth curve is deliberate (`docs/play-personalities.md` documents the
   exponential decay).
3. **Probe thresholds** — if the centipawn gate is wanted as a *second* filter,
   add `cpLoss >= 150` for mistake and `>= 300` for blunder alongside the
   existing win-drop windows; today `cpLoss` is computed and returned but not
   used as a gate.
4. **Stale comments** — the `QualityShares` field comments describe the old
   4.5 / 1.8 / 0.4 bands and `BUCKET_CENTRES` (7.25 / 3.15 / 1.1 / 0.2) are the
   midpoints of those old bands; `SELECTION_BANDS` has been 5 / 2 / 10 / 20 for
   longer than the comments reflect.

---

## 9. How this was verified

```bash
node --experimental-strip-types tbl-audit.ts     # §3 numbers (temporary script, deleted)
node --experimental-strip-types --test tests/play/humanStrength.test.ts
npm run test:review                              # needs tests/review/register.mjs
```

`tests/play/humanStrength.test.ts` (45 tests) covers the bucket sums, the
random floor, the fallback chains and the probe windows; `npm run test:review`
passes 8/8. The review tests import `src/review` directly, so they must run
through `npm run test:review` — plain `node --test tests/review/` fails to
resolve the extensionless `../db` import, which is a runner detail, not a model
failure.

The wider play suite is 517 tests, 510 passing, with 7 pre-existing failures
unrelated to this model (two PGN-header assertions, three Brandon dialogue
lines, "speaks rarely", and the shipped-profile name).
