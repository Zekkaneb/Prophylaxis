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

/**
 * How the bonus on a completed move is delivered.
 *
 * - `fischer` — the bonus is added as soon as the move lands, so the clock can
 *   never run dry while the player is thinking about the next one.
 * - `simple` — the bonus is free time at the *start* of a turn: the main clock
 *   is frozen until the delay is used up, and nothing is added back.
 * - `bronstein` — the clock runs from the first millisecond, and up to the
 *   bonus is handed back when the move lands.
 * - `none` — the clock simply runs.
 */
export type BonusType = 'none' | 'fischer' | 'simple' | 'bronstein';

export interface ClockSnapshot {
  whiteMs: number;
  blackMs: number;
  /** Side whose clock is running, or null before the first move / while paused. */
  active: PlayColor | null;
  running: boolean;
  /** Side that has run out, if any. */
  flagged: PlayColor | null;
  /** Free seconds left before the active side's main clock starts moving. */
  delayMs: number;
  /** True while the active side is still spending its free time. */
  inDelay: boolean;
}

const EMPTY: ClockSnapshot = {
  whiteMs: 0,
  blackMs: 0,
  active: null,
  running: false,
  flagged: null,
  delayMs: 0,
  inDelay: false,
};

export interface ChessClockState {
  whiteMs: number;
  blackMs: number;
  incrementMs: number;
  /** Absent on rows written before delay clocks existed: those were Fischer. */
  bonusType?: BonusType;
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
  private bonusType: BonusType;
  /** Free time left on the running side's turn (simple delay only). */
  private delayMs = 0;
  private active: PlayColor | null = null;
  /** Remembers the side to restore after a pause. */
  private pausedSide: PlayColor | null = null;
  private lastTick = 0;
  private started = false;

  constructor(initialSeconds: number, incrementSeconds: number, bonusType: BonusType = 'fischer') {
    const initial = Math.max(0, Math.round(initialSeconds * 1000));
    this.whiteMs = initial;
    this.blackMs = initial;
    this.incrementMs = Math.max(0, Math.round(incrementSeconds * 1000));
    this.bonusType = bonusType;
  }

  get increment(): number {
    return this.incrementMs;
  }

  get bonus(): BonusType {
    return this.bonusType;
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
    this.delayMs = this.bonusType === 'simple' ? this.incrementMs : 0;
  }

  /**
   * Charges the running side for `elapsed` milliseconds.
   *
   * Simple delay spends its free time first, so only the remainder of the turn
   * reaches the main clock; every other bonus type is charged from the first
   * millisecond (Bronstein hands its share back when the move lands).
   */
  private chargeElapsed(elapsed: number, side: PlayColor): void {
    const charged =
      this.bonusType === 'simple' ? Math.max(0, elapsed - this.delayMs) : elapsed;
    if (this.bonusType === 'simple') {
      this.delayMs = Math.max(0, this.delayMs - elapsed);
    }
    if (side === 'w') this.whiteMs = Math.max(0, this.whiteMs - charged);
    else this.blackMs = Math.max(0, this.blackMs - charged);
  }

  /**
   * Records a completed move by `mover`: charge their elapsed time, add the
   * increment, then hand the clock to `next`.
   */
  afterMove(mover: PlayColor, next: PlayColor, now: number): ClockSnapshot {
    if (!this.started) this.start(now);

    const elapsed = this.active === mover ? Math.max(0, now - this.lastTick) : 0;
    if (this.active === mover) this.chargeElapsed(elapsed, mover);

    if (this.bonusType === 'fischer') {
      if (mover === 'w') this.whiteMs += this.incrementMs;
      else this.blackMs += this.incrementMs;
    } else if (this.bonusType === 'bronstein') {
      /* Bronstein gives back what was actually spent, never more than the
         bonus: a player who thought for a second gets that second back. */
      const refund = Math.min(elapsed, this.incrementMs);
      if (mover === 'w') this.whiteMs += refund;
      else this.blackMs += refund;
    }

    this.active = next;
    this.pausedSide = null;
    this.lastTick = now;
    this.delayMs = this.bonusType === 'simple' ? this.incrementMs : 0;
    return this.snapshot(now);
  }

