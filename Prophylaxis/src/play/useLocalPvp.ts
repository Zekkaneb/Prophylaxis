import { useCallback, useRef, useState } from 'react';
import { Chess, type Move } from 'chess.js';
import { flagOutcome, type PvpTimeControl } from './pvp.ts';
import { useChessClock } from './useChessClock.ts';
import type { PlayColor, PlayOrientation, PlayResult, ResultReason } from './types.ts';

/**
 * One board, two people: pass-and-play.
 *
 * The rules authority is chess.js and the clock is `ChessClock` behind
 * `useChessClock`; this hook only decides whose turn it is, when the game is
 * over, and what a flag means. Nothing here is saved as a live game: a game two
 * people play on one screen is finished in the room, and the result is theirs
 * to keep. (Saved rows are for the account's own games.)
 */

export type PvpStatus = 'playing' | 'paused' | 'finished';

export interface PvpState {
  fen: string;
  sans: string[];
  lastMove: { from: string; to: string } | null;
  turn: PlayColor;
  status: PvpStatus;
  result: PlayResult | null;
  reason: ResultReason | null;
  startedAt: number;
  endedAt: number | null;
  /** Set when the game ended on the clock, so the card can say which side. */
  flaggedColor: PlayColor | null;
}

export interface PvpGameOptions extends PvpTimeControl {
  autoFlip?: boolean;
  /**
   * The side the person at this screen owns. Null in pass-and-play, where both
   * sides are the same two hands; online it locks the board to that side.
   */
  ownerSide?: PlayColor | null;
}

function initialState(startedAt: number): PvpState {
  return {
    fen: new Chess().fen(),
    sans: [],
    lastMove: null,
    turn: 'w',
    status: 'playing',
    result: null,
    reason: null,
    startedAt,
    endedAt: null,
    flaggedColor: null,
  };
}

export type PvpGame = ReturnType<typeof useLocalPvp>;

