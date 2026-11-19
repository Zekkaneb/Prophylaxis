# Lichess puzzle integration — infrastructure

This document covers the data pipeline, storage model and training-set engine that
sit behind the puzzle trainer. It is **infrastructure only**: there is no new
solving UI, no Puzzle Rush and no leaderboards yet. The existing Puzzles tab keeps
working exactly as before.

---

## 1. Data source

[Lichess Open Puzzle Database](https://database.lichess.org/#puzzles) — the
official bulk export, **not** per-puzzle API calls.

The published file is `lichess_db_puzzle.csv.zst`. The copy audited here is the
decompressed CSV: **6,193,530 data rows, 1.1 GB**, LF line endings, no BOM, no
quoted fields, one header row. Columns:

```
PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags,DailyDate
```

`DailyDate` (11th) is empty except for puzzles that were Lichess's daily puzzle;
10-column rows from older exports are still accepted. Real values measured across
a 264,823-row stratified sample: ids always 5 alphanumerics, ratings 399–3174,
RD 51–500, popularity 0–100, 0–218k plays, 73 distinct themes, `GameUrl` always
`https://lichess.org/game/<id>[/black]#<ply>`, and `Moves` **always even length**
(2–30) — Lichess sequences end on the defender's reply.

Download it yourself; nothing in this repository fetches it automatically and no
credentials are involved:

```bash
curl -LO https://database.lichess.org/lichess_db_puzzle.csv.zst
# either let the ingest script decompress it (Node 22.15+/23.8+ ships zstd),
# or decompress once:
zstd -d lichess_db_puzzle.csv.zst
```

### Ingesting

```bash
# full file, default curation (1,000 puzzles per tier, quality ranked)
npm run ingest:puzzles -- --input lichess_db_puzzle.csv.zst

# a slice while you are wiring things up
node scripts/ingest-lichess-puzzles.mjs \
  --input lichess_db_puzzle.csv --max-rows 5000 --dry-run

# custom quality gates and output folder
node scripts/ingest-lichess-puzzles.mjs \
  --input lichess_db_puzzle.csv.zst \
  --out public/puzzles \
  --per-tier 1000 \
  --min-popularity 80 --max-rd 100 --min-plays 50 \
  --tier intermediate --tier advanced
```

`--input -` reads stdin. `--per-tier 0` keeps every eligible puzzle in the export.

Per tier the script writes `public/puzzles/{slug}.json`:

```json
{
  "tier": "intermediate",
  "name": "Intermediate",
  "min_rating": 1501,
  "max_rating": 1800,
  "target": 1000,
  "count": 1000,
  "generated_at": "…",
  "source": "lichess-open-database",
  "puzzles": [ { "puzzle_id": "00sHx", "fen": "…", "moves": "…", "rating": 1800, … } ]
}
```

That is exactly the shape `loadTierFile()` already reads, so the existing trainer
seeds itself from real puzzles with no code change. A machine-readable summary is
written to `<out>/ingest-report.json` (rows read, accepted, rejected with reasons,
duplicates, per-tier counts).

**The library is not capped at 6,000.** Only the exported chunk honours
`--per-tier` (the 1,000-per-tier curation target). `importPuzzles()` stores as many
validated puzzles as it is given, so a bigger export just needs a bigger
`--per-tier`.

### Verifying the pipeline without the full download

`scripts/fixtures/lichess-puzzles.sample.csv` is a 260-row file in the exact
official layout, generated with `npm run fixtures:puzzles`. Positions come from
legal games replayed with chess.js; the metadata is synthesized. It covers all six
tiers (210 Intermediate rows) plus an empty `OpeningTags` on some rows.

```bash
npm run fixtures:puzzles
node scripts/ingest-lichess-puzzles.mjs --input scripts/fixtures/lichess-puzzles.sample.csv \
  --out .tmp/puzzle-ingest
```

---

## 2. Difficulty tiers

One source of truth: [`src/puzzles/tiers.ts`](../src/puzzles/tiers.ts).

| Tier | Slug | Rating |
| --- | --- | --- |
| Tier | Slug | Label | Pool floor |
| --- | --- | --- | --- |
| New to Chess | `new-to-chess` | 800–1200 | 1000 |
| Novice | `novice` | 1201–1500 | 1351 |
| Intermediate | `intermediate` | 1501–1800 | 1651 |
| Advanced | `advanced` | 1801–2100 | 1951 |
| Expert | `expert` | 2101–2400 | 2251 |
| Master | `master` | 2401–2700 | 2551 |
| Elite | `elite` | 2701–3700 | 2701 |

**Harder pools.** A tier is filled from the *top* of its band, so its label is a
floor rather than a midpoint: `bandRatingFloor()` skips the bottom half by
default (Intermediate serves 1651–1800), and the build also drops one-move
puzzles (`solutionMoveCount() < 2`). Elite is the exception — only ~100 quality
puzzles exist above chess.com 3200, so it keeps its whole band, which is already
the hard end of the database.

**Chess.com scale.** The library comes from Lichess, whose puzzle ratings run
about 200 points below chess.com's for the same position. Chess.com is the scale
the trainer shows, so `LICHESS_TO_CHESSCOM_SHIFT` (200) is applied once, where the
database enters the app: `toStoredPuzzle()` for imports, the pool build and the
published shards. Every stored row, band, selection and display then uses
chess.com numbers — the table above is the Lichess table shifted by the same
offset. Existing browsers are rescaled once by the Dexie v9 upgrade.

`AUTHORITATIVE_PUZZLE_TIERS` is the editable table; the ingest script, the library
filter, the selection engine, `PUZZLE_TIERS` in the trainer and the classification
helper all derive from it. `classifyPuzzleRating(rating)` returns the slug (or
`null` below 800); `getTierBand(slug)` returns the bounds.

Elite (2701–3700) stays **outside** the six authoritative bands — it is the
overflow band for the hardest puzzles — but it is published and seeded exactly
like them (`public/puzzles/elite/`), so the trainer's Elite option serves real
database puzzles instead of the mock fallback.

---

## 3. Puzzle library

Stored in the existing `puzzles` table (IndexedDB `chess-trainer-db`), so nothing
is duplicated:

`puzzle_id` · `fen` · `moves` (UCI) · `rating` · `rating_deviation` · `popularity`
· `plays` · `themes[]` · `game_url` · `opening_tags[]` · `daily_date` · `source`
· `imported_at`

`puzzle_id` is the primary key, which is what makes imports idempotent: the same
CSV twice updates rows instead of adding duplicates.

- **Parse** — [`src/puzzles/lichessCsv.ts`](../src/puzzles/lichessCsv.ts):
  streaming-capable CSV splitter (quoted fields, `""` escapes, CRLF, BOM), row →
  record conversion, structural rejections collected rather than thrown, duplicate
  ids dropped and counted.
- **Validate** — [`src/puzzles/puzzleValidation.ts`](../src/puzzles/puzzleValidation.ts):
  id format, FEN legality, rating/RD/popularity/plays sanity, at least one theme,
  URL shape, and a full legal replay of the UCI sequence. Positions are parsed
  once: the solver's colour follows from the starting turn, because one legal
  move always hands the move to the other side.
- **Filter** — `eligiblePuzzles(puzzles, tier, filters)` applies the rating band,
  deduplicates and applies the quality gates.
- **Deduplicate** — by `puzzle_id`, at parse time, in `importPuzzles()` and in the
  selection helpers.

---

## 4. Training sets (Woodpecker-style)

### Storage, three tables

| Table | Holds |
| --- | --- |
| `puzzle_sets` | one frozen definition: tier, count, cycle target, selection method, seed, quality filters, `puzzle_ids` in order |
| `puzzle_cycles` | one row per planned cycle: status, start/completion time, totals |
| `puzzle_attempts` | one row per puzzle per cycle: attempts, first-attempt result, time, solved |

`puzzle_sets.puzzle_ids` is written **once**, at creation. Cycles never own a list
of their own — `getCyclePuzzles()` reads the set's frozen ids every time — so
"cycle 1 and cycle 7 use the same 200 puzzles" is structural, not a convention.

### Creating a set

```ts
import { createTrainingSet } from './src/puzzles/trainingSets';

const { set, available, requested } = await createTrainingSet({
  name: 'Intermediate · 200',
  tier: 'intermediate',
  puzzleCount: 200,
  cycles: 7,
  selection: 'random',            // or 'balanced'
  seed: 424242,                   // optional; omit for a fresh shuffle
  quality: {
    minPopularity: 80,
    maxRatingDeviation: 100,
    minPlays: 50,
    requiredThemes: ['fork'],     // optional
    excludedThemes: ['veryLong'], // optional
  },
  balanceThemes: ['fork', 'pin', 'mateIn2'], // balanced method only
});
```

- **random** — Fisher–Yates over the eligible pool with a seeded PRNG
  (mulberry32), unique ids only.
- **balanced** — buckets the pool by priority theme
  (`BALANCE_THEME_PRIORITY`) and round-robins across buckets, spreading a set over
  tactics instead of whatever the shuffle produced.
- Both respect `puzzleCount`, never return duplicates and never exceed the pool;
  `createTrainingSet` throws with the eligible count if the tier is too small.

The chosen ids and their order are persisted. Starting another cycle replays that
list; nothing regenerates.

---

## 5. Progress

```ts
import {
  createTrainingSet, getCyclePuzzles, recordAttempt,
  completeCycle, getSetProgress, getTrainingCycles,
} from './src/puzzles/trainingSets';

const { set } = await createTrainingSet({ … });
const { puzzles } = await getCyclePuzzles(set.set_id, 3);      // frozen 200, in order

await recordAttempt(set.set_id, 3, puzzles[0].puzzle_id, { correct: false, timeMs: 9000 });
await recordAttempt(set.set_id, 3, puzzles[0].puzzle_id, { correct: true,  timeMs: 6000 });
await completeCycle(set.set_id, 3);

const progress = await getSetProgress(set.set_id);
// progress.cycles_completed, progress.percent_complete, progress.puzzles_solved_ever,
// progress.first_attempt_accuracy, progress.attempt_count, progress.total_time_ms,
// progress.cycles[i] → status, solved/incorrect counts, attempts, accuracy,
//                     total_solve_time_ms, elapsed_ms (first attempt → completion)
```

Attempts are keyed `${set_id}:${cycle_num}:${puzzle_id}`, so progress in one cycle
can never leak into another. First-attempt accuracy is computed from the first
attempt on each puzzle, while `attempts` keeps counting retries. Every write
rebuilds that cycle's row from its attempts (pure functions in
[`trainingModel.ts`](../src/puzzles/trainingModel.ts)), so totals can always be
recomputed.

