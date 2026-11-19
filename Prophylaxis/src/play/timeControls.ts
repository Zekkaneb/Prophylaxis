/**
 * Time controls: the presets offered on the setup screen, notation helpers and
 * validation for the custom control.
 *
 * Times are stored in seconds; display uses the standard `minutes+increment`
 * notation ("5+3") and a `m:ss` clock (hours appear only when needed).
 */

export type TimeControlCategory = 'bullet' | 'blitz' | 'rapid' | 'untimed' | 'custom';

export interface TimeControlPreset {
  id: string;
  category: Exclude<TimeControlCategory, 'untimed' | 'custom'>;
  initialSeconds: number;
  incrementSeconds: number;
}

export const TIME_CONTROL_PRESETS: readonly TimeControlPreset[] = [
  { id: '1+0', category: 'bullet', initialSeconds: 60, incrementSeconds: 0 },
  { id: '1+1', category: 'bullet', initialSeconds: 60, incrementSeconds: 1 },
  { id: '3+0', category: 'blitz', initialSeconds: 180, incrementSeconds: 0 },
  { id: '3+2', category: 'blitz', initialSeconds: 180, incrementSeconds: 2 },
  { id: '5+0', category: 'blitz', initialSeconds: 300, incrementSeconds: 0 },
  { id: '10+0', category: 'rapid', initialSeconds: 600, incrementSeconds: 0 },
  { id: '10+5', category: 'rapid', initialSeconds: 600, incrementSeconds: 5 },
  { id: '15+10', category: 'rapid', initialSeconds: 900, incrementSeconds: 10 },
] as const;

export const UNTIMED_ID = 'untimed';
export const CUSTOM_ID = 'custom';

export const CATEGORY_LABELS: Record<
  Exclude<TimeControlCategory, 'untimed' | 'custom'>,
  string
> = {
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
};

/** "5+3", "10+0", "1+0". */
export function formatTimeControl(initialSeconds: number, incrementSeconds: number): string {
  const minutes = Math.round((initialSeconds / 60) * 10) / 10;
  const base = Number.isInteger(minutes) ? String(minutes) : String(minutes);
  return `${base}+${incrementSeconds}`;
}

/**
 * `m:ss` (or `h:mm:ss` past an hour). Rounds up, so a fresh 5+0 game reads
 * 5:00 and a flagged clock reads 0:00.
 */
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export interface CustomTimeResult {
  ok: boolean;
  error?: string;
  initialSeconds: number;
  incrementSeconds: number;
}

/** Validates the custom control: 1–180 minutes, 0–60 seconds of increment. */
export function validateCustomTime(minutesInput: string, incrementInput: string): CustomTimeResult {
  const minutes = Number(minutesInput);
  const increment = Number(incrementInput);

  if (!Number.isFinite(minutes) || !Number.isInteger(minutes)) {
    return { ok: false, error: 'Enter whole minutes.', initialSeconds: 0, incrementSeconds: 0 };
  }
  if (minutes < 1 || minutes > 180) {
    return {
      ok: false,
      error: 'Starting time must be between 1 and 180 minutes.',
      initialSeconds: 0,
      incrementSeconds: 0,
    };
  }
  if (!Number.isFinite(increment) || !Number.isInteger(increment)) {
    return { ok: false, error: 'Enter a whole-second increment.', initialSeconds: 0, incrementSeconds: 0 };
  }
  if (increment < 0 || increment > 60) {
    return {
      ok: false,
      error: 'Increment must be between 0 and 60 seconds.',
      initialSeconds: 0,
      incrementSeconds: 0,
    };
  }

  return {
    ok: true,
    initialSeconds: minutes * 60,
    incrementSeconds: increment,
  };
}

/** Total time on the clock at the start, used for history labels. */
export function timeControlLabel(initialSeconds: number, incrementSeconds: number): string {
  return initialSeconds <= 0 ? 'Untimed' : formatTimeControl(initialSeconds, incrementSeconds);
}

/** "Nov 18, 2026, 09:41" — when a saved game was played. */
export function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "4m 12s", "38s", "1h 03m" — game duration in history rows. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}
