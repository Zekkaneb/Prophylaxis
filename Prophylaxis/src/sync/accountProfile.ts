import { clampPlayerElo, normalisePlayerName } from '../profile/playerProfile.ts';
import { updatePlayerProfile } from '../profile/usePlayerProfile.ts';
import { supabase, syncConfigured } from './client.ts';

/**
 * The account's own name and rating.
 *
 * They live in Supabase's `user_metadata` — per account, readable by every
 * device, and not part of the synced rows — and are mirrored into the local
 * player profile so the board's nameplate and the dashboard show them without
 * any network call.
 */

export interface AccountProfile {
  firstName: string;
  lastName: string;
  /** Display rating, never an engine setting. 0 means "not set". */
  elo: number;
}

export function profileFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): AccountProfile | null {
  if (!metadata) return null;
  const firstName = normalisePlayerName(metadata.first_name);
  const lastName = normalisePlayerName(metadata.last_name);
  if (!firstName && !lastName) return null;
  const elo = Number(metadata.elo);
  return {
    firstName,
    lastName,
    elo: Number.isFinite(elo) && elo > 0 ? clampPlayerElo(elo) : 0,
  };
}

/** The shape `supabase.auth.updateUser({ data })` and sign-up both expect. */
export function metadataFor(profile: AccountProfile): Record<string, unknown> {
  return {
    first_name: profile.firstName,
    last_name: profile.lastName,
    elo: profile.elo,
  };
}

/** Copies the signed-in account's name and rating into the local profile. */
export async function applySignedInProfile(): Promise<void> {
  if (!syncConfigured || !supabase) return;
  try {
    const { data } = await supabase.auth.getSession();
    const profile = profileFromMetadata(data.session?.user.user_metadata);
    if (profile) updatePlayerProfile(profile);
  } catch {
    /* cosmetic: the local profile simply keeps its current value */
  }
}
