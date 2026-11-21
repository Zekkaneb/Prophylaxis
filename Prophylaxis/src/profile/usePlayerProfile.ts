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
import { PREFERENCES_APPLIED_EVENT, syncPreference } from '../sync/preferences.ts';

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
  /* Name and rating travel with the account too: as a synced preference, so a
     change on one device reaches the other without a reload. */
  void syncPreference('profile', JSON.stringify(snapshot));
  return snapshot;
}

/* A profile that arrived from another device is already in storage; pick it up
   so the nameplate follows without a reload. */
if (typeof window !== 'undefined') {
  window.addEventListener(PREFERENCES_APPLIED_EVENT, () => {
    const fromStorage = loadPlayerProfile();
    if (
      fromStorage.firstName === snapshot.firstName &&
      fromStorage.lastName === snapshot.lastName &&
      fromStorage.elo === snapshot.elo &&
      fromStorage.avatar === snapshot.avatar
    ) {
      return;
    }
    snapshot = fromStorage;
    for (const listener of listeners) listener();
  });
}

export function usePlayerProfile(): PlayerProfile {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
