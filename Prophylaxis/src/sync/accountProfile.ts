import {
  clampPlayerElo,
  loadPlayerProfile,
  normalisePlayerName,
  type PlayerProfile,
} from '../profile/playerProfile.ts';
import { updatePlayerProfile } from '../profile/usePlayerProfile.ts';
import { supabase, syncConfigured } from './client.ts';
import { syncProfileToAccount } from './profileMirror.ts';

/**
 * The account's own name and rating.
 *
 * They live in Supabase's `user_metadata` — per account, readable by every
 * device, and not part of the synced rows — and are mirrored into the local
 * player profile so the board's nameplate and the dashboard show them without
 * any network call. The `profile` preference carries changes between devices
 * while the app is running; this is what a fresh device reads first.
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
  const elo = Number(metadata.elo);
  const rating = Number.isFinite(elo) && elo > 0 ? clampPlayerElo(elo) : 0;
  if (!firstName && !lastName && !rating) return null;
  return { firstName, lastName, elo: rating };
}

function hasValues(profile: PlayerProfile): boolean {
  return Boolean(profile.firstName || profile.lastName || profile.elo);
}

function sameProfile(a: PlayerProfile, b: PlayerProfile): boolean {
  return (
    a.firstName === b.firstName && a.lastName === b.lastName && a.elo === b.elo
  );
}

/**
 * Reconciles the account with the local profile at boot.
 *
 * Account wins when it has anything to say — that is the value every device
 * shares. An account that has never held a name (one made before this existed,
 * or before the form was filled in) takes the local profile instead, so nobody
 * has to retype their name after signing in.
 */
export async function applySignedInProfile(): Promise<void> {
  if (!syncConfigured || !supabase) return;

  try {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;

    const fromAccount = profileFromMetadata(data.session.user.user_metadata);
    const local = loadPlayerProfile();

    if (fromAccount) {
      if (!sameProfile(fromAccount, local)) updatePlayerProfile(fromAccount);
      return;
    }

    if (hasValues(local)) await syncProfileToAccount(local);
  } catch {
    /* cosmetic: the local profile simply keeps its current value */
  }
}
