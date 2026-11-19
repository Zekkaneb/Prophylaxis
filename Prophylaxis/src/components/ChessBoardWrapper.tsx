import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { Chess, type Move, type Square } from 'chess.js';
import { Chessboard, type Arrow } from 'react-chessboard';
import { classifyMoveSound, moveSoundFacts } from '../play/audio/soundEvents';
import { playSoundEvent } from '../play/audio/soundManager';
import {
  needsPromotion,
  premoveQueueFen,
  premoveTargets,
  type Premove,
} from '../play/premove.ts';
import { useAppearance } from '../theme/ThemeProvider';
import { buildPieceSet } from '../theme/pieceSets';

export const START_FEN =
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/**
 * Move cue for boards that manage their own play (study, drills, line demos).
 * The Play room turns this off and classifies moves in `usePlayGame`, where the
 * mover is known and a game-ending move must not also play a move cue.
 */
function playMoveFeedback(game: Chess, move: Move): void {
  playSoundEvent(
    classifyMoveSound(
      moveSoundFacts(move, {
        side: 'self',
        check: game.isCheck(),
        gameEnd: game.isGameOver(),
      }),
    ),
  );
}

export type BoardOrientation = 'white' | 'black';

export interface BoardArrow {
  startSquare: string;
  endSquare: string;
  /** Any CSS colour. Defaults to a training green. */
  color?: string;
}

export interface BoardBadge {
  square: string;
  symbol: string;
  /** Tone key from the move-classification palette (`brilliant`, `clutch`, …). */
  tone: string;
  label?: string;
  /** Adds the attention pulse used by Clutch. */
  pulse?: boolean;
}

export interface BoardMove {
  from: string;
  to: string;
  promotion?: string;
}

export interface BoardPlayOptions {
  /** Delay before each move, in ms. */
  intervalMs?: number;
}

export interface ChessBoardWrapperHandle {
  /** Plays UCI or SAN moves one by one, animating each. Resolves `false` if cancelled or illegal. */
  playMoves: (moves: string[], options?: BoardPlayOptions) => Promise<boolean>;
  cancelPlayback: () => void;
  isPlaying: () => boolean;
  /** Clears the board back to `fen` (defaults to the starting position). */
  reset: (fen?: string) => void;
  getFen: () => string;
  /** The internal chess.js instance, e.g. for mate/draw detection. */
  getGame: () => Chess;
}

export interface ChessBoardWrapperProps {
  /** Play bundled move cues for moves this board accepts (default true). */
  soundFeedback?: boolean;
  /** Side allowed to queue a premove while it is not that side's turn. */
  premoveColor?: 'w' | 'b' | null;
  /** The queued premoves, drawn but never applied by the board itself. */
  premoves?: BoardMove[];
  /** Append a premove to the chain, or clear it with `null`. */
  onPremoveChange?: (move: BoardMove | null) => void;
  /** Controlled position. The board also advances itself when a move is played. */
  fen?: string;
  orientation?: BoardOrientation;
  /** When false, no clicks or drags are accepted (e.g. engine is thinking). */
  interactive?: boolean;
  allowDragging?: boolean;
  /** Static arrows, e.g. engine best move or lesson hints. */
  arrows?: BoardArrow[];
  /** Classification marks pinned to squares, painted above the pieces. */
  badges?: BoardBadge[];
  /** Extra per-square styles, keyed by square (`e4`). Merged over the built-ins. */
  highlights?: Record<string, CSSProperties>;
  /** Highlight the from/to squares of the last played move. */
  highlightLastMove?: boolean;
  /** Highlight the side-to-move's king when it is in check. */
  highlightCheck?: boolean;
  /** Overrides the internally tracked last move (useful when stepping through a PGN). */
  lastMove?: BoardMove | null;
  showCoordinates?: boolean;
  animationDuration?: number;
  className?: string;
  /** Fires for every accepted move, whether played by the user or by `playMoves`. */
  onMove?: (move: Move, fen: string) => void;
  /** Fires when a drag/click target is not a legal move (wrong answers). */
  onIllegalMove?: (attempt: BoardMove) => void;
}