---

## 6. Chess integration

- Validation and replay use **chess.js**, the same rules engine the board, quiz and
  reviewer use. No second rules implementation, no Stockfish: correctness is
  "is this move legal from this FEN", not "does the engine like it".
- Lichess convention is preserved end to end:
  - `moves[0]` — opponent's setup move, played automatically;
  - `moves[1]` — the player's first solution move;
  - `moves[2…]` — alternating opponent replies and solution moves.
- `replayUciSequence(fen, moves)` returns every intermediate FEN, the solver colour
  (side to move after the setup move), the solution moves and the replies;
  `isLegalUciSequence()` is the boolean form.

---

## 7. Persistence and future sync

- Everything lives in the existing Dexie database; `DB_SCHEMA_VERSION` is now **6**
  (additive migration: `puzzles` gained a `shard_id` index and the shard-state
  table below was added; no existing table was touched).
- Backups include the new tables (`BACKUP_TABLES` in
  `src/services/backupService.ts`).
- Rows carry stable, client-generated string ids (`set-…`, `set-id:cycle`,
  `set-id:cycle:puzzle`) and timestamps, so a future account/sync layer can mirror
  these three tables without reshaping them. No sync code, accounts, or extra
  database was added.

---

## 8. Audit against the real database (2026-11-18)

