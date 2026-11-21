-- Cross-device sync for the local-first database in `src/db.ts`.
--
-- Every user-owned Dexie table is mirrored into one row of `sync_rows`: the
-- Dexie row goes in `payload` untouched. That keeps this file small and means a
-- Dexie schema change (v9 already moved puzzle ratings) never needs a Postgres
-- migration — the client is the only reader of the payload.
--
-- Invariants this file is responsible for:
--   * a user can only ever see or write their own rows (RLS, not client code);
--   * a stale write can never overwrite a newer one (`updated_at` guard);
--   * a delete is a tombstone, so a sync cannot resurrect the row.
--
-- Reference data (`puzzles`, `puzzle_shards`) is deliberately absent: it is
-- seeded from `/public/puzzles/*.json` on each device and would be hundreds of
-- megabytes of duplicated rows per user. See `docs/sync.md`.

create table if not exists public.sync_rows (
  user_id uuid not null references auth.users (id) on delete cascade,
  table_name text not null,
  row_id text not null,
  payload jsonb not null default '{}'::jsonb,
  -- When this row's content last changed, as the writing device saw it.
  -- Used for last-write-wins between devices.
  updated_at timestamptz not null default now(),
  -- Tombstone: the row was deleted on some device. Kept so the delete spreads.
  deleted boolean not null default false,
  primary key (user_id, table_name, row_id),
  constraint sync_rows_known_table check (
    table_name in (
      'pgn_courses',
      'custom_lessons',
      'line_progress',
      'lesson_progress',
      'saved_reviews',
      'played_games',
      'active_game',
      'puzzle_sets',
      'puzzle_cycles',
      'puzzle_attempts'
    )
  )
);

-- Pull query: "everything for me newer than this cursor".
create index if not exists sync_rows_pull_idx
  on public.sync_rows (user_id, updated_at, table_name);

alter table public.sync_rows enable row level security;

-- One policy, because ownership is a column rather than a relationship:
-- `using` guards reads/updates/deletes, `with check` guards inserts (including
-- the insert half of an upsert, which is why it must exist too).
drop policy if exists "sync_rows are private to their owner" on public.sync_rows;
create policy "sync_rows are private to their owner"
  on public.sync_rows
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Pushes go through one RPC rather than a PostgREST upsert, because the
-- conflict rule ("only newer wins") cannot be expressed in a PostgREST query
-- string. `auth.uid()` is used for ownership — a client-supplied user_id is
-- ignored entirely.
create or replace function public.push_sync_rows(p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  touched integer;
begin
  if auth.uid() is null then
    raise exception 'push_sync_rows requires an authenticated user'
      using errcode = '28000';
  end if;

  with incoming as (
    select
      auth.uid() as user_id,
      r.table_name,
      r.row_id,
      coalesce(r.payload, '{}'::jsonb) as payload,
      -- Device clocks drift and are not trusted. Clamp to a small window so one
      -- wrong clock cannot freeze a row's future for every other device.
      least(greatest(r.updated_at, now() - interval '1 day'), now() + interval '5 minutes')
        as updated_at,
      coalesce(r.deleted, false) as deleted
    from jsonb_to_recordset(p_rows) as r(
      table_name text,
      row_id text,
      payload jsonb,
      updated_at timestamptz,
      deleted boolean
    )
  ),
  upserted as (
    insert into public.sync_rows (user_id, table_name, row_id, payload, updated_at, deleted)
    select user_id, table_name, row_id, payload, updated_at, deleted
    from incoming
    on conflict (user_id, table_name, row_id) do update
      set payload = excluded.payload,
          updated_at = excluded.updated_at,
          deleted = excluded.deleted
      -- The whole point of the guard: an older write loses, quietly.
      where excluded.updated_at > sync_rows.updated_at
    returning 1
  )
  select count(*) into touched from upserted;

  return touched;
end;
$$;

revoke all on function public.push_sync_rows(jsonb) from public, anon;
grant execute on function public.push_sync_rows(jsonb) to authenticated;