const DEFAULT_ARROW_COLOR = '#3f9a57';

const LAST_MOVE_STYLE: CSSProperties = {
  background: 'rgba(255, 213, 79, 0.32)',
};

const CHECK_STYLE: CSSProperties = {
  background:
    'radial-gradient(circle, rgba(255, 77, 77, 0.95) 0%, rgba(255, 77, 77, 0.55) 45%, transparent 72%)',
};

const SELECTED_STYLE: CSSProperties = {
  background: 'rgba(120, 190, 255, 0.38)',
};

/* Queued premove: a blue edge on the piece and a hollow ring on the target, so
   it reads as an intention rather than a played move and never hides a piece. */
const PREMOVE_FROM_STYLE: CSSProperties = {
  boxShadow: 'inset 0 0 0 3px rgba(122, 162, 255, 0.9)',
  background: 'rgba(122, 162, 255, 0.16)',
};

const PREMOVE_TO_STYLE: CSSProperties = {
  backgroundImage: 'radial-gradient(circle, rgba(122, 162, 255, 0.62) 17%, transparent 19%)',
  boxShadow: 'inset 0 0 0 2px rgba(122, 162, 255, 0.65)',
};

/** Square index in the rendered orientation, for percentage overlays. */
function squareGrid(square: string, orientation: BoardOrientation): { col: number; row: number } {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  return {
    col: orientation === 'black' ? 7 - file : file,
    row: orientation === 'black' ? rank : 7 - rank,
  };
}

const LEGAL_TARGET_STYLE: CSSProperties = {
  backgroundImage:
    'radial-gradient(circle, rgba(20, 24, 30, 0.35) 22%, transparent 24%)',
};

const PROMOTION_PIECES = ['q', 'r', 'b', 'n'] as const;

const GLYPHS: Record<string, { white: string; black: string }> = {
  q: { white: '\u2655', black: '\u265B' },
  r: { white: '\u2656', black: '\u265C' },
  b: { white: '\u2657', black: '\u265D' },
  n: { white: '\u2658', black: '\u265E' },
};

function createGame(fen?: string): Chess {
  try {
    return new Chess(fen || START_FEN);
  } catch {
    console.warn(`ChessBoardWrapper: invalid FEN "${fen}", using the start position.`);
    return new Chess();
  }
}

/** Compare the placement + side to move so FEN half-move counters don't cause churn. */
function samePosition(a: string, b: string): boolean {
  return a.split(' ').slice(0, 4).join(' ') === b.split(' ').slice(0, 4).join(' ');
}

function kingSquare(game: Chess, color: 'w' | 'b'): string | null {
  for (const rank of game.board()) {
    for (const piece of rank) {
      if (piece && piece.type === 'k' && piece.color === color) {
        return piece.square;
      }
    }
  }
  return null;
}

/** Returns the promoting colour when `from`->`to` is a legal pawn promotion. */
function promotionColor(game: Chess, from: string, to: string): 'w' | 'b' | null {
  const piece = game.get(from as Square);
  if (!piece || piece.type !== 'p') return null;
  const lastRank = piece.color === 'w' ? '8' : '1';
  if (to[1] !== lastRank) return null;
  const legal = game
    .moves({ square: from as Square, verbose: true })
    .some((move) => move.to === to);
  return legal ? piece.color : null;
}

const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

/** Accepts UCI (`e2e4`, `e7e8q`) or SAN (`Nf3`, `O-O`) and plays it on `game`. */
function applyMove(game: Chess, notation: string): Move {
  if (UCI_RE.test(notation)) {
    return game.move({
      from: notation.slice(0, 2),
      to: notation.slice(2, 4),
      ...(notation.length === 5 ? { promotion: notation[4] } : {}),
    });
  }
  return game.move(notation);
}

export const ChessBoardWrapper = forwardRef<
  ChessBoardWrapperHandle,
  ChessBoardWrapperProps
