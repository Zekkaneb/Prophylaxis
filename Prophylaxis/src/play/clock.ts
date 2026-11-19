import type { PlayColor } from './types.ts';

/**
 * Timestamp-based chess clock.
 *
 * The clock never decrements a counter on a timer tick: it stores when the
 * active side's turn started and derives the remaining time from
 * `now - lastTick` whenever it is read. A throttled or backgrounded tab can
 * therefore never gain or lose time, and the display render rate has no effect
 * on the stored values.
 *
 * Responsibilities kept here (not in the React view):
 * - first move starts the opponent's clock (neither side is charged before it);
 * - a completed move charges the mover and applies Fischer increment;
 * - pause/resume for a suspended side (and for leaving the board view);
 * - timeout detection;
 * - rebuilding a clock from a persisted snapshot.
 */

export interface ClockSnapshot {
  whiteMs: number;
  blackMs: number;
  /** Side whose clock is running, or null before the first move / while paused. */
  active: PlayColor | null;
  running: boolean;
  /** Side that has run out, if any. */
  flagged: PlayColor | null;
}

const EMPTY: ClockSnapshot = {
  whiteMs: 0,
  blackMs: 0,
  active: null,
  running: false,
  flagged: null,
};

export interface ChessClockState {
  whiteMs: number;
  blackMs: number;
  incrementMs: number;
  /** Running side, or null while paused / before the first move. */
  active: PlayColor | null;
  /** Side to restore when the clock resumes; normally equals `active`. */
  pausedSide?: PlayColor | null;
  started: boolean;
}

export class ChessClock {
  private whiteMs: number;
  private blackMs: number;
  private incrementMs: number;
  private active: PlayColor | null = null;
  /** Remembers the side to restore after a pause. */
  private pausedSide: PlayColor | null = null;
  private lastTick = 0;
  private started = false;

  constructor(initialSeconds: number, incrementSeconds: number) {
    const initial = Math.max(0, Math.round(initialSeconds * 1000));
    this.whiteMs = initial;
    this.blackMs = initial;
    this.incrementMs = Math.max(0, Math.round(incrementSeconds * 1000));
  }

  get increment(): number {
    return this.incrementMs;
  }

  /** Whether the first move has armed the clock. */
  get isStarted(): boolean {
    return this.started;
  }

  /** Arms the clock for White without charging anyone. Idempotent. */
  start(now: number): void {
    if (this.started) return;
    this.started = true;
    this.active = 'w';
    this.lastTick = now;
  }

  /**
   * Records a completed move by `mover`: charge their elapsed time, add the
   * increment, then hand the clock to `next`.
   */
  afterMove(mover: PlayColor, next: PlayColor, now: number): ClockSnapshot {
    if (!this.started) this.start(now);

    if (this.active === mover) {
      const elapsed = Math.max(0, now - this.lastTick);
      if (mover === 'w') this.whiteMs = Math.max(0, this.whiteMs - elapsed);
      else this.blackMs = Math.max(0, this.blackMs - elapsed);
    }

    if (mover === 'w') this.whiteMs += this.incrementMs;
    else this.blackMs += this.incrementMs;

    this.active = next;
    this.pausedSide = null;
    this.lastTick = now;
    return this.snapshot(now);
  }

  /** Freezes the clock (leaving the board view). Time already spent is banked. */
  pause(now: number): ClockSnapshot {
    if (this.active) {
      const elapsed = Math.max(0, now - this.lastTick);
      if (this.active === 'w') this.whiteMs = Math.max(0, this.whiteMs - elapsed);
      else this.blackMs = Math.max(0, this.blackMs - elapsed);
      this.pausedSide = this.active;
      this.active = null;
    }
    return this.snapshot(now);
  }

  /** Restarts the paused side's clock. Does nothing before the first move. */
  resume(now: number): ClockSnapshot {
    if (this.active || !this.started || !this.pausedSide) return this.snapshot(now);
    this.active = this.pausedSide;
    this.pausedSide = null;
    this.lastTick = now;
    return this.snapshot(now);
  }

