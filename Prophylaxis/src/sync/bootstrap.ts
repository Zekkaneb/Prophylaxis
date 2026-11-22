import { backfillSyncedRows, ensureDatabaseFor, LOCAL_OWNER } from './accountDatabase.ts';
import { applySignedInProfile, rememberLocalProfile } from './accountProfile.ts';
import { seedPreferences } from './preferences.ts';
import { supabase, syncConfigured } from './client.ts';

/**
 * Opens the right local database before the app renders.
 *
 * Reading the stored session is a local read, but it is still async, so it
 * happens once at boot with a short timeout: a signed-in browser lands in its
 * own database on the first paint, instead of starting on the anonymous one and
 * having to reload.
 */

const BOOT_TIMEOUT_MS = 3000;

async function storedOwner(): Promise<string> {
  if (!syncConfigured || !supabase) return LOCAL_OWNER;

  try {
    const session = await Promise.race([
      supabase.auth.getSession(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), BOOT_TIMEOUT_MS)),
    ]);
    return session?.data.session?.user?.id ?? LOCAL_OWNER;
  } catch {
    return LOCAL_OWNER;
  }
}

export async function bootstrapDatabase(): Promise<void> {
  const owner = await storedOwner();
  if (owner === LOCAL_OWNER) return;

  /* The device's own profile is remembered before the account's name can
     replace it, so signing out later has something to restore. */
  rememberLocalProfile();

  try {
    await ensureDatabaseFor(owner);
  } catch (cause) {
    /* A failed switch leaves the app on the anonymous database: usable, just
       not synced. Never fatal. */
    if (import.meta.env.DEV) console.warn('[sync] could not open the account database', cause);
  }
}

/**
 * Puts the synced appearance settings in place before the first frame, so a
 * device that changed theme elsewhere does not flash the default one. Local
 * reads only.
 */
export async function bootstrapPreferences(): Promise<void> {
  if (!syncConfigured || !supabase) return;
  try {
    await seedPreferences();
  } catch (cause) {
    if (import.meta.env.DEV) console.warn('[sync] could not seed preferences', cause);
  }
}

/**
 * Remaining boot work: queue rows that were saved before their table synced,
 * and put the account's name on the nameplate. Runs after the first frame —
 * the backfill walks the whole library and the profile read touches the
 * network, so neither may hold up (or blank) the page.
 */
export async function bootstrapSyncQueue(): Promise<void> {
  if (!syncConfigured || !supabase) return;
  try {
    await backfillSyncedRows();
  } catch (cause) {
    if (import.meta.env.DEV) console.warn('[sync] could not queue existing rows', cause);
  }

  await applySignedInProfile();
}