`scripts/audit-lichess-ingest.mjs` reads stratified blocks of the real file and
runs them through the same parse/validate/classify code the ingester uses. It
never writes to the library.

```bash
# 6 blocks of 8 MB spread across the 1.1 GB file
node scripts/audit-lichess-ingest.mjs --chunks 6 --chunk-mb 8 --json audit.json

# exactly the first 300,000 rows — comparable with `--max-rows 300000`
node scripts/audit-lichess-ingest.mjs --chunks 1 --chunk-mb 64 --max-rows-per-chunk 300000
```

Results on the shipped database:

| Check | Result |
| --- | --- |
| Rows sampled | 264,823 across the whole file; 300,000 row-for-row against the CLI |
| Parsed / rejected / duplicates | 264,823 / **0** / **0** |
| FEN + UCI replay | **0** invalid positions or illegal sequences |
| Lichess convention | **0** solver/setup/parity mismatches; every `Moves` even (2–30) |
| Tier classification | all six tiers populated; **0** band/classifier mismatches |
| Ratings outside 600–2500 | 3.8% below 600, 3.7% above 2500 (Elite) |
| Quality gates (pop ≥ 80, RD ≤ 100, plays ≥ 50) | 27.5% of rows filtered; every tier still had 13.5k–39.7k eligible puzzles per 264k sample |
| Whole-file duplicate scan (ids only) | 6,193,530 rows, **0** duplicates, **0** malformed ids |

