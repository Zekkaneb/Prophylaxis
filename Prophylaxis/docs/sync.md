# Accounts and cross-device sync

The app is local-first: `src/db.ts` opens one Dexie database (`chess-trainer-db`)
and nothing above it knows who is using the app. Adding accounts for *the same
person on several devices* therefore changes two things — who owns the data, and
which copy of it is right when two devices disagree.

This document records the decisions. The server half is
`supabase/migrations/0001_sync.sql`. The first client slice is live: accounts and
the `played_games` round trip, in `src/sync/`. The other nine tables are still
local-only.

## What syncs, and what does not

| Table | Syncs | Why |
| --- | --- | --- |
| `pgn_courses` | yes | imported by the user, expensive to recreate |
| `custom_lessons` | yes | authored by the user |
| `line_progress` | yes | drill history per chapter |
| `lesson_progress` | yes | completion + recency |
| `saved_reviews` | yes | review analyses of the user's games |
| `played_games` | yes | game history and the ratings built on it |
| `active_game` | yes | one row; the point is resuming on another device |
| `puzzle_sets` | yes | frozen set membership + current cycle |
| `puzzle_cycles` | yes | pass results |
| `puzzle_attempts` | yes | attempt log |
| `puzzles` | **no** | shared reference data, seeded per device from `/public/puzzles/*.json` |
| `puzzle_shards` | **no** | bookkeeping for the shared corpus above |
| `woodpecker_sets` | **no** | superseded by `puzzle_sets`; leave the legacy rows local |

Syncing `puzzles` would upload the whole puzzle corpus once per user, and the
corpus is already a downloadable asset. A second device seeds it the same way
the first one did.

## Identity

Supabase Auth, email + password (magic link is a config change, not code).
`@supabase/supabase-js` in the SPA; the session is what every sync call carries.

The project URL and publishable key are committed as defaults in
`src/sync/client.ts`; `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` override
them. A publishable key is not a secret — it ships in the bundle by design and
grants nothing without RLS — and hard-coding it means a build cannot come out
account-free just because the dev server started before `.env.local` existed.

The anon key ships in the bundle — that is expected. It grants nothing on its
own: every read and write is filtered by RLS on `sync_rows`, which compares
`auth.uid()` to the row's `user_id`. No client code filters by user id.

## One mirror table, not ten typed ones

`sync_rows(user_id, table_name, row_id, payload jsonb, updated_at, deleted)`.

The payload is the Dexie row verbatim. Typed tables would mean a Postgres
migration every time a Dexie row changes shape (v9 already changed puzzle
ratings) for no benefit, because no server query reads inside the payload.

## Conflict rule: last write wins per row, with tombstones

* Every row carries `updated_at` (epoch ms on the device, `timestamptz` on the
  server) and a `deleted` flag.
* Deletes are tombstones: the row stays, `deleted` flips. A hard delete would be
  resurrected by the next device that still had the row.
* The server enforces monotonicity in `push_sync_rows` — an upsert whose
  `updated_at` is not strictly newer than the stored one is dropped. So two
  devices pushing out of order converge regardless of arrival order.
* Device clocks are clamped to `now() + 5 minutes` so one bad clock cannot own a
  row forever.
* Per-row LWW is right for this data because rows are small and mostly
  independent (a finished game, an attempt, a course). It is wrong for
  counters — see below.

### Row shapes that need care

* `puzzle_sets.current_cycle` and `lesson_progress` are counters/flags where a
  merge is better than a veto: writing device A's *cycle 3* over device B's *cycle
  4* because A's clock was 2 s later is a real regression. For these two tables
  the client should send `max()` of the local and remote value instead of the
  winner's whole row.
* `active_game` is a single row that is deleted on resignation/mate. Tombstones
  matter most here: otherwise device A's abandoned game comes back after device
  B finished it.

## Client plan

1. **Capture changes in one place.** There are 51 write call sites across the ten
   tables, so per-call-site bookkeeping is a non-starter. Dexie 4 exposes
   `db.on('changes', …)`; subscribe once and append each change to a new
   `sync_outbox` store (Dexie v10) as `{table_name, row_id, updated_at, deleted}`.
   Writes from the puller must not be re-enqueued — guard with an
   `applyingRemote` flag.
2. **Push** drains the outbox through `push_sync_rows` in batches (~200 rows),
   oldest first, deleting outbox rows only after the RPC returns.
3. **Pull** asks for `updated_seq > cursor`, ordered, in pages; applies with
   `bulkPut` (or a tombstone delete), then advances the cursor. The cursor lives
   in `sync_meta`, per user id. It is the server's sequence value, not a
   timestamp: rows written in the same millisecond share `updated_at`, so a
   `> timestamp` cursor silently drops every one of them that falls past a page
   boundary (migration `0002_sync_cursor.sql`). A failed page leaves the cursor
   untouched, so the next attempt re-asks instead of skipping ahead.
4. **Order on sign-in:** pull first, then push. Pushing first would send rows the
   server already has newer copies of, which is harmless but wastes a round trip.
