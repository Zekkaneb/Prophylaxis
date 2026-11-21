/**
 * Whether premoves are enabled, persisted locally.
 *
 * Premoves used to be unconditional; chess.com puts them behind a gameplay
 * setting, and so does this. The preference is read at mount and kept in sync
 * across tabs through a storage event, so the toggle in the settings drawer and
 * the board view never disagree.
 */

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'chess-trainer.premoves.enabled.v1';
const CHANGE_EVENT = 'chess-trainer:premoves-changed';

/** Premoves are on by default: they are a core part of playing with a clock. */
export function loadPremovesEnabled(): boolean {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === null ? true : raw === '1';
  } catch {
    /* Private mode: settings stay in memory and the default wins. */
    return true;
  }
}

export function savePremovesEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    /* Private mode. */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Reactive read of the preference for a component. */
export function usePremovesEnabled(): boolean {
  const [enabled, setEnabled] = useState(loadPremovesEnabled);

  useEffect(() => {
    const sync = () => setEnabled(loadPremovesEnabled());
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return enabled;
}
