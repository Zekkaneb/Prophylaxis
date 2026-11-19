/**
 * The one place sounds are actually played.
 *
 * - One `HTMLAudioElement` per event, created lazily and reused, so a render or
 *   a state update can never allocate audio objects or leave sounds stacking.
 * - The element is rewound before each play: a repeated cue restarts instead of
 *   layering, and a per-event 90ms de-dupe absorbs double state updates.
 * - Volume and mute are applied to every element immediately, so the settings
 *   slider is audible while it moves.
 * - Playback failures (autoplay policy, missing file, decode error) are swallowed:
 *   audio is feedback, never a requirement for playing chess.
 */

import { assetUrl } from '../../assets/assetUrl';
import { SOUND_FILES, shouldPlaySound, type SoundEvent } from './soundEvents.ts';
import {
  loadSoundSettings,
  saveSoundSettings,
  type SoundSettings,
} from './soundSettings.ts';

let settings: SoundSettings = loadSoundSettings();
const elements = new Map<SoundEvent, HTMLAudioElement>();
const failed = new Set<SoundEvent>();
const lastPlayedAt = new Map<SoundEvent, number>();
let primed = false;

export function getSoundSettings(): SoundSettings {
  return { ...settings };
}

/** Applies and persists settings; every cached element updates immediately. */
export function applySoundSettings(next: SoundSettings): SoundSettings {
  settings = saveSoundSettings(next);
  for (const element of elements.values()) {
    element.volume = settings.volume;
    element.muted = settings.muted;
  }
  return getSoundSettings();
}

export function setSoundMuted(muted: boolean): SoundSettings {
  return applySoundSettings({ ...settings, muted });
}

export function setSoundVolume(volume: number): SoundSettings {
  return applySoundSettings({ ...settings, volume });
}

/** Creates the audio elements up front, after a real user gesture. */
export function primeSounds(): void {
  if (primed || typeof Audio === 'undefined') return;
  primed = true;
  for (const event of Object.keys(SOUND_FILES) as SoundEvent[]) ensureElement(event);
}

function ensureElement(event: SoundEvent): HTMLAudioElement | null {
  if (typeof Audio === 'undefined' || failed.has(event)) return null;
  const cached = elements.get(event);
  if (cached) return cached;

  try {
    const element = new Audio(assetUrl(`sounds/${SOUND_FILES[event]}`));
    element.preload = 'auto';
    element.volume = settings.volume;
    element.muted = settings.muted;
    /* A missing or unreadable file disables only that cue. */
    element.addEventListener('error', () => failed.add(event), { once: true });
    elements.set(event, element);
    return element;
  } catch {
    failed.add(event);
    return null;
  }
}

/**
 * Plays one cue. Returns whether a playback attempt was made, which is what
 * the tests and the debug console use; the audio itself is fire-and-forget.
 */
export function playSoundEvent(event: SoundEvent, now = Date.now()): boolean {
  if (settings.muted || settings.volume <= 0) return false;

  const last = lastPlayedAt.get(event) ?? 0;
  if (!shouldPlaySound(last, now)) return false;
  lastPlayedAt.set(event, now);

  const element = ensureElement(event);
  if (!element) return false;

  try {
    element.muted = settings.muted;
    element.volume = settings.volume;
    element.currentTime = 0;
    const playback = element.play();
    if (playback && typeof playback.catch === 'function') {
      playback.catch(() => {
        /* Autoplay refused before the first gesture: the next cue retries. */
      });
    }
    return true;
  } catch {
    return false;
  }
}

/* Browsers only allow media after an interaction; warm the cache on the first. */
if (typeof window !== 'undefined') {
  const unlock = () => primeSounds();
  window.addEventListener('pointerdown', unlock, { once: true, capture: true, passive: true });
  window.addEventListener('keydown', unlock, { once: true, capture: true });
}