5. **Per-user local database** (done — `src/sync/accountDatabase.ts`).
   `chess-trainer-db-${userId}` for an account, `chess-trainer-db` while
   anonymous. On first sign-in the anonymous user tables and its outbox are
   copied in and the account database is marked with an `owner` key, so the
   claim happens once; `puzzles`/`puzzle_shards` are not copied (shared
   reference data). `src/db.ts` exposes the database through a proxy, so the
   fifty modules holding that binding do not change. `src/sync/bootstrap.ts`
   opens the right database before the first render; a sign-in or sign-out
   during a session switches and reloads. `runSync` refuses to run unless the
   open database's owner is the signed-in user, which is the wall that stops one
   account's games being uploaded under another's.
6. **Sign out** drops the session and closes the user's Dexie database; it does
   not delete it, so signing back in is instant and offline still works.
7. **Offline** is the normal case: every write is local and queued; the outbox
   survives reloads.

## Deploying

The single-file build (`npm run build:single` → `opening-lab.html`) runs from
`file://`, where there is no origin for an OAuth redirect and storage is
per-file. It stays offline-only: no session, no sync, local database as today.
Accounts ship in the hosted build served over https.

## Order of work

1. Server schema + RLS (done — `supabase/migrations/0001_sync.sql`,
   `0002_sync_cursor.sql`, `0003_woodpecker_sets.sql`, `0004_prefs.sql`,
   `0005_user_ratings.sql` and `0006_user_titles.sql`; run them in order, and
   re-run the newest allow-list file whenever sync reports
   `sync_rows_known_table`).
2. Auth: client, session persistence, sign-in from the account corner (done —
   `src/sync/client.ts`, `src/sync/useSync.ts`, `src/components/AccountMenu.tsx`).
3. Outbox + push, for `played_games` only, then pull on sign-in (done —
   `src/sync/outbox.ts`, `src/sync/sync.ts`, `src/play/gameStore.ts`).
4. The remaining tables (done — see "What syncs today").
5. Tombstones and the legacy-database claim (done: deletes queue tombstones,
   and `claimLocalRows` copies the anonymous database into a new account
   database once).

## What syncs today

Every table that belongs to one person: `played_games`, `puzzle_sets`,
`puzzle_cycles`, `puzzle_attempts`, `woodpecker_sets`, `pgn_courses`,
`custom_lessons`, `line_progress`, `lesson_progress`, `saved_reviews`,
`active_game`, and `prefs`.

### Cosmetics and preferences

`prefs` is one row per setting — `appearance` (palette, piece set, ground,
accent, board size, colour mode), `sound` (mute and volume), `premoves` and
`profile` (first name, last name, elo) — with the same JSON string
`localStorage` holds. `src/sync/preferences.ts`
writes the row from the same place that writes storage and skips the write when
the value is unchanged, so a value that arrived from the server is not pushed
straight back. On a pull the row is applied by writing storage, notifying the
sound manager (registered in `ThemeProvider`), and firing
`openinglab:preferences-applied`, which the theme and premove hooks listen for.
A device that has been used for months uploads its current look once, on the
first boot after the upgrade (`seedPreferences`).

### Name and rating

`profile` travels twice, on purpose. As a synced preference it reaches other
signed-in devices within a sync round trip, and `usePlayerProfile` re-reads
storage on `openinglab:preferences-applied`, so the nameplate follows without a
reload. As `user_metadata` (`first_name`, `last_name`, `elo`) it belongs to the
account itself: `syncProfileToAccount` pushes every local save (Dashboard form,
account panel), and `applySignedInProfile` runs at boot — account values win,
but an account that has no name yet adopts the local profile, so a profile set
before signing in is not lost.

`woodpecker_sets` is not legacy: the Puzzles page's "Available sets" list is
built from it, so freezing a set there is the row that has to travel. Migration
`0003_woodpecker_sets.sql` adds it to the server's allow-list.

Rows saved *before* a table was synced are queued once by
`backfillSyncedRows()` (`src/sync/accountDatabase.ts`), which runs at boot and
marks the database so it never repeats — otherwise last week's puzzle set would
stay invisible to every other device.

### Rows that need a merge, not a winner

`mergeRemoteRow` takes the incoming row for everything except the fields that
only ever grow:

* `puzzle_sets.current_cycle`
* `line_progress.attempts`, `best_percent`, `mastery`, `last_drilled`
* `lesson_progress.last_practiced`, and `is_completed` as a latch (finished on
  either device stays finished)

A clock a few seconds ahead must not move a trainer back a cycle or wipe a best
score. `active_game` needs the opposite care: it is tombstoned when archived or
cleared, or another device keeps offering to resume a game that is over.

## What does not sync

`puzzles` and `puzzle_shards` only — the shared reference corpus, seeded per
device from `/public/puzzles/*.json`.

Changes are captured where a table is written (`src/play/gameStore.ts`,
`src/puzzles/trainingSets.ts`, `src/puzzles/woodpeckerService.ts`,
`src/courses/courseService.ts`, `src/review/gameReviewService.ts`,
`src/components/GameReviewDashboard.tsx`). Those are the only writer functions
for the synced tables; a new write path would have to call
`recordSyncedChange` itself.
* There is no conflict UI: the newest write wins silently, as designed.
