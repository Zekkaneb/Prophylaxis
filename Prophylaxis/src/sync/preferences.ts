import { db } from '../db.ts';
import { recordSyncedChange } from './outbox.ts';

/**
 * Cosmetics and gameplay preferences, synced per account.
 *
 * The app has always kept these in `localStorage` — board palette, piece set,
 * ground, accent, board size, sound, premoves — which is per-device by
 * definition. Here each one gets a row in a synced table, with the same JSON
 * string as its value, so another device can pick it up without the theme code
 * learning about any of this.
 *
 * Writes are deduplicated against the stored row: applying a remote value
 * rewrites `localStorage`, which makes the appearance effect fire again, and
 * without that comparison every pull would immediately push back what it just
 * received.
 */

export type PreferenceKey = 'appearance' | 'sound' | 'premoves';

export const PREFERENCE_KEYS: readonly PreferenceKey[] = ['appearance', 'sound', 'premoves'];

/** The `localStorage` key each preference lives under. */
export const PREFERENCE_STORAGE: Record<PreferenceKey, string> = {
  appearance: 'chess-trainer.appearance.v1',
  sound: 'chess-trainer.sound.settings.v1',
  premoves: 'chess-trainer.premoves.enabled.v1',
};

/** Fired after a remote value is written locally, so the UI can re-read it. */
export const PREFERENCES_APPLIED_EVENT = 'openinglab:preferences-applied';

/**
 * Settings that need more than a `localStorage` write to take effect.
 *
 * Sound is the one: the sound manager keeps its own copy and drives playback
 * from it. Registration keeps that knowledge in the theme layer instead of
 * dragging the audio stack into a sync module.
 */
type PreferenceApplier = (value: string) => void;
const appliers = new Map<string, PreferenceApplier>();

export function registerPreferenceApplier(
  key: PreferenceKey,
  apply: PreferenceApplier | null,
): void {
  if (apply) appliers.set(key, apply);
  else appliers.delete(key);
}

export function isPreferenceKey(key: string): key is PreferenceKey {
  return (PREFERENCE_KEYS as readonly string[]).includes(key);
}

export function readPreference(key: PreferenceKey): string | null {
  try {
    return window.localStorage.getItem(PREFERENCE_STORAGE[key]);
  } catch {
    return null;
  }
}

function writeLocal(key: PreferenceKey, value: string): void {
  try {
    window.localStorage.setItem(PREFERENCE_STORAGE[key], value);
  } catch {
    /* private mode — the value still lives in the synced table */
  }
}

/**
 * Records a preference change, if it is actually a change.
 *
 * Called from the same place that writes `localStorage`, so a user action and a
 * pull that writes the same value cannot ping-pong.
 */
export async function syncPreference(key: PreferenceKey, value: string): Promise<void> {
  try {
    const stored = await db.prefs.get(key);
    if (stored?.value === value) return;
    await db.prefs.put({ key, value });
    await recordSyncedChange('prefs', key, false);
  } catch {
    /* a preferences write must never break the screen it was made from */
  }
}

/** Applies a value that arrived from the server. Runs under `withRemoteApply`. */
export async function applyRemotePreference(key: string, value: string): Promise<void> {
  if (!isPreferenceKey(key) || typeof value !== 'string') return;
  writeLocal(key, value);

  try {
    appliers.get(key)?.(value);
  } catch {
    /* a malformed value from another build: keep the local setting */
  }

  await db.prefs.put({ key, value });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PREFERENCES_APPLIED_EVENT));
  }
}

/**
 * Queues whatever is already in `localStorage` for a preference the table has
 * never seen. Cheap and idempotent: at boot, a device that has been used for
 * months uploads its current look once.
 */
export async function seedPreferences(): Promise<number> {
  let seeded = 0;
  for (const key of PREFERENCE_KEYS) {
    try {
      if (await db.prefs.get(key)) continue;
      const raw = readPreference(key);
      if (raw === null) continue;
      await db.prefs.put({ key, value: raw });
      await recordSyncedChange('prefs', key, false);
      seeded += 1;
    } catch {
      /* best-effort: the setting simply stays device-local */
    }
  }
  return seeded;
}