  /** Stops for good (game over). No further time is charged. */
  stop(): void {
    if (this.active) {
      this.pausedSide = null;
      this.active = null;
    }
  }

  /** Current values without mutating anything. Safe to call every frame. */
  snapshot(now: number): ClockSnapshot {
    let whiteMs = this.whiteMs;
    let blackMs = this.blackMs;

    if (this.active && this.started) {
      const elapsed = Math.max(0, now - this.lastTick);
      if (this.active === 'w') whiteMs = Math.max(0, whiteMs - elapsed);
      else blackMs = Math.max(0, blackMs - elapsed);
    }

    const flagged: PlayColor | null = whiteMs <= 0 ? 'w' : blackMs <= 0 ? 'b' : null;

    return {
      whiteMs: Math.max(0, whiteMs),
      blackMs: Math.max(0, blackMs),
      active: this.active,
      running: this.started && this.active !== null,
      flagged,
    };
  }

  /** Convenience for an untimed game / empty state. */
  static empty(): ClockSnapshot {
    return { ...EMPTY };
  }

  /**
   * Rebuilds a clock from a stored snapshot. The caller has already decided
   * whether the clock is running or paused (see `recoverClock`).
   */
  static restore(state: ChessClockState, now: number): ChessClock {
    const clock = new ChessClock(0, 0);
    clock.whiteMs = Math.max(0, Math.round(state.whiteMs));
    clock.blackMs = Math.max(0, Math.round(state.blackMs));
    clock.incrementMs = Math.max(0, Math.round(state.incrementMs));
    clock.started = state.started;
    clock.active = state.started ? state.active : null;
    clock.pausedSide = state.started ? (state.pausedSide ?? null) : null;
    clock.lastTick = now;
    return clock;
  }
}

/* -------------------------------------------------------------------------- */
/*                             Recovery from disk                             */
/* -------------------------------------------------------------------------- */

export interface ClockRecoveryInput {
  whiteMs: number;
  blackMs: number;
  active: PlayColor | null;
  started: boolean;
  paused: boolean;
  /** Epoch ms of the persisted reading. */
  savedAt: number;
}

export interface ClockRecoveryOptions {
  now: number;
  /**
   * Side whose clock keeps running while the app is away. The player's clock
   * does; the bot's does not, because no engine search happens while the app is
   * closed — charging it would be a deduction the bot never spent.
   */
  chargeSide: PlayColor | null;
}

export interface ClockRecovery extends ClockSnapshot {
  /** `true` when the elapsed time was charged to `chargeSide`. */
  charged: boolean;
}

/**
 * Restores clock values after a reload.
 *
 * Policy (also documented in the Play section):
 * - a paused clock is restored exactly as saved;
 * - a running clock belonging to `chargeSide` is charged the real elapsed time,
 *   so closing the tab never buys thinking time;
 * - a running clock belonging to anyone else is restored untouched, so the bot
 *   never flags while the app is closed;
 * - remaining time never goes below zero, and a side that reaches zero is
 *   reported as flagged instead of a negative number.
 */
export function recoverClock(
  input: ClockRecoveryInput,
  options: ClockRecoveryOptions,
): ClockRecovery {
  let whiteMs = Math.max(0, input.whiteMs);
  let blackMs = Math.max(0, input.blackMs);
  let charged = false;

  if (
    !input.paused &&
    input.started &&
    input.active !== null &&
    input.active === options.chargeSide
  ) {
    const elapsed = Math.max(0, options.now - input.savedAt);
    charged = elapsed > 0;
    if (input.active === 'w') whiteMs = Math.max(0, whiteMs - elapsed);
    else blackMs = Math.max(0, blackMs - elapsed);
  }

  const flagged: PlayColor | null = whiteMs <= 0 ? 'w' : blackMs <= 0 ? 'b' : null;

  return {
    whiteMs,
    blackMs,
    active: input.active,
    running: input.started && input.active !== null && !flagged,
    flagged,
    charged,
  };
}
