import { backfillSyncedRows, ensureDatabaseFor, LOCAL_OWNER } from './accountDatabase.ts';
import { applySignedInProfile } from './accountProfile.ts';
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

  try {
    await ensureDatabaseFor(owner);
  } catch (cause) {
    /* A failed switch leaves the app on the anonymous database: usable, just
       not synced. Never fatal. */
    if (import.meta.env.DEV) console.warn('[sync] could not open the account database', cause);
  }
}

/**
 * Second boot step: queue rows that were saved before their table synced.
 * Kept separate from the database switch so a failure here cannot stop the app
 * from opening the right database.
 */
export async function bootstrapSyncQueue(): Promise<void> {
  if (!syncConfigured || !supabase) return;
  try {
    await seedPreferences();
    await backfillSyncedRows();
  } catch (cause) {
    if (import.meta.env.DEV) console.warn('[sync] could not queue existing rows', cause);
  }

  /* The account's own name and rating belong on the nameplate even before the
     first sync round trip. */
  await applySignedInProfile();
}
