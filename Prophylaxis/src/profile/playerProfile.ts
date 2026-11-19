/**
 * The player's own profile: the name and rating printed on their side of the
 * board.
 *
 * Stored as one JSON value in `localStorage`, following the same pattern as the
 * sound and review settings: a tolerant parser, a normaliser that clamps, and no
 * React in the module so the rules stay testable in Node.
 *
 * The defaults reproduce the name the app shipped with, so an untouched profile
 * behaves exactly as before.
 */

export interface PlayerProfile {
  firstName: string;
  lastName: string;
  /** Display rating. A label on the player's side, never an engine setting. */
  elo: number;
}

export interface ProfileStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const PLAYER_PROFILE_KEY = 'opening-lab.player-profile.v1';

/** Long enough for a full name, short enough to sit in a nameplate. */
export const PLAYER_NAME_MAX = 32;

export const PLAYER_ELO_RANGE = { min: 100, max: 3000 } as const;

export const DEFAULT_PLAYER_PROFILE: PlayerProfile = Object.freeze({
  firstName: '',
  lastName: '',
  elo: 0,
});

/** Collapses whitespace, trims, and caps the length. */
export function normalisePlayerName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, PLAYER_NAME_MAX);
}

export function clampPlayerElo(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_PLAYER_PROFILE.elo;
  const clamped = Math.min(PLAYER_ELO_RANGE.max, Math.max(PLAYER_ELO_RANGE.min, numeric));
  return Math.round(clamped);
}

/**
 * A profile that can always be printed: blank names fall back to the defaults,
 * so saving an empty form never leaves the board without a name.
 */
export function normalisePlayerProfile(input: {
  firstName?: unknown;
  lastName?: unknown;
  elo?: unknown;
} | null | undefined): PlayerProfile {
  const firstName = normalisePlayerName(input?.firstName);
  const lastName = normalisePlayerName(input?.lastName);
  if (!firstName && !lastName) return { ...DEFAULT_PLAYER_PROFILE };
  return { firstName, lastName, elo: clampPlayerElo(input?.elo) };
}

export function parsePlayerProfile(raw: string | null): PlayerProfile {
  if (!raw) return { ...DEFAULT_PLAYER_PROFILE };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_PLAYER_PROFILE };
    return normalisePlayerProfile(parsed as Record<string, unknown>);
  } catch {
    return { ...DEFAULT_PLAYER_PROFILE };
  }
}

export function loadPlayerProfile(storage?: ProfileStorage | null): PlayerProfile {
  const store = storage ?? safeStorage();
  if (!store) return { ...DEFAULT_PLAYER_PROFILE };
  try {
    return parsePlayerProfile(store.getItem(PLAYER_PROFILE_KEY));
  } catch {
    return { ...DEFAULT_PLAYER_PROFILE };
  }
}

/** Writes the profile; returns the normalised value actually stored. */
export function savePlayerProfile(
  profile: PlayerProfile,
  storage?: ProfileStorage | null,
): PlayerProfile {
  const normalised = normalisePlayerProfile(profile);
  const store = storage ?? safeStorage();
  try {
    store?.setItem(PLAYER_PROFILE_KEY, JSON.stringify(normalised));
  } catch {
    /* private mode — the profile stays in memory */
  }
  return normalised;
}

export function playerDisplayName(profile: PlayerProfile): string {
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
  return name || DEFAULT_PLAYER_PROFILE.firstName;
}

export function playerInitials(profile: PlayerProfile): string {
  const first = profile.firstName.trim().charAt(0);
  const last = profile.lastName.trim().charAt(0);
  return `${first}${last}`.toUpperCase() || 'P';
}

function safeStorage(): ProfileStorage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}
