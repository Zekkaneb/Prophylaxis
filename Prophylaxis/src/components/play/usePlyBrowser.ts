import { useCallback, useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import { playSoundEvent } from '../../play/audio/soundManager.ts';
import { replayPlySound, replaySans } from '../../play/replay.ts';

/**
 * Step-back browsing for a game that is still on screen.
 *
 * The live game keeps its own FEN, but a reviewer needs every earlier position:
 * this replays the SAN list and hands back the one being inspected. The cursor
 * is `null` while it follows the game and a ply number once the reader steps
 * back, so a move arriving mid-review cannot move the position under them and
 * one arriving at the latest position simply extends the game.
 *
 * Stepping one ply also plays that move's cue, so reviewing a game on the board
 * sounds like playing it did. A jump across several plies is navigation and
 * stays quiet, and a move arriving live is not stepped here at all: the game's
 * own hook already sounded it.
 */

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** White's material minus Black's, in pawns, for the position shown. */
function materialBalance(fen: string): number {
  try {
    const board = new Chess(fen);
    let total = 0;
    for (const row of board.board()) {
      for (const piece of row) {
        if (!piece) continue;
        const value = PIECE_VALUE[piece.type] ?? 0;
        total += piece.color === 'w' ? value : -value;
      }
    }
    return total;
  } catch {
    return 0;
  }
}

export interface PlyBrowser {
  /** Number of plies in the game; index 0 is the starting position. */
  total: number;
  /** Ply being shown: 0 = start, `total` = live/final position. */
  ply: number;
  /** True while the board follows the game rather than a snapshot. */
  atLive: boolean;
  fen: string;
  lastMove: { from: string; to: string } | null;
  /** Side to move in the shown position (`w` / `b`). */
  turn: 'w' | 'b';
  /** White minus Black material, in pawns. */
  material: number;
  go: (ply: number) => void;
  first: () => void;
  prev: () => void;
  next: () => void;
  last: () => void;
}

export interface PlyBrowserOptions {
  /** Colour whose moves sound like the reader's own; null is a bot-vs-bot game. */
  playerColor?: 'w' | 'b' | null;
}

export function usePlyBrowser(
  sans: readonly string[],
  liveFen: string,
  options: PlyBrowserOptions = {},
): PlyBrowser {
  const playerColor = options.playerColor ?? null;
  const positions = useMemo(() => {
    try {
      return replaySans('', sans);
    } catch {
      /* A corrupt list still leaves the live board usable. */
      return null;
    }
  }, [sans]);

  const total = positions?.plies.length ?? sans.length;
  /* null = following the game; a number = the snapshot the reader pinned. */
  const [pinnedPly, setPinnedPly] = useState<number | null>(null);

  const ply =
    pinnedPly === null ? total : Math.max(0, Math.min(total, pinnedPly));
  const atLive = ply >= total;

  const fen = positions?.fens[ply] ?? liveFen;
  const lastMove =
    positions && ply > 0
      ? (() => {
          const entry = positions.plies[ply - 1];
          return entry ? { from: entry.from, to: entry.to } : null;
        })()
      : null;
  const turn = fen.split(' ')[1] === 'b' ? 'b' : 'w';
  const material = useMemo(() => materialBalance(fen), [fen]);

  const go = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(total, next));

      /* One ply is a move: play the cue that move would have made live. */
      if (positions && Math.abs(clamped - ply) === 1) {
        const stepped = positions.plies[clamped > ply ? clamped - 1 : ply - 1];
        const sound = stepped ? replayPlySound(stepped, playerColor) : null;
        if (sound) playSoundEvent(sound);
      }

      /* Landing on the latest ply re-attaches the board to the game. */
      setPinnedPly(clamped >= total ? null : clamped);
    },
    [playerColor, ply, positions, total],
  );

  /* Arrow keys move one ply, Home/End jump to the ends — the same keys the
     Game Review replay uses, so browsing feels like one feature. */
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        go(ply - 1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        go(ply + 1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        go(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        go(total);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [go, ply, total]);

  return {
    total,
    ply,
    atLive,
    fen,
    lastMove,
    turn,
    material,
    go,
    first: () => go(0),
    prev: () => go(ply - 1),
    next: () => go(ply + 1),
    last: () => go(total),
  };
}
