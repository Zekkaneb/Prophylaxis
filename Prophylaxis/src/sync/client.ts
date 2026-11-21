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

const url = env.VITE_SUPABASE_URL?.trim();
const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim();

export const syncConfigured = Boolean(url && anonKey);

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
