/**
 * Live access to the player profile.
 *
 * One module-level snapshot, one listener set: the Dashboard writes through
 * `updatePlayerProfile` and any mounted board re-renders with the new name,
 * without either screen knowing about the other. React lives here so the rules
 * in `playerProfile.ts` stay importable from plain Node tests.
 */

import { useSyncExternalStore } from 'react';
import {
  loadPlayerProfile,
  savePlayerProfile,
  type PlayerProfile,
} from './playerProfile.ts';

let snapshot: PlayerProfile = loadPlayerProfile();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): PlayerProfile {
  return snapshot;
}

/** Saves through the normaliser and tells every mounted screen. */
export function updatePlayerProfile(next: PlayerProfile): PlayerProfile {
  snapshot = savePlayerProfile(next);
  for (const listener of listeners) listener();
  return snapshot;
}

export function usePlayerProfile(): PlayerProfile {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