export function useLocalPvp(options: PvpGameOptions) {
  const { untimed, autoFlip = true, ownerSide = null } = options;

  const gameRef = useRef<Chess>(new Chess());
  const statusRef = useRef<PvpStatus>('playing');
  const [state, setState] = useState<PvpState>(() => initialState(Date.now()));
  const [manualOrientation, setManualOrientation] = useState<PlayOrientation>('white');

  const finishRef = useRef<(result: PlayResult, reason: ResultReason, flagged?: PlayColor) => void>(
    () => {},
  );

  const clock = useChessClock({
    initialSeconds: options.initialSeconds,
    bonusSeconds: options.bonusSeconds,
    bonusType: options.bonusType,
    untimed,
    onFlag: (flagged) => {
      /* The flag rule is read from the position that stands when the clock
         empties: an opponent with a lone king cannot win on time. */
      const outcome = flagOutcome(flagged, gameRef.current.fen());
      finishRef.current(outcome.result, outcome.reason, flagged);
    },
  });
  const clockRef = useRef(clock);
  clockRef.current = clock;

  const finish = useCallback(
    (result: PlayResult, reason: ResultReason, flagged: PlayColor | null = null) => {
      if (statusRef.current === 'finished') return;
      statusRef.current = 'finished';
      clockRef.current.stop();
      setState((current) => ({
        ...current,
        status: 'finished',
        result,
        reason,
        flaggedColor: flagged,
        endedAt: Date.now(),
      }));
    },
    [],
  );
  finishRef.current = finish;

  const playMove = useCallback(
    (from: string, to: string, promotion?: string, options: { remote?: boolean } = {}): boolean => {
      if (statusRef.current !== 'playing') return false;
      const game = gameRef.current;
      /* Online: a client may only move for its own side. A move that arrived
         from the opponent comes through `remote`. */
      if (!options.remote && ownerSide && game.turn() !== ownerSide) return false;

      /* A move that lands after the flag is not a move. The clock's own loop
         normally catches this first; this is the race. */
      if (!untimed && clockRef.current.snapshot.flagged) {
        const outcome = flagOutcome(clockRef.current.snapshot.flagged, game.fen());
        finish(outcome.result, outcome.reason, clockRef.current.snapshot.flagged);
        return false;
      }

      let applied: Move | null = null;
      try {
        applied = game.move({ from, to, promotion });
      } catch {
        return false;
      }
      if (!applied) return false;

      const nextTurn = game.turn();
      const terminal =
        game.isCheckmate() ||
        game.isStalemate() ||
        game.isInsufficientMaterial() ||
        game.isThreefoldRepetition() ||
        game.isDraw();

      setState((current) => ({
        ...current,
        fen: game.fen(),
        sans: [...current.sans, applied!.san],
        lastMove: { from: applied!.from, to: applied!.to },
        turn: nextTurn,
      }));

      if (!untimed) {
        clockRef.current.start();
        clockRef.current.afterMove(applied.color, nextTurn);
      }

      if (game.isCheckmate()) {
        finish(applied.color === 'w' ? '1-0' : '0-1', 'checkmate');
      } else if (game.isStalemate()) {
        finish('1/2-1/2', 'stalemate');
      } else if (game.isInsufficientMaterial()) {
        finish('1/2-1/2', 'insufficient-material');
      } else if (game.isThreefoldRepetition()) {
        finish('1/2-1/2', 'threefold-repetition');
      } else if (game.isDraw()) {
        finish('1/2-1/2', 'fifty-move');
      } else if (terminal) {
        finish('1/2-1/2', 'fifty-move');
      }

      return true;
    },
    [finish, ownerSide, untimed],
  );

  const pause = useCallback(() => {
    if (statusRef.current !== 'playing') return;
    statusRef.current = 'paused';
    clockRef.current.pause();
    setState((current) => ({ ...current, status: 'paused' }));
  }, []);

  const resume = useCallback(() => {
    if (statusRef.current !== 'paused') return;
    statusRef.current = 'playing';
    clockRef.current.resume();
    setState((current) => ({ ...current, status: 'playing' }));
  }, []);

  const resign = useCallback(
    (side: PlayColor) => {
      finish(side === 'w' ? '0-1' : '1-0', 'resignation');
    },
    [finish],
  );

  /**
   * Adopts a game already in progress, as sent by the side that stayed.
   *
   * Moves are replayed from SAN rather than trusted as a position, so a corrupt
   * or partial snapshot leaves the current game alone instead of putting a
   * board on screen that no rule engine agrees with.
   */
  const restore = useCallback(
    (snapshot: {
      sans: string[];
      whiteTimeMs: number;
      blackTimeMs: number;
      status: 'playing' | 'finished';
      result: PlayResult | null;
      reason: ResultReason | null;
      flaggedColor: PlayColor | null;
      startedAt: number;
    }) => {
      const game = new Chess();
      const sans: string[] = [];
      let lastMove: { from: string; to: string } | null = null;
      for (const san of snapshot.sans) {
        let played: Move | null = null;
        try {
          played = game.move(san);
        } catch {
          return false;
        }
        if (!played) return false;
        sans.push(played.san);
        lastMove = { from: played.from, to: played.to };
      }

      gameRef.current = game;
      const finished = snapshot.status === 'finished';
      statusRef.current = finished ? 'finished' : 'playing';
      clockRef.current.restore(
        snapshot.whiteTimeMs,
        snapshot.blackTimeMs,
        finished ? null : game.turn(),
      );
      setState({
        fen: game.fen(),
        sans,
        lastMove,
        turn: game.turn(),
        status: finished ? 'finished' : 'playing',
        result: snapshot.result,
        reason: snapshot.reason,
        startedAt: snapshot.startedAt || Date.now(),
        endedAt: finished ? Date.now() : null,
        flaggedColor: snapshot.flaggedColor,
      });
      return true;
    },
    [],
  );

  const flip = useCallback(() => {
    setManualOrientation((current) => (current === 'white' ? 'black' : 'white'));
  }, []);

  const orientation: PlayOrientation = autoFlip
    ? state.turn === 'w'
      ? 'white'
      : 'black'
    : manualOrientation;

  return {
    state,
    clock: clock.snapshot,
    orientation,
    playMove,
    pause,
    resume,
    resign,
    restore,
    flip,
    playing: state.status === 'playing',
    paused: state.status === 'paused',
    /** True when the board should accept a move from this screen. */
    canMove:
      state.status === 'playing' && (ownerSide === null || state.turn === ownerSide),
    /** Online: takes the mover's clock readings from the opponent's message. */
    adopt: clock.adopt,
  };
}