>(function ChessBoardWrapper(
  {
    fen,
    orientation = 'white',
    interactive = true,
    allowDragging = true,
    arrows,
    badges,
    highlights,
    highlightLastMove = true,
    highlightCheck = true,
    lastMove,
    showCoordinates = true,
    animationDuration = 220,
    className,
    soundFeedback = true,
    premoveColor = null,
    premoves = [],
    onPremoveChange,
    onMove,
    onIllegalMove,
  },
  ref,
) {
  const boardId = useId();
  const { palette, appearance } = useAppearance();
  const pieces = useMemo(() => buildPieceSet(appearance.pieceSet), [appearance.pieceSet]);
  const gameRef = useRef<Chess>(createGame(fen));
  const [currentFen, setCurrentFen] = useState(() => gameRef.current.fen());
  const [selected, setSelected] = useState<string | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<
    (BoardMove & { premove?: boolean }) | null
  >(null);
  const [internalLastMove, setInternalLastMove] = useState<BoardMove | null>(null);
  const [playing, setPlaying] = useState(false);

  const playingRef = useRef(false);
  const playbackToken = useRef(0);
  const onMoveRef = useRef(onMove);
  const onIllegalRef = useRef(onIllegalMove);
  const onPremoveRef = useRef(onPremoveChange);
  const interactiveRef = useRef(interactive);
  const soundRef = useRef(soundFeedback);
  /* The position this board last produced itself, so the externally-driven cue
     below never plays a second sound for the same move. */
  const playedFenRef = useRef<string | null>(null);

  useEffect(() => {
    onMoveRef.current = onMove;
    onIllegalRef.current = onIllegalMove;
    onPremoveRef.current = onPremoveChange;
    interactiveRef.current = interactive;
    soundRef.current = soundFeedback;
  }, [onMove, onIllegalMove, onPremoveChange, interactive, soundFeedback]);

  /* Escape clears the whole premove chain from anywhere on the page. */
  useEffect(() => {
    if (premoves.length === 0) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      onPremoveRef.current?.(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [premoves.length]);

  /* Controlled position changes: adopt them unless a playback is running. */
  useEffect(() => {
    if (!fen || playingRef.current) return;
    if (samePosition(gameRef.current.fen(), fen)) return;
    const next = createGame(fen);
    gameRef.current = next;
    setCurrentFen(next.fen());
    setSelected(null);
    setPendingPromotion(null);
    setInternalLastMove(null);
  }, [fen]);

  /*
   * Sound for positions the board did not produce itself: stepping through a
   * course line, navigating a review, a puzzle revealing the reply. If the new
   * position is exactly one legal move away it is a move and it sounds like
   * one; a jump to an unrelated position stays silent.
   */
  const soundFenRef = useRef(currentFen);
  useEffect(() => {
    const previous = soundFenRef.current;
    soundFenRef.current = currentFen;
    if (!soundRef.current || !previous) return;
    if (samePosition(previous, currentFen)) return;
    if (playedFenRef.current && samePosition(playedFenRef.current, currentFen)) return;

    const game = createGame(previous);
    let played: Move | null = null;
    try {
      for (const candidate of game.moves({ verbose: true })) {
        game.move(candidate);
        const reached = game.fen();
        game.undo();
        if (samePosition(reached, currentFen)) {
          played = candidate;
          break;
        }
      }
      if (played) {
        game.move(played);
        playMoveFeedback(game, played);
      }
    } catch {
      /* An impossible pair of positions is not a move: stay quiet. */
    }
  }, [currentFen]);

  useEffect(
    () => () => {
      playbackToken.current += 1;
    },
    [],
  );

  const commitMove = useCallback(
    (from: string, to: string, promotion?: string): Move | null => {
      const game = gameRef.current;
      let move: Move;
      try {
        move = game.move({
          from,
          to,
          ...(promotion ? { promotion } : {}),
        });
      } catch {
        return null;
      }
      const nextFen = game.fen();
      gameRef.current = game;
      setCurrentFen(nextFen);
      setInternalLastMove({ from: move.from, to: move.to });
      setSelected(null);
      setPendingPromotion(null);
      onMoveRef.current?.(move, nextFen);
      if (soundRef.current) playMoveFeedback(game, move);
      playedFenRef.current = nextFen;
      return move;
    },
    [],
  );

  const premoveActive = Boolean(premoveColor) && premoveColor !== currentFen.split(' ')[1];
  const premoveActiveRef = useRef(premoveActive);
  premoveActiveRef.current = premoveActive;

  /*
   * The position the queued premoves would reach with the opponent passing, so
   * a second premove can move the same piece again and is checked against the
   * board it will actually be played on.
   */
  const previewFen = useMemo(
    () =>
      premoveActive && premoveColor
        ? premoveQueueFen(currentFen, premoves as Premove[], premoveColor)
        : currentFen,
    [currentFen, premoveActive, premoveColor, premoves],
  );

  /** Appends a premove to the chain instead of playing it. Never mutates the game. */
  const attemptPremove = useCallback(
    (from: string, to: string): boolean => {
      if (!premoveColor) return false;
      const piece = new Chess(previewFen).get(from as Square);
      if (!piece || piece.color !== premoveColor) return false;
      if (!premoveTargets(previewFen, from, premoveColor).includes(to)) return false;
      if (needsPromotion(previewFen, from, to, premoveColor)) {
        setPendingPromotion({ from, to, premove: true });
        setSelected(null);
        return false;
      }
      onPremoveRef.current?.({ from, to });
      setSelected(null);
      return true;
    },
    [premoveColor, previewFen],
  );

  const attemptMove = useCallback(
    (from: string, to: string): boolean => {
      const game = gameRef.current;
      const promotes = promotionColor(game, from, to);
      if (promotes) {
        setPendingPromotion({ from, to });
        setSelected(null);
        return false;
      }
      const move = commitMove(from, to);
      if (!move) {
        // No red flash on the square: an illegal attempt just snaps back and
        // plays the error sound, which is feedback enough without the noise.
        onIllegalRef.current?.({ from, to });
        playSoundEvent('illegal');
        return false;
      }
      return true;
    },
    [commitMove],
  );

  const handlePieceDrop = useCallback(
    ({ sourceSquare, targetSquare }: { sourceSquare: string; targetSquare: string | null }) => {
      if (!interactiveRef.current || playingRef.current || pendingPromotion) return false;
      if (!targetSquare || sourceSquare === targetSquare) return false;
      if (premoveActiveRef.current) return attemptPremove(sourceSquare, targetSquare);
      return attemptMove(sourceSquare, targetSquare);
    },
    [attemptMove, attemptPremove, pendingPromotion],
  );

  const handleSquareClick = useCallback(
    ({ square }: { square: string }) => {
      if (!interactiveRef.current || playingRef.current || pendingPromotion) return;
      const game = gameRef.current;

      if (premoveActiveRef.current) {
        /* Clicking an empty or unrelated square cancels the premoves, the way
           chess.com does; selecting a piece or completing a new premove keeps
           the chain going. */
        if (selected === square) {
          setSelected(null);
          return;
        }
        if (selected && premoveTargets(previewFen, selected, premoveColor ?? 'w').includes(square)) {
          attemptPremove(selected, square);
          return;
        }
        const squarePiece = new Chess(previewFen).get(square as Square);
        if (squarePiece && squarePiece.color === premoveColor) {
          setSelected(square);
          return;
        }
        setSelected(null);
        if (premoves.length > 0) onPremoveRef.current?.(null);
        return;
      }

      if (selected === square) {
        setSelected(null);
        return;
      }

      if (selected) {
        const isTarget = game
          .moves({ square: selected as Square, verbose: true })
          .some((move) => move.to === square);
        if (isTarget) {
          attemptMove(selected, square);
          return;
        }
      }

      const piece = game.get(square as Square);
      setSelected(piece && piece.color === game.turn() ? square : null);
    },
    [attemptMove, attemptPremove, pendingPromotion, premoveColor, premoves.length, previewFen, selected],
  );

  const legalTargets = useMemo(() => {
    if (!selected) return [];
    if (premoveActive && premoveColor) {
      return premoveTargets(previewFen, selected, premoveColor);
    }
    try {
      return gameRef.current
        .moves({ square: selected as Square, verbose: true })
        .map((move) => move.to);
    } catch {
      return [];
    }
  }, [premoveActive, premoveColor, previewFen, selected]);

  /* Capture targets get a ring instead of the dot: an occupied square hides a
     centred dot behind the piece it is meant to warn you about. */
  const captureTargets = useMemo(() => {
    if (!selected) return [];
    try {
      const capturing = gameRef.current
        .moves({ square: selected as Square, verbose: true })
        .filter((move) => Boolean(move.captured))
        .map((move) => move.to);
      /* Premoves run against the current position, so a piece sitting on the
         target is the only reliable capture signal there. */
      const squares = premoveActive
        ? legalTargets.filter((target) => Boolean(gameRef.current.get(target as Square)))
        : capturing;
      return [...new Set(squares)];
    } catch {
      return [];
    }
  }, [legalTargets, premoveActive, selected]);

  const cancelPlayback = useCallback(() => {
    playbackToken.current += 1;
    playingRef.current = false;
    setPlaying(false);
  }, []);

  const playMoves = useCallback(
    async (moves: string[], options?: BoardPlayOptions): Promise<boolean> => {
      if (!moves.length) return true;
      const token = ++playbackToken.current;
      const isCurrent = () => token === playbackToken.current;
      playingRef.current = true;
      setPlaying(true);
      setSelected(null);
      setPendingPromotion(null);

      const interval = Math.max(80, options?.intervalMs ?? 500);
      const game = new Chess(gameRef.current.fen());
      const wait = (ms: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, ms));

      try {
        for (const notation of moves) {
          await wait(interval);
          if (!isCurrent()) return false;
          let move: Move;
          try {
            move = applyMove(game, notation);
          } catch {
            console.warn(`ChessBoardWrapper: illegal playback move "${notation}".`);
            break;
          }
          const nextFen = game.fen();
          gameRef.current = game;
          setCurrentFen(nextFen);
          setInternalLastMove({ from: move.from, to: move.to });
          onMoveRef.current?.(move, nextFen);
          if (soundRef.current) playMoveFeedback(game, move);
          playedFenRef.current = nextFen;
        }
        return isCurrent();
      } finally {
        // A superseding playback, reset or cancel already owns the flag.
        if (isCurrent()) {
          playingRef.current = false;
          setPlaying(false);
        }
      }
    },
    [],
  );

  const reset = useCallback((nextFen: string = START_FEN) => {
    playbackToken.current += 1;
    playingRef.current = false;
    setPlaying(false);
    const game = createGame(nextFen);
    gameRef.current = game;
    setCurrentFen(game.fen());
    setSelected(null);
    setPendingPromotion(null);
    setInternalLastMove(null);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      playMoves,
      cancelPlayback,
      isPlaying: () => playingRef.current,
      reset,
      getFen: () => gameRef.current.fen(),
      getGame: () => gameRef.current,
    }),
    [cancelPlayback, playMoves, reset],
  );

  const checkSquare = useMemo(() => {
    if (!highlightCheck) return null;
    try {
      const game = new Chess(currentFen);
      return game.isCheck() ? kingSquare(game, game.turn()) : null;
    } catch {
      return null;
    }
  }, [currentFen, highlightCheck]);

  const squareStyles = useMemo(() => {
    const styles: Record<string, CSSProperties> = { ...(highlights ?? {}) };
    const shownLastMove = lastMove ?? internalLastMove;

    if (highlightLastMove && shownLastMove) {
      for (const square of [shownLastMove.from, shownLastMove.to]) {
        styles[square] = { ...styles[square], ...LAST_MOVE_STYLE };
      }
    }
    if (checkSquare) {
      styles[checkSquare] = { ...styles[checkSquare], ...CHECK_STYLE };
    }
    const firstPremove = premoves[0] ?? null;
    if (firstPremove) {
      styles[firstPremove.from] = { ...styles[firstPremove.from], ...PREMOVE_FROM_STYLE };
      styles[firstPremove.to] = { ...styles[firstPremove.to], ...PREMOVE_TO_STYLE };
    }
    if (selected) {
      styles[selected] = { ...styles[selected], ...SELECTED_STYLE };
      for (const target of legalTargets) {
        styles[target] = { ...LEGAL_TARGET_STYLE, ...styles[target] };
      }
    }
    return styles;
  }, [
    checkSquare,
    highlightLastMove,
    highlights,
    internalLastMove,
    lastMove,
    legalTargets,
    premoves,
    selected,
  ]);

  const boardArrows = useMemo<Arrow[]>(
    () =>
      (arrows ?? []).map((arrow) => ({
        startSquare: arrow.startSquare,
        endSquare: arrow.endSquare,
        color: arrow.color ?? DEFAULT_ARROW_COLOR,
      })),
    [arrows],
  );

  /* Queued premoves are drawn as overlays rather than square styles: they sit
     above the pieces' square backgrounds, never cover a piece, and the
     percentage maths mirrors itself for the black orientation. The first entry
     is the one that will play next, so it gets the solid treatment. */
  const premoveOverlays = useMemo(() => {
    if (premoves.length === 0) return [];
    return premoves.map((move) => {
      const from = squareGrid(move.from, orientation);
      const to = squareGrid(move.to, orientation);
      return {
        from,
        to,
        x1: from.col + 0.5,
        y1: from.row + 0.5,
        x2: to.col + 0.5,
        y2: to.row + 0.5,
        fromStyle: {
          left: `${from.col * 12.5}%`,
          top: `${from.row * 12.5}%`,
        },
        toStyle: {
          left: `${to.col * 12.5}%`,
          top: `${to.row * 12.5}%`,
        },
      };
    });
  }, [orientation, premoves]);

  const promotingColor = pendingPromotion
    ? gameRef.current.get(pendingPromotion.from as Square)?.color ?? 'w'
    : 'w';

  return (
    <div
      className={className}
      role="group"
      aria-label="Chess board"
      onContextMenu={(event) => {
        /* Right-click cancels queued premoves, as on chess.com. */
        if (premoves.length === 0) return;
        event.preventDefault();
        onPremoveRef.current?.(null);
      }}
      style={{
        position: 'relative',
        /* The view's BoardSlot owns the size: it is the smaller of the window's
           leftover height and the column's width, so the board and the bars
           around it always fit one screen. The layer copies that box. */
        width: '100%',
        height: '100%',
        flex: '0 0 auto',
        maxWidth: 'none',
        userSelect: 'none',
      }}
    >
      {/* 64 square buttons are a pointer surface; AT reads the FEN and move list instead. */}
      <p className="visually-hidden">Board position, FEN: {currentFen}</p>

      <div className="board-scale">
      <div className="board-frame" aria-hidden="true">
        <Chessboard
        options={{
          id: boardId.replace(/:/g, ''),
          position: currentFen,
          boardOrientation: orientation,
          /* Palette + piece artwork come from the active appearance theme. */
          lightSquareStyle: { backgroundColor: palette.light },
          darkSquareStyle: { backgroundColor: palette.dark },
          boardStyle: { borderRadius: '12px', overflow: 'hidden' },
          pieces,
          allowDragging: interactive && allowDragging && !playing && !pendingPromotion,
          showNotation: showCoordinates,
          animationDurationInMs: animationDuration,
          arrows: boardArrows,
          squareStyles,
          onPieceDrop: handlePieceDrop,
          onSquareClick: handleSquareClick,
        }}
        />
      </div>

      {captureTargets.length > 0 && (
        <div className="board-captures" aria-hidden="true">
          {captureTargets.map((square) => {
            const { col, row } = squareGrid(square, orientation);
            return (
              <span
                key={square}
                className="board-capture"
                style={{ left: `${col * 12.5}%`, top: `${row * 12.5}%` }}
              />
            );
          })}
        </div>
      )}

      {premoveOverlays.length > 0 && (
        <div className="board-premove" aria-hidden="true">
          {premoveOverlays.map((overlay, index) => (
            <span
              key={`from-${index}-${overlay.from.col}-${overlay.from.row}`}
              className="board-premove__square board-premove__square--from"
              style={{ ...overlay.fromStyle, opacity: index === 0 ? 1 : 0.55 }}
            />
          ))}
          {premoveOverlays.map((overlay, index) => (
            <span
              key={`to-${index}-${overlay.to.col}-${overlay.to.row}`}
              className="board-premove__square board-premove__square--to"
              style={{ ...overlay.toStyle, opacity: index === 0 ? 1 : 0.55 }}
            />
          ))}
        </div>
      )}

      {premoveActive && premoves.length === 0 && selected && (
        <div className="board-premove" aria-hidden="true">
          <span
            className="board-premove__square board-premove__square--pick"
            style={{
              left: `${squareGrid(selected, orientation).col * 12.5}%`,
              top: `${squareGrid(selected, orientation).row * 12.5}%`,
            }}
          />
        </div>
      )}

      {badges && badges.length > 0 && (
        <div className="board-badges" aria-hidden="true">
          {badges.map((badge) => {
            const file = badge.square.charCodeAt(0) - 97;
            const rank = Number(badge.square[1]) - 1;
            // Percentage positioning keeps the marks glued to their squares at
            // every board scale and in both orientations.
            const col = orientation === 'black' ? 7 - file : file;
            const row = orientation === 'black' ? rank : 7 - rank;
            return (
              <span
                key={`${badge.square}-${badge.symbol}`}
                className={`board-badge gr-tone--${badge.tone}${
                  badge.pulse ? ' is-pulse' : ''
                }`}
                style={{
                  /* Anchored to the square's top-right corner: the mark sits
                     over the piece's shoulder instead of its foot. */
                  left: `${(col + 1) * 12.5}%`,
                  top: `${row * 12.5}%`,
                }}
                title={badge.label}
              >
                {badge.symbol}
              </span>
            );
          })}
        </div>
      )}

      {pendingPromotion && (
        <div
          role="dialog"
          aria-label="Choose a promotion piece"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(6, 12, 9, 0.55)',
            backdropFilter: 'blur(2px)',
            borderRadius: '8px',
            zIndex: 10,
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: '6px',
              padding: '12px 14px',
              background: 'var(--panel)',
              border: '1px solid var(--line)',
              borderRadius: '12px',
              boxShadow: '0 18px 40px rgba(0, 0, 0, 0.45)',
            }}
          >
            {PROMOTION_PIECES.map((piece) => (
              <button
                key={piece}
                type="button"
                aria-label={`Promote to ${piece}`}
                onClick={() => {
                  if (pendingPromotion.premove) {
                    onPremoveRef.current?.({
                      from: pendingPromotion.from,
                      to: pendingPromotion.to,
                      promotion: piece,
                    });
                    setPendingPromotion(null);
                    return;
                  }
                  commitMove(pendingPromotion.from, pendingPromotion.to, piece);
                }}
                style={{
                  width: '56px',
                  height: '56px',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: '38px',
                  lineHeight: 1,
                  cursor: 'pointer',
                  color: promotingColor === 'w' ? '#f4f6fa' : '#11151b',
                  background: promotingColor === 'w' ? palette.light : palette.dark,
                  border: '1px solid var(--line)',
                  borderRadius: '10px',
                }}
              >
                {GLYPHS[piece][promotingColor === 'w' ? 'white' : 'black']}
              </button>
            ))}
          </div>
        </div>
      )}
      </div>
    </div>
  );
});

export default ChessBoardWrapper;
