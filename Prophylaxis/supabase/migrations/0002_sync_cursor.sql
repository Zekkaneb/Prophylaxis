-- Pull pagination fix.
--
-- The first version paged on `updated_at` with a `> cursor` filter, which
-- silently skips rows that share the boundary timestamp: 500 rows land in one
-- page, the 501st shares the last row's millisecond and is never asked for
-- again. Timestamps also get clamped to `now() + 5 minutes` on push, so ties
-- are not even rare — two devices pushing in the same second produce them.
--
-- `updated_seq` is a sequence value assigned on every write, so it is unique and
-- monotonic, and the pull cursor can be a plain `>`. `updated_at` stays the
-- conflict rule; `updated_seq` is only about ordering the stream.

create sequence if not exists public.sync_rows_seq as bigint;

alter table public.sync_rows
  add column if not exists updated_seq bigint;

-- Give the rows that already exist a stable order (timestamp, then identity).
with numbered as (
  select
    user_id,
    table_name,
    row_id,
    row_number() over (order by updated_at, user_id, table_name, row_id) as n
  from public.sync_rows
  where updated_seq is null
)
update public.sync_rows s
   set updated_seq = numbered.n
  from numbered
 where s.user_id = numbered.user_id
   and s.table_name = numbered.table_name
   and s.row_id = numbered.row_id;

-- Park the sequence past the backfill so the next value is greater than every
-- row that already exists.
select setval(
  'public.sync_rows_seq',
  coalesce((select max(updated_seq) from public.sync_rows), 0) + 1,
  false
);

alter table public.sync_rows alter column updated_seq set not null;
alter table public.sync_rows
  alter column updated_seq set default nextval('public.sync_rows_seq');

drop index if exists public.sync_rows_pull_idx;
create index if not exists sync_rows_pull_idx
  on public.sync_rows (user_id, updated_seq);

-- Push: same last-write-wins rule, but every applied write takes a new sequence
-- value, so an update lands at the end of the pull stream rather than at its
-- original position.
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
    insert into public.sync_rows
      (user_id, table_name, row_id, payload, updated_at, updated_seq, deleted)
    select
      user_id, table_name, row_id, payload, updated_at,
      nextval('public.sync_rows_seq'), deleted
    from incoming
    on conflict (user_id, table_name, row_id) do update
      set payload = excluded.payload,
          updated_at = excluded.updated_at,
          deleted = excluded.deleted,
          updated_seq = nextval('public.sync_rows_seq')
      where excluded.updated_at > sync_rows.updated_at
    returning 1
  )
  select count(*) into touched from upserted;

  return touched;
end;
$$;

-- Privileges. The publishable key authenticates as `anon` until a user signs in
-- and as `authenticated` afterwards; only the latter needs access, and RLS then
-- limits it to the caller's own rows. Re-asserted here because the original
-- migration relied on schema defaults that this project does not have.
revoke all on public.sync_rows from anon;
revoke all on function public.push_sync_rows(jsonb) from public, anon;
grant select, insert, update, delete on public.sync_rows to authenticated;
grant usage, select on sequence public.sync_rows_seq to authenticated;
grant execute on function public.push_sync_rows(jsonb) to authenticated;
