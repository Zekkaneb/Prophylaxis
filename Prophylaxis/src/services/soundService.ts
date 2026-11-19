/**
 * Compatibility adapter over the bundled sound manager.
 *
 * The board and study views historically called `playSound('move' | …)`. Those
 * call sites keep working, but every cue is now one of the nine supplied MP3s
 * and all playback, volume and mute state lives in `play/audio/soundManager`.
 */

import {
  applySoundSettings,
  getSoundSettings,
  playSoundEvent,
  primeSounds,
  setSoundMuted,
  setSoundVolume,
} from '../play/audio/soundManager.ts';
import type { SoundEvent } from '../play/audio/soundEvents.ts';

export type SoundName = 'move' | 'capture' | 'check' | 'illegal' | 'success';

const NAMES: Record<SoundName, SoundEvent> = {
  move: 'move-self',
  capture: 'capture',
  check: 'move-check',
  illegal: 'illegal',
  success: 'game-end',
};

export function isMuted(): boolean {
  return getSoundSettings().muted;
}

export function setMuted(next: boolean): void {
  setSoundMuted(next);
}

export function toggleMuted(): boolean {
  const next = !getSoundSettings().muted;
  setSoundMuted(next);
  return next;
}

export function getVolume(): number {
  return getSoundSettings().volume;
}

export function setVolume(volume: number): void {
  setSoundVolume(volume);
}

/** Applies mute + volume together (used by the settings drawer). */
export function configureSound(next: { muted?: boolean; volume?: number }): void {
  const current = getSoundSettings();
  applySoundSettings({
    muted: next.muted ?? current.muted,
    volume: next.volume ?? current.volume,
  });
}

export function playSound(name: SoundName): void {
  playSoundEvent(NAMES[name]);
}

export { primeSounds };