Runtime and memory (Node 26, Windows): the ingester sustains **~2,100 rows/s**
(300,000 rows in 142 s), so the full export is ≈ **50 minutes**. Peak working set
was **163 MB** at 100k rows and **170 MB** at 300k; the id set costs ~50 B per
puzzle, and the whole-file id scan peaks at **616 MB**, so a full ingest should
peak around 0.6–0.7 GB. The 300k-row audit and CLI run produced identical counts
(300,000 rows, 0 rejected, 0 duplicates, 6,000 stored at 1,000/tier).

### Fixture discrepancies found and fixed

| Real format | Fixture before | Fix |
| --- | --- | --- |
| 11 columns (`DailyDate`) | 10 | Parser, types and fixtures now carry `daily_date`; 10-column input still accepted |
| `Moves` always even | 129/260 odd | Generator emits even sequences (and retries when a random game ends early); edge test keeps odd-length handling |
| `GameUrl` = `lichess.org/game/<id>#<ply>` | `lichess.org/<id>` | Generator writes real-shaped URLs |
| Ratings 399–3174 | only 600–2500 | New `lichess-puzzles.edge.csv` covers 399, 3128, duplicates, empty themes, bad FEN, illegal move |

---

## 9. Tests

```bash
npm run test:puzzles   # 87 tests: CSV, validation, tiers, selection, model, pipeline, edges, shards
npm run test:pgn       # 23 existing PGN regression tests
npm test               # both
npx tsc -b             # type check
npx oxlint             # lint
```

Coverage: CSV parsing (quotes, CRLF/BOM, chunk boundaries, rejects, duplicates,
fixture), puzzle validation (legality, Lichess convention, metadata, normalization),
tier classification boundaries, random selection determinism/uniqueness/clamping,
balanced theme spread, quality filters, deduplication, frozen set membership,
seven-cycle consistency and independent cycle progress math.

Shard coverage (`shardPlan.test.ts`, `shardStore.test.ts`): reservoir determinism
and uniformity (chi-square over five fixed seeds), shuffle stability, manifest and
payload validation (stale versions, wrong tier, malformed rows), fetch planning,
and **real Dexie persistence** via `fake-indexeddb` — downloaded shard state,
cache short-circuit, duplicate-id collapsing, retries and failed shards, manifest
upgrades, exhausted pools, pruning protection for frozen sets, and membership
unchanged across seven cycles after shard loading.

---

## 10. Manual steps still required

1. Download `lichess_db_puzzle.csv.zst` from the URL above (not committed, and not
   downloaded during setup). Decompress it to `lichess_db_puzzle.csv`.
2. Build the published pool (no network, no credentials, ~45 minutes — see §12):

   ```bash
   node scripts/ingest-lichess-puzzles.mjs --mode pool \
     --input lichess_db_puzzle.csv --per-tier 5000 --shard-size 1000 --seed 20261118
   ```

   `public/puzzles/{tier}/` now holds `manifest.json` plus five shards per tier.
   Commit those files; the CSV itself is gitignored.
3. The app seeds itself from the manifests; no further configuration, keys or
   credentials exist. A deployment that has no shards keeps using the legacy
   `puzzles/{tier}.json` chunk (or the mock pool), exactly as before.

## 11. Deliberately not built yet

Puzzle solving UI, Puzzle Rush, leaderboards, visual redesign, user accounts and
cross-device sync. The storage and services above are the seams those will attach
to.

---

## 12. Published shard pool (full-database sampling)

### Why

The complete Lichess database is **6,193,530 rows / 1.1 GB CSV**, which serialises
to roughly **2.2 GB of JSON** (≈0.48 GB gzipped). That cannot be hosted on GitHub
Pages (1 GB published-site limit, 100 MiB per file) and it must not be pushed into
IndexedDB: a 2.6–3.7 GB origin is evictable and `createWoodpeckerSet()` reads a
whole tier with `toArray()`, so even the current selection code assumes a bounded
pool.

The pool solves both: the full file stays an **offline build input**, and the app
ships a uniform sample of each tier as static JSON shards.

### Build

```bash
node scripts/ingest-lichess-puzzles.mjs --mode pool \
  --input lichess_db_puzzle.csv --per-tier 5000 --shard-size 1000 --seed 20261118
```

- Every **valid, quality-passing** puzzle in a tier is offered once, in file order,
  to a reservoir sampler (`ReservoirSampler`, Algorithm R). The retained 5,000 are
  a uniform random sample of the tier's whole population — not the most popular
  ones, which would bias the pool.
- Every band in `PUZZLE_TIER_BANDS` is built, Elite included: **seven** pools,
  each from the harder slice described above (band floor + no one-move puzzles).
