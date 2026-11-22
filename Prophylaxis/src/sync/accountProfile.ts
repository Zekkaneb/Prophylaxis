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
    a.firstName === b.firstName &&
    a.lastName === b.lastName &&
    a.elo === b.elo &&
    a.avatar === b.avatar
  );
}

/**
 * What this device's player profile looked like before an account was applied.
 *
 * Signing in copies the account's name onto the nameplate; signing out has to
 * give the name back to whoever was using the device before, so the account's
 * identity never lingers in the top corner or on the board.
 */
const PRE_ACCOUNT_PROFILE_KEY = 'opening-lab.profile-before-account.v1';

/**
 * Remembers the device's own profile before an account takes the nameplate.
 *
 * Called whenever the app moves *onto* an account database, so it is in place
 * before any account value can reach storage — including a `profile`
 * preference pulled from another device. An existing snapshot is kept: the
 * first one is the real "before".
 */
export function rememberLocalProfile(): void {
  try {
    if (window.localStorage.getItem(PRE_ACCOUNT_PROFILE_KEY) !== null) return;
    window.localStorage.setItem(
      PRE_ACCOUNT_PROFILE_KEY,
      JSON.stringify(loadPlayerProfile()),
    );
  } catch {
    /* storage is optional */
  }
}

/** Restores the device's own profile after a sign-out. Safe to call twice. */
export function restoreLocalProfileAfterSignOut(): void {
  try {
    const raw = window.localStorage.getItem(PRE_ACCOUNT_PROFILE_KEY);
    if (!raw) return;
    window.localStorage.removeItem(PRE_ACCOUNT_PROFILE_KEY);
    updatePlayerProfile(JSON.parse(raw) as PlayerProfile);
  } catch {
    /* an unreadable snapshot is simply dropped */
  }
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
      /* The account holds the name and rating, never the picture: it is too big
         for `user_metadata` and belongs to this device. Applying the account's
         values must therefore keep the local photo, or every boot would wipe
         the face the player chose. */
      const merged: PlayerProfile = local.avatar
        ? { ...fromAccount, avatar: local.avatar }
        : fromAccount;
      if (!sameProfile(merged, local)) updatePlayerProfile(merged);
      return;
    }

    if (hasValues(local)) await syncProfileToAccount(local);
  } catch {
    /* cosmetic: the local profile simply keeps its current value */
  }
}
