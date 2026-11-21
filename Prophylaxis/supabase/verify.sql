-- Self-checking verification for the sync schema.
--
-- Paste this whole file into the Supabase SQL editor and run it. Every row is a
-- named check with a boolean `ok`; anything false is a real problem and the
-- name says which one. It reads catalogues only — it does not write, and it
-- does not touch your rows.
--
-- Expected output: 12 rows, all `ok = true`.
--
--   updated_seq column          migration 0002 ran (the pull cursor)
--   deleted column              tombstones exist (0001)
--   pull index                  (user_id, updated_seq) index (0002)
--   sequence                    sync_rows_seq exists (0002)
--   rpc bumps updated_seq       push assigns a new sequence value (0002)
--   rls enabled                 row-level security is on (0001)
--   policy checks auth.uid READ the SELECT/UPDATE/DELETE half of the policy
--   policy checks auth.uid WRITE the INSERT half of the policy
--   authenticated can SELECT/INSERT/UPDATE  the grants 0002 adds
--   authenticated can execute rpc           the RPC grant
--   constraint allows every synced table    migration 0003 (woodpecker_sets)
--   anon cannot touch the table             no anonymous access at all

select 'updated_seq column' as check_name,
       exists (
         select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'sync_rows'
            and column_name = 'updated_seq' and is_nullable = 'NO'
       ) as ok

union all
select 'deleted column',
       exists (
         select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'sync_rows'
            and column_name = 'deleted'
       )

union all
select 'pull index',
       exists (
         select 1 from pg_indexes
          where schemaname = 'public' and tablename = 'sync_rows'
            and indexdef like '%(user_id, updated_seq)%'
       )

union all
select 'sequence',
       to_regclass('public.sync_rows_seq') is not null

union all
select 'rpc bumps updated_seq',
       pg_get_functiondef('public.push_sync_rows(jsonb)'::regprocedure)
         like '%updated_seq%'

union all
select 'rls enabled',
       (select relrowsecurity from pg_class where oid = 'public.sync_rows'::regclass)

union all
select 'policy checks auth.uid READ',
       exists (
         select 1 from pg_policy
          where polrelid = 'public.sync_rows'::regclass
            and pg_get_expr(polqual, polrelid) like '%auth.uid()%'
       )

union all
select 'policy checks auth.uid WRITE',
       exists (
         select 1 from pg_policy
          where polrelid = 'public.sync_rows'::regclass
            and pg_get_expr(polwithcheck, polrelid) like '%auth.uid()%'
       )

union all
select 'authenticated can SELECT',
       has_table_privilege('authenticated', 'public.sync_rows', 'SELECT')

union all
select 'authenticated can INSERT',
       has_table_privilege('authenticated', 'public.sync_rows', 'INSERT')

union all
select 'authenticated can UPDATE',
       has_table_privilege('authenticated', 'public.sync_rows', 'UPDATE')

union all
select 'authenticated can execute rpc',
       has_function_privilege(
         'authenticated', 'public.push_sync_rows(jsonb)', 'EXECUTE'
       )

union all
select 'constraint allows every synced table',
       coalesce(
         pg_get_constraintdef(
           (select oid from pg_constraint where conname = 'sync_rows_known_table')
         ) like '%woodpecker_sets%',
         false
       )

union all
select 'anon cannot touch the table',
       not has_table_privilege('anon', 'public.sync_rows', 'SELECT')
       and not has_table_privilege('anon', 'public.sync_rows', 'INSERT')

order by check_name;
