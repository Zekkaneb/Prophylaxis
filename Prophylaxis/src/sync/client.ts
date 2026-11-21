import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The hosted backend, when this build has one.
 *
 * `opening-lab.html` is built from the same sources, and the single-file build
 * has no origin for an auth redirect, so the client is optional rather than
 * assumed: without the two variables below the app runs exactly as it always
 * has, offline and account-free.
 *
 * The key is Supabase's publishable (anon) key. It is safe in the bundle — the
 * rows are protected by the RLS policy in `supabase/migrations/0001_sync.sql`,
 * not by the key.
 */

/* `import.meta.env` only exists once Vite has replaced it, so read it through a
   guard: the test runner imports this module in plain Node, where it is absent. */
const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};

/**
 * The project this build talks to.
 *
 * Committed defaults rather than env-only, because a publishable key is not a
 * secret: it is designed to ship in the bundle, it grants nothing on its own,
 * and every row is protected by the RLS policy in the migrations. Env vars
 * still win when set, so a fork can point at its own project without editing
 * code — but a build cannot silently come out account-free just because the
 * dev server started before `.env.local` existed.
 */
const DEFAULT_URL = 'https://pldugqseqokbruvsorca.supabase.co';
const DEFAULT_ANON_KEY = 'sb_publishable_x2kj4MuEQ1nWDRV4Y7XbmA_8Iv8OJdt';

const url = env.VITE_SUPABASE_URL?.trim() || DEFAULT_URL;
const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim() || DEFAULT_ANON_KEY;

/*
 * The single-file build (`opening-lab.html`) opens from `file://`, where there
 * is no origin for an auth redirect and each file has its own storage bucket.
 * Even when the env vars are baked in, that build stays account-free.
 */
const fileBuild = typeof window !== 'undefined' && window.location.protocol === 'file:';

/**
 * Why sync cannot run here, or `null` when it can.
 *
 * The two cases look identical to a user and are fixed differently: a `file:`
 * page is the offline single-file build (by design), while `unconfigured`
 * means this build was made without `VITE_SUPABASE_URL` / `_ANON_KEY` — which
 * is what a dev server started before `.env.local` existed looks like.
 */
export type SyncDisabledReason = 'file' | 'unconfigured';

export const syncDisabledReason: SyncDisabledReason | null = fileBuild
  ? 'file'
  : url && anonKey
    ? null
    : 'unconfigured';

export const syncConfigured = syncDisabledReason === null;

export const supabase: SupabaseClient | null = syncConfigured
  ? createClient(url as string, anonKey as string, {
      auth: {
        /* Keeps the session across reloads without a second storage owner. */
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