- The sample is shuffled with a second deterministic stream and split into 1,000-row
  shards, so shard membership is reproducible from `--seed` too.
- Recommended invocation: add `--tier <slug>` and run the seven tiers separately
  (they can run in parallel). Rows outside the selected tier are filtered *before*
  the chess replay, so each run is much shorter and the output is byte-identical to
  one all-tier pass. A band with no passing puzzles writes no manifest, so the
  trainer falls back instead of loading an empty pool.

Measured against the shipped 6,193,530-row database (seed `20261118`):

| Per tier | Value |
| --- | --- |
| Puzzles | 5,000 |
| Shards | 5 × 1,000 |
| Shard size | 351–354 KB raw / 75–82 KB gzip |
| Tier size | 1.72–1.77 MB raw / 0.38–0.41 MB gzip |

Seven tiers (the six plus Elite) ⇒ **35,000 puzzles, ≈12.0 MB raw / ≈2.7 MB gzip**,
42 files, 1.66–1.73 MB per tier. A user downloads one shard (~75–82 KB gzip) per
tier they train on.

### Layout

```
public/puzzles/intermediate/
  manifest.json        version, seed, pool_size, shard list
  shard-0001.json      1,000 puzzles
  … shard-0005.json
```

```jsonc
// manifest.json
{
  "tier": "intermediate", "name": "Intermediate",
  "min_rating": 1651, "max_rating": 1800,   // served floor … band ceiling
  "version": 20261120,          // keys downloaded-shard state
  "generated_at": "…", "source": "lichess-open-database",
  "seed": 20261118, "pool_size": 5000, "shard_size": 1000, "count": 5000,
  "shards": [{ "index": 1, "file": "shard-0001.json", "count": 1000,
               "first_id": "…", "last_id": "…" }, …]
}
```

```jsonc
// shard-0001.json
{ "tier": "intermediate", "version": 20261120, "shard": 1,
  "count": 1000, "puzzles": [ … ] }
```

### Runtime

`ensureTierSeeded(tier, { minPool })` (`src/puzzles/woodpeckerService.ts`) resolves
in this order:

1. **Shard manifest** — `loadTierManifest()` validates it, then
   `seedTierFromShards()` (`src/puzzles/shardStore.ts`) downloads shards from a
   random offset until the tier holds `minPool` puzzles (`MIN_TIER_POOL = 1000`
   by default, or the requested set size). At most 4 shards per call.
2. **Legacy tier file** — `puzzles/{tier}.json`, unchanged.
3. **Mock pool** — unchanged, so the trainer works offline.

Each shard is validated before writing: wrong tier, wrong manifest version or an
empty payload is rejected, and individual malformed puzzles are skipped and
counted. Writes are `bulkPut`s keyed by `puzzle_id`, so duplicate ids (across
shards or a regenerated pool) collapse instead of duplicating rows, and existing
rows are never deleted.

Failures are contained: a shard is attempted twice (200 ms backoff), then recorded
as `failed` and skipped; the next shard is tried. Shards recorded as `failed` are
not "seeded", so a later call retries them. If every shard is present and the
requested size still exceeds the pool, the call returns the local count and the
existing *"Only N eligible puzzles are stored"* error tells the user — no loop.

### Shard state (Dexie v6)

| Field | Meaning |
| --- | --- |
| `id` | `${tier}:${manifest_version}:${shard_index}` (primary key) |
| `status` | `downloaded` \| `failed` |
| `puzzle_count`, `attempts`, `downloaded_at`, `last_error` | diagnostics |

`puzzles` gained a `shard_id` index; imported, review and mock rows have no
`shard_id`, which is how pruning distinguishes the downloaded pool from user data.
A new manifest version adds its shards beside the old ones (no rows are replaced),
so a frozen set keeps resolving its ids across a pool regeneration.

### Pruning

`pruneShardPuzzles()` deletes only rows that carry a `shard_id`, and only when **no
saved training set** (`puzzle_sets` or the legacy `woodpecker_sets`) references any
puzzle in that shard. A shard with even one referenced puzzle is kept whole, and
non-shard rows are never touched. It is an explicit call, not an automatic
deletion, so nothing disappears behind the user's back.

### Standalone (`file://`) build

`scripts/build-standalone.mjs` deliberately **does not inline**
`puzzles/{tier}/…`: that would add ~14 MB of base64 for 30,000 puzzles. The
single-file build keeps only the legacy `puzzles/{tier}.json` chunks (if present)
and the mock pool, so it still trains offline. Shard manifests are fetched over
HTTP and are unavailable from a `file://` page — by design, not by accident.
