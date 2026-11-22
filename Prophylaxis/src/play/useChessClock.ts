import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChessClock,
  type BonusType,
  type ClockSnapshot,
} from './clock.ts';
import type { PlayColor } from './types.ts';

/**
 * React face of `ChessClock`.
 *
 * The stored time is always derived from timestamps: the display timer only
 * asks the clock what it reads *now*, so a throttled or backgrounded tab (or a
 * slow frame) can never move the clock. The tick exists to repaint, not to
 * count.
 */

export interface ChessClockOptions {
  initialSeconds: number;
  bonusSeconds: number;
  bonusType: BonusType;
  untimed: boolean;
  /** Called once, when a side's main clock reaches zero. */
  onFlag?: (flagged: PlayColor) => void;
}

export interface ChessClockApi {
  snapshot: ClockSnapshot;
  /** Arms the clock for White; no time is charged before this. */
  start: () => void;
  afterMove: (mover: PlayColor, next: PlayColor) => ClockSnapshot;
  /** Freezes the running side (leave the board, pause the game). */
  pause: () => void;
  resume: () => void;
  stop: () => void;
  /** Takes the opponent's measured times (online play), keeping the turn. */
  adopt: (whiteMs: number, blackMs: number) => void;
  /** True while the clock is deliberately held. */
  paused: boolean;
  untimed: boolean;
}

/** Monotonic where the platform has it; only deltas are ever taken. */
function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

const REPAINT_MS = 100;

export function useChessClock(options: ChessClockOptions): ChessClockApi {
  const { initialSeconds, bonusSeconds, bonusType, untimed } = options;

  /* One clock per configuration: a new time control means a new game, so the
     clock is rebuilt instead of being patched field by field. */
  const clockRef = useRef<ChessClock | null>(null);
  const configKey = `${initialSeconds}:${bonusSeconds}:${bonusType}:${untimed}`;
  const builtKeyRef = useRef<string>('');

  if (!clockRef.current || builtKeyRef.current !== configKey) {
    clockRef.current = new ChessClock(initialSeconds, bonusSeconds, bonusType);
    builtKeyRef.current = configKey;
  }

  const [snapshot, setSnapshot] = useState<ClockSnapshot>(() =>
    clockRef.current ? clockRef.current.snapshot(now()) : ChessClock.empty(),
  );
  const [paused, setPaused] = useState(false);

  const onFlagRef = useRef(options.onFlag);
  onFlagRef.current = options.onFlag;
  const flaggedRef = useRef(false);

  const publish = useCallback(() => {
    const clock = clockRef.current;
    if (!clock) return;
    const next = clock.snapshot(now());
    setSnapshot(next);
    if (next.flagged && !flaggedRef.current) {
      flaggedRef.current = true;
      onFlagRef.current?.(next.flagged);
    }
  }, []);

  /*
   * Repaint while anyone's clock is running.
   *
   * The dependency list deliberately omits `onFlag`: callers pass it inline,
   * so its identity changes on every render — depending on it restarted this
   * loop on every repaint, which published again and looped until React threw
   * "maximum update depth exceeded". The callback is read through a ref.
   */
  useEffect(() => {
    let timer = 0;
    const tick = () => {
      publish();
      timer = window.setTimeout(tick, REPAINT_MS);
    };
    const start = () => {
      window.clearTimeout(timer);
      tick();
    };

    /* A background tab throttles timers; coming back must repaint at once. */
    const onVisibility = () => {
      if (document.visibilityState === 'visible') publish();
    };
    document.addEventListener('visibilitychange', onVisibility);
    start();

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [publish, untimed]);

  /* A fresh clock (new game) clears the flag latch. */
  useEffect(() => {
    flaggedRef.current = false;
    setPaused(false);
    publish();
  }, [configKey, publish]);

  const start = useCallback(() => {
    clockRef.current?.start(now());
    publish();
  }, [publish]);

  const afterMove = useCallback((mover: PlayColor, next: PlayColor) => {
    const clock = clockRef.current;
    if (!clock) return ChessClock.empty();
    const landed = clock.afterMove(mover, next, now());
    setSnapshot(landed);
    if (landed.flagged && !flaggedRef.current) {
      flaggedRef.current = true;
      onFlagRef.current?.(landed.flagged);
    }
    return landed;
  }, []);

  const pause = useCallback(() => {
    clockRef.current?.pause(now());
    setPaused(true);
    publish();
  }, [publish]);

  const resume = useCallback(() => {
    clockRef.current?.resume(now());
    setPaused(false);
    publish();
  }, [publish]);

  const stop = useCallback(() => {
    clockRef.current?.stop();
    publish();
  }, [publish]);

  const adopt = useCallback(
    (whiteMs: number, blackMs: number) => {
      clockRef.current?.adoptTimes(whiteMs, blackMs, now());
      publish();
    },
    [publish],
  );

  return { snapshot, start, afterMove, pause, resume, stop, adopt, paused, untimed };
}
