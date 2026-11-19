/**
 * Sound preferences: master mute and master volume.
 *
 * Stored as one JSON value in `localStorage` so a reload keeps both. The parser
 * is tolerant (bad JSON, out-of-range volume, the legacy mute-only key) and is
 * pure, which keeps it testable in Node.
 */

export interface SoundSettings {
  muted: boolean;
  volume: number;
}

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const SOUND_SETTINGS_KEY = 'chess-trainer.sound.settings.v1';

/** The mute-only key used before volume existed. Read once, then superseded. */
export const LEGACY_MUTE_KEY = 'chess-trainer.sound.muted.v1';

export const DEFAULT_SOUND_SETTINGS: SoundSettings = Object.freeze({
  muted: false,
  volume: 0.7,
});

/** A finite number in [0, 1], rounded to two decimals. */
export function clampVolume(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_SOUND_SETTINGS.volume;
  const clamped = Math.min(1, Math.max(0, numeric));
  return Math.round(clamped * 100) / 100;
}

export function parseSoundSettings(raw: string | null): SoundSettings {
  if (!raw) return { ...DEFAULT_SOUND_SETTINGS };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_SOUND_SETTINGS };
    const record = parsed as { muted?: unknown; volume?: unknown };
    return {
      muted: record.muted === true,
      volume: clampVolume(record.volume ?? DEFAULT_SOUND_SETTINGS.volume),
    };
  } catch {
    return { ...DEFAULT_SOUND_SETTINGS };
  }
}

/** Reads settings, falling back to the legacy mute flag when there is no blob. */
export function loadSoundSettings(storage?: SettingsStorage | null): SoundSettings {
  const store = storage ?? safeStorage();
  if (!store) return { ...DEFAULT_SOUND_SETTINGS };
  let raw: string | null = null;
  try {
    raw = store.getItem(SOUND_SETTINGS_KEY);
  } catch {
    return { ...DEFAULT_SOUND_SETTINGS };
  }
  if (raw) return parseSoundSettings(raw);

  try {
    if (store.getItem(LEGACY_MUTE_KEY) === '1') {
      return { ...DEFAULT_SOUND_SETTINGS, muted: true };
    }
  } catch {
    /* storage is optional */
  }
  return { ...DEFAULT_SOUND_SETTINGS };
}

/** Writes settings; returns the normalised value actually stored. */
export function saveSoundSettings(
  settings: SoundSettings,
  storage?: SettingsStorage | null,
): SoundSettings {
  const normalised: SoundSettings = {
    muted: settings.muted === true,
    volume: clampVolume(settings.volume),
  };
  const store = storage ?? safeStorage();
  try {
    store?.setItem(SOUND_SETTINGS_KEY, JSON.stringify(normalised));
  } catch {
    /* private mode — settings stay in memory */
  }
  return normalised;
}

function safeStorage(): SettingsStorage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}
