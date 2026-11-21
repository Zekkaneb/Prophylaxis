import {
  normalisePlayerName,
  type PlayerProfile,
} from '../profile/playerProfile.ts';
import { supabase, syncConfigured } from './client.ts';

/**
 * Keeps the account's `user_metadata` in step with the local profile.
 *
 * The synced `profile` preference carries name and rating between devices, but
 * the account itself should also hold them: they are what a brand-new device
 * reads before its first sync round trip, and what the account panel shows.
 * Asked as a single place so `profileMirror` stays free of the profile store
 * and `usePlayerProfile` stays free of Supabase.
 */

/** The shape `supabase.auth.updateUser({ data })` and sign-up both expect. */
export function metadataFor(profile: PlayerProfile): Record<string, unknown> {
  return {
    first_name: profile.firstName,
    last_name: profile.lastName,
    elo: profile.elo,
  };
}

export async function syncProfileToAccount(profile: PlayerProfile): Promise<string | null> {
  if (!syncConfigured || !supabase) return null;

  try {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user) return null;

    const current = user.user_metadata ?? {};
    const unchanged =
      normalisePlayerName(current.first_name) === profile.firstName &&
      normalisePlayerName(current.last_name) === profile.lastName &&
      Number(current.elo ?? 0) === profile.elo;
    if (unchanged) return null;

    const { error } = await supabase.auth.updateUser({ data: metadataFor(profile) });
    return error ? error.message : null;
  } catch (cause) {
    return cause instanceof Error ? cause.message : 'Could not update the account.';
  }
}
