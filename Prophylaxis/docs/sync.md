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

1. Server schema + RLS (done — `supabase/migrations/0001_sync.sql` and
   `0002_sync_cursor.sql`; run both in the project's SQL editor, in order).
2. Auth: client, session persistence, sign-in in Settings (done —
   `src/sync/client.ts`, `src/sync/useSync.ts`, the Account section).
3. Outbox + push, for `played_games` only, then pull on sign-in (done —
   `src/sync/outbox.ts`, `src/sync/sync.ts`, `src/play/gameStore.ts`).
4. The remaining nine tables. `gameStore` is the only seam `played_games` needed;
   the rest will need the general capture point described above, plus the `max()`
   handling for the two counter rows.
5. Tombstone sweep across all tables and the legacy-database claim on first
   sign-in (not started).

## What the first slice does not do yet

* Only `played_games` syncs. Puzzle attempts, courses, drill history and
  progress are saved locally and stay there.
* Changes are captured where a table is written (`src/play/gameStore.ts`), not
  centrally, because one table is one seam. That changes in step 4.
* There is no conflict UI: the newest write wins silently, as designed.