  /**
   * Charges a fixed cost to `side` - a premove's tenth of a second.
   *
   * Elapsed time is banked first, so the running clock is not charged twice,
   * then the cost is taken. A side that does not have the cost does not pay it
   * and the call returns `false`: the clock freezes at the cost and the caller
   * must not play the premove.
   */
  penalize(side: PlayColor, ms: number, now: number): boolean {
    if (!this.started) this.start(now);
    const cost = Math.max(0, Math.round(ms));

    if (this.active === side) {
      const elapsed = Math.max(0, now - this.lastTick);
      this.chargeElapsed(elapsed, side);
      this.lastTick = now;
    }

    const remaining = side === 'w' ? this.whiteMs : this.blackMs;
    if (remaining <= cost) {
      if (side === 'w') this.whiteMs = cost;
      else this.blackMs = cost;
      return false;
    }

    if (side === 'w') this.whiteMs = remaining - cost;
    else this.blackMs = remaining - cost;
    return true;
  }

  /** Freezes the clock (leaving the board view). Time already spent is banked. */
  pause(now: number): ClockSnapshot {
    if (this.active) {
      const elapsed = Math.max(0, now - this.lastTick);
      this.chargeElapsed(elapsed, this.active);
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

  /**
   * Adopts the times another client just measured, keeping the running side's
   * turn intact. Used by online play: the mover's clock is authoritative, and a
   * difference larger than the transport latency is corrected instead of being
   * allowed to accumulate over a game.
   */
  adoptTimes(whiteMs: number, blackMs: number, now: number): ClockSnapshot {
    this.whiteMs = Math.max(0, Math.round(whiteMs));
    this.blackMs = Math.max(0, Math.round(blackMs));
    this.lastTick = now;
    return this.snapshot(now);
  }

  /**
   * Rebuilds a clock from a snapshot of a game already in progress.
   *
   * Used when a client rejoins an online game: the times come from the side
   * that stayed, and the clock has to resume charging exactly the side to move,
   * with no increment paid for a move nobody played here.
   */
  restoreTimes(
    whiteMs: number,
    blackMs: number,
    active: 'w' | 'b' | null,
    now: number,
  ): ClockSnapshot {
    this.whiteMs = Math.max(0, Math.round(whiteMs));
    this.blackMs = Math.max(0, Math.round(blackMs));
    this.started = active !== null;
    this.active = active;
    this.pausedSide = null;
    this.lastTick = now;
    this.delayMs = this.bonusType === 'simple' ? this.incrementMs : 0;
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
    let delayMs = 0;
    let inDelay = false;

    if (this.active && this.started) {
      const elapsed = Math.max(0, now - this.lastTick);
      if (this.bonusType === 'simple') {
        delayMs = Math.max(0, this.delayMs - elapsed);
        inDelay = delayMs > 0;
        const charged = Math.max(0, elapsed - this.delayMs);
        if (this.active === 'w') whiteMs = Math.max(0, whiteMs - charged);
        else blackMs = Math.max(0, blackMs - charged);
      } else if (this.active === 'w') {
        whiteMs = Math.max(0, whiteMs - elapsed);
      } else {
        blackMs = Math.max(0, blackMs - elapsed);
      }
    }

    const flagged: PlayColor | null = whiteMs <= 0 ? 'w' : blackMs <= 0 ? 'b' : null;

    return {
      whiteMs: Math.max(0, whiteMs),
      blackMs: Math.max(0, blackMs),
      active: this.active,
      running: this.started && this.active !== null,
      flagged,
      delayMs,
      inDelay,
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
    const clock = new ChessClock(0, 0, state.bonusType ?? 'fischer');
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
    delayMs: 0,
    inDelay: false,
  };
}
