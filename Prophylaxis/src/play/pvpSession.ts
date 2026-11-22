import type { PvpTimeControl } from './pvp.ts';
import { pvpTimeControlLabel } from './pvp.ts';

/**
 * The room this device was last in.
 *
 * Leaving a game — closing the tab, changing screens, losing the connection —
 * must not cost the game: the code is kept here, with the seat that was held, so
 * the lobby can offer to rejoin the same room. Nothing about the position is
 * stored: the other client owns the game and hands it over on request.
 */

const SESSION_KEY = 'opening-lab.pvp-session.v1';

export interface PvpSession {
  code: string;
  role: 'host' | 'guest';
  control: PvpTimeControl;
  /** Epoch ms when the game began, so a stale offer can be aged out. */
  startedAt: number;
}

function isControl(value: unknown): value is PvpTimeControl {
  if (!value || typeof value !== 'object') return false;
  const control = value as Partial<PvpTimeControl>;
  return (
    typeof control.initialSeconds === 'number' &&
    typeof control.bonusSeconds === 'number' &&
    typeof control.bonusType === 'string' &&
    typeof control.untimed === 'boolean'
  );
}

export function loadPvpSession(): PvpSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PvpSession> | null;
    if (!parsed || typeof parsed.code !== 'string' || !parsed.code) return null;
    if (parsed.role !== 'host' && parsed.role !== 'guest') return null;
    if (!isControl(parsed.control)) return null;
    const startedAt = typeof parsed.startedAt === 'number' ? parsed.startedAt : Date.now();
    /* Two days is long past any game this app will still be holding. */
    if (Date.now() - startedAt > 2 * 24 * 60 * 60 * 1000) {
      clearPvpSession();
      return null;
    }
    return { code: parsed.code, role: parsed.role, control: parsed.control, startedAt };
  } catch {
    return null;
  }
}

export function savePvpSession(session: PvpSession): void {
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* private mode: the offer to rejoin is simply not made */
  }
}

export function clearPvpSession(): void {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* nothing to do */
  }
}

/** "5+3 · Increment (Fischer)" for the rejoin card. */
export function sessionLabel(control: PvpTimeControl): string {
  return pvpTimeControlLabel(control);
}
