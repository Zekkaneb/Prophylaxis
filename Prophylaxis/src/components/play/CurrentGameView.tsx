import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Move } from 'chess.js';
import { BoardSlot } from '../../board/PersistentBoard';
import type { StockfishController } from '../../engine/useStockfish';
import {
  formatEvaluation,
  whiteAdvantagePercent,
} from '../../review/gameReviewService';
import type { ClockSnapshot } from '../../play/clock.ts';
import { opponentMeta } from '../../play/opponents.ts';
import { playerDisplayName, playerInitials } from '../../profile/playerProfile.ts';
import { usePlayerProfile } from '../../profile/usePlayerProfile.ts';
import { useTitleState } from '../../play/titleStore.ts';
import { ratingForSeconds, useRatingsMap } from '../../play/ratingStore.ts';
import { PlayerNameplate, botTitle } from '../PlayerNameplate';
import {
  describePremoveQueue,
  isPromotionPiece,
  premoveDisplayFen,
  type Premove,
} from '../../play/premove.ts';
import { usePremovesEnabled } from '../../play/premovePrefs.ts';
import { formatClock, formatDuration, timeControlLabel } from '../../play/timeControls.ts';
import type { PlaySession } from '../../play/usePlayGame';
import { resultReasonLabel, type PlayResult } from '../../play/types.ts';
import { CapturedPieces } from './CapturedPieces';
import { keepPlyVisible } from './keepPlyVisible';
import { OpponentAvatar } from './OpponentAvatar';
import { usePlyBrowser } from './usePlyBrowser';

type ConfirmKind = 'resign' | 'draw' | null;

/**
 * Dialogs render at the document root.
 *
 * The shared board is a fixed layer above the router (z-index 1), so anything
 * inside `.view` paints underneath it no matter how high its own z-index is.
 * Portalling keeps the result and confirmation dialogs above the board.
 */
function PlayOverlay({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}

const LOW_TIME_MS = 20_000;

/* The bar is a glance, not an analysis: a short search on the side that is
   thinking keeps it current without competing with the bot's own move search. */
const EVAL_DEPTH = 12;
const EVAL_MOVETIME_MS = 220;
const EVAL_DEBOUNCE_MS = 240;

export interface CurrentGameViewProps {
  session: PlaySession;
  clock: ClockSnapshot;
  /** Shared engine, used only to score the position the bar displays. */
  engine: StockfishController;
  botThinking: boolean;
  notice: string | null;
  onMove: (move: Move) => void;
  /** Queue, replace or clear (`null`) the premove. */
  onPremove: (move: Premove | null) => void;
  onResign: () => void;
  onDraw: () => void;
  onRematch: () => void;
  onNewGame: () => void;
  onHistory: () => void;
  onFlip: () => void;
  onReview: (gameId: string) => void;
  onDismissNotice: () => void;
  /**
   * Extra feedback for the end-of-game card, used by repertoire practice to
   * report the opening drill before the player leaves for the review.
   */
  practiceFeedback?: ReactNode;
}

/** "You won", "You lost" or "Draw", from the stored White-POV result. */
function outcomeTitle(result: PlayResult, playerColor: 'w' | 'b'): string {
  if (result === '1/2-1/2') return 'Draw';
  const playerWon =
    (result === '1-0' && playerColor === 'w') || (result === '0-1' && playerColor === 'b');
  return playerWon ? 'You won' : 'You lost';
}

function clockClass(active: boolean, low: boolean, untimed: boolean): string {
  return ['play-clock', active ? 'is-active' : '', low ? 'is-low' : '', untimed ? 'is-untimed' : '']
    .filter(Boolean)
    .join(' ');
}

/* One letter at a time, fast enough to read as speech rather than a loading
   state. A new line restarts from the first character; the timer stops when the
   line is complete, so an idle bot costs nothing. */
const TYPING_MS = 26;

function useTypedText(text: string | null): string {
  const [revealed, setRevealed] = useState(0);

  useEffect(() => {
    setRevealed(0);
    if (!text) return;

    let index = 0;
    let timer = 0;
    const step = () => {
      index += 1;
      setRevealed(index);
      if (index < text.length) timer = window.setTimeout(step, TYPING_MS);
    };
    timer = window.setTimeout(step, TYPING_MS);
    return () => window.clearTimeout(timer);
  }, [text]);

  return text ? text.slice(0, revealed) : '';
}

export function CurrentGameView({
  session,
  clock,
  engine,
  botThinking,
  notice,
  onMove,
  onPremove,
  onResign,
  onDraw,
  onRematch,
  onNewGame,
  onHistory,
  onFlip,
  onReview,
  onDismissNotice,
  practiceFeedback,
}: CurrentGameViewProps) {
  const [confirm, setConfirm] = useState<ConfirmKind>(null);
  /* The player's own card, editable on the Dashboard. */
  const profile = usePlayerProfile();
  const titleState = useTitleState();
  const ratings = useRatingsMap();
  /* The board prints the rating for *this* game's time control — the real one,
     never a number typed into a profile. */
  const ownRating =
    ratingForSeconds(ratings, session.config.initialSeconds, session.config.untimed) ||
    profile.elo;
  const movesRef = useRef<HTMLDivElement | null>(null);
  /** White-POV score of the position on the board, for the evaluation bar. */
  const [evalScore, setEvalScore] = useState<{ cp: number; mate: number | null }>({
    cp: 0,
    mate: null,
  });
  /* The bar is a study aid, not part of the game: a player may hide it. While
     hidden the search stops too, so no engine time is spent on a hidden gauge. */
  const [showEval, setShowEval] = useState(true);
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const engineStatus = engine.status;

  useEffect(() => {
    setConfirm(null);
  }, [session.id]);

  const playing = session.status === 'playing';
  const playerTurn = session.turn === session.playerColor;
  /* The board stays live during the opponent's turn so a premove can be
     selected; real moves are still gated by the position's side to move. */
  const interactive = playing;
  const opponentColor = session.playerColor === 'w' ? 'b' : 'w';
  const premoves = session.premoves;
  /* The gameplay setting: with premoves off the board never enters the queued
     state, and an existing queue is simply not shown or played. */
  const premovesEnabled = usePremovesEnabled();
  /* Stepping back replays the SAN list: the board shows that snapshot and stops
     accepting moves until the cursor returns to the live position. */
  const browser = usePlyBrowser(session.sans, session.fen, {
    playerColor: session.playerColor,
  });
  /* The rail is the only place a line is printed; it types itself in there. */
  const typed = useTypedText(session.reaction?.text ?? null);
  const reviewing = !browser.atLive;
  /* While browsing, the highlighted seat follows the snapshot on the board, not
     the live game behind it. */
  const shownTurn = reviewing ? browser.turn : session.turn;
  /* The side at the bottom of the board owns the bottom plate. When the player
     flips to the other colour, the two plates swap with it instead of sitting
     next to the wrong side. */
  const playerSide = session.playerColor === 'w' ? 'white' : 'black';
  const seatsFlipped = playerSide !== session.orientation;

  const rows = useMemo(() => {
    const result: Array<{ number: number; white: string; black: string | null }> = [];
    for (let index = 0; index < session.sans.length; index += 2) {
      result.push({
        number: index / 2 + 1,
        white: session.sans[index] ?? '',
        black: session.sans[index + 1] ?? null,
      });
    }
    return result;
  }, [session.sans]);

  /* Keep the inspected move visible, whether it moved because a new ply landed
     or because the reader clicked further back. Only the list scrolls: a phone
     must never be dragged down to the notation and away from the board. */
  useEffect(() => {
    keepPlyVisible(movesRef.current);
  }, [browser.ply, session.sans.length]);
  /* The board's position decides the bar, so stepping back through history
     scores the snapshot on screen rather than the live game behind it. */
  const shownFen = browser.fen;

  /* Chess.com draws the queue by moving the pieces: each premoved piece sits on
     its target immediately, with the origin and destination marked in red. The
     board is fed that projection and told not to project it again, so a chained
     premove can be picked up from the square the previous one reached. The real
     position is untouched - `usePlayGame` still judges the head of the queue
     against it when the opponent's move lands. */
  const boardFen = useMemo(
    () =>
      reviewing || premoves.length === 0
        ? browser.fen
        : premoveDisplayFen(browser.fen, premoves, session.playerColor),
    [browser.fen, premoves, reviewing, session.playerColor],
  );
  useEffect(() => {
    /* `idle` is fine: the first request starts the worker. Only a failed engine
       leaves the bar at the score it already shows. */
    if (!showEval || engineStatus === 'error' || botThinking) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void engineRef.current
        .evaluateWithin(shownFen, EVAL_DEPTH, 1, EVAL_MOVETIME_MS)
        .then((result) => {
          if (cancelled) return;
          setEvalScore({ cp: result.scoreCp, mate: result.mate });
        })
        .catch(() => {
          /* A busy or failed search leaves the previous score on the bar. */
        });
    }, EVAL_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [shownFen, botThinking, engineStatus, showEval]);

  const playerClockMs = session.playerColor === 'w' ? clock.whiteMs : clock.blackMs;
  const opponentClockMs = session.playerColor === 'w' ? clock.blackMs : clock.whiteMs;
  const playerClockActive = playing && clock.active === session.playerColor;
  const opponentClockActive = playing && clock.active === opponentColor;
  const untimed = session.config.untimed;

  /* Pawns ahead from the player's seat; the opponent's row reads the inverse. */
  const playerAdvantage = browser.material * (session.playerColor === 'w' ? 1 : -1);

  const finished = session.status === 'finished' && session.result !== null;
  /* Play time, not wall-clock time since the first move: leaving a game
     overnight must not print "47h 27m" on the result card. Older sessions
     without the measurement fall back to the old behaviour. */
  const duration =
    session.elapsedMs !== undefined
      ? session.elapsedMs / 1000
      : session.endedAt
        ? (session.endedAt - session.startedAt) / 1000
        : 0;

  function confirmAction() {
    if (confirm === 'resign') onResign();
    if (confirm === 'draw') onDraw();
    setConfirm(null);
  }

  const whitePercent = whiteAdvantagePercent(evalScore.cp, evalScore.mate);

  return (
    <div className="play-current">
      {/* Left rail: who you are playing and the shape of this game. The seats
          beside the board own the clocks, so the rail only carries reference
          facts instead of repeating them. */}
      <aside className="play-rail play-rail--left" aria-label="Game details">
        <div className="play-rail__card">
          <section className="play-rail__section">
            <div className="play-side__head">
              <p className="play-eyebrow">Opponent</p>
              <span className="play-side__count">{opponentMeta(session.opponent)}</span>
            </div>
            <div className="play-rail__who">
              <OpponentAvatar opponent={session.opponent} size="lg" loading="eager" />
              <div className="play-rail__identity">
                <h2>{session.opponent.name}</h2>
                <p className="play-preview__elo">
                  {session.opponent.title ?? session.opponent.shortName} ·{' '}
                  {session.opponent.elo} Elo
                </p>
              </div>
            </div>
            {session.opponent.kind === 'personality' ? (
              /* The card speaks: the bot's latest line, typed out letter by
                 letter. The visible copy is hidden from assistive tech and the
                 finished line is announced once instead of per keystroke. */
              <div className="play-rail__talk">
                <p className="play-eyebrow">Says</p>
                <p className="play-rail__line">
                  {session.reaction ? (
                    <>
                      <span aria-hidden="true" key={session.reaction.at}>
                        {typed}
                      </span>
                      <span className="visually-hidden" aria-live="polite">
                        {session.reaction.text}
                      </span>
                    </>
                  ) : null}
                </p>
              </div>
            ) : (
              /* The engine has no voice of its own, so it keeps its brief. */
              <p className="play-rail__style">{session.opponent.style}</p>
            )}
          </section>

          <section className="play-rail__section">
            <div className="play-side__head">
              <p className="play-eyebrow">Game</p>
              <span className={`play-side__status${reviewing ? ' is-reviewing' : ''}`}>
                {reviewing ? 'Reviewing' : playing ? 'Live' : 'Finished'}
              </span>
            </div>
            <dl className="play-facts">
              <div>
                <dt>Time control</dt>
                <dd>
                  {timeControlLabel(
                    session.config.initialSeconds,
                    session.config.incrementSeconds,
                  )}
                </dd>
              </div>
              <div>
                <dt>You played</dt>
                <dd>{session.playerColor === 'w' ? 'White' : 'Black'}</dd>
              </div>
            </dl>
          </section>
        </div>
      </aside>

      <div className="play-stage">
        <div className={`play-stage__stack${seatsFlipped ? ' is-seats-flipped' : ''}`}>
        <div
          className={`play-seat play-seat--opponent${
            playing && shownTurn === opponentColor ? ' is-active' : ''
          }`}
        >
          <OpponentAvatar opponent={session.opponent} size="md" loading="eager" />
          <div className="play-seat__id">
            <span className="play-seat__name">
              <span
                className={`play-seat__dot play-seat__dot--${opponentColor === 'w' ? 'white' : 'black'}`}
                aria-hidden="true"
              />
              <PlayerNameplate
                name={session.opponent.name}
                rating={session.opponent.elo}
                title={botTitle(session.opponent.elo)}
                size="sm"
              />
            </span>
            <CapturedPieces
              pieces={browser.captured[opponentColor]}
              color={session.playerColor}
              advantage={-playerAdvantage}
            />
          </div>
          <span
            className={clockClass(
              opponentClockActive,
              !untimed && opponentClockMs < LOW_TIME_MS,
              untimed,
            )}
            aria-label={`Opponent clock ${untimed ? 'untimed' : formatClock(opponentClockMs)}`}
          >
            {untimed ? '—' : formatClock(opponentClockMs)}
          </span>
        </div>

        <div className="play-board-wrap">
          {/* Flush against the board's first file: the bar is the board's left
              margin, not a floating chip. */}
          {showEval ? (
            <div
              className={`play-eval-wrap${
                session.orientation === 'black' ? ' is-flipped' : ''
              }`}
            >
              <span className={`play-eval__label${whitePercent >= 50 ? ' is-white' : ' is-black'}`}>
                {formatEvaluation(evalScore.cp, evalScore.mate)}
              </span>
              <div className="play-eval" aria-hidden="true">
                <div className="play-eval__fill" style={{ height: `${whitePercent}%` }} />
              </div>
            </div>
          ) : null}
          <BoardSlot
            props={{
              /* While reviewing, the board shows the replayed snapshot and is
                 read-only; the live position is one click away. */
              fen: boardFen,
              premovesProjected: true,
              orientation: session.orientation,
              interactive: interactive && !reviewing,
              highlightLastMove: true,
              highlightCheck: true,
              lastMove: browser.lastMove,
              /* The hook scores moves (it knows who moved and whether the game
                 just ended), so the board must not also cue them. */
              soundFeedback: false,
              premoveColor:
                playing && !reviewing && premovesEnabled ? session.playerColor : null,
              premoves: reviewing || !premovesEnabled ? [] : premoves,
              onPremoveChange: (move) =>
                onPremove(
                  move
                    ? {
                        from: move.from,
                        to: move.to,
                        ...(isPromotionPiece(move.promotion)
                          ? { promotion: move.promotion }
                          : {}),
                      }
                    : null,
                ),
              onMove: (move) => onMove(move),
            }}
          />
        </div>

        <div
          className={`play-seat play-seat--self${
            playing && shownTurn === session.playerColor ? ' is-active' : ''
          }`}
        >
          <span className="play-avatar play-avatar--md play-avatar--self" aria-hidden="true">
            {profile.avatar ? (
              <img className="play-avatar__photo" src={profile.avatar} alt="" />
            ) : (
              <span className="play-avatar__initial">{playerInitials(profile)}</span>
            )}
          </span>
          <div className="play-seat__id">
            <span className="play-seat__name">
              <span
                className={`play-seat__dot play-seat__dot--${session.playerColor === 'w' ? 'white' : 'black'}`}
                aria-hidden="true"
              />
              <PlayerNameplate
                name={playerDisplayName(profile)}
                rating={ownRating}
                title={titleState.worn}
                size="sm"
              />
            </span>
            <span className="play-seat__meta">You</span>
            <CapturedPieces
              pieces={browser.captured[session.playerColor]}
              color={opponentColor}
              advantage={playerAdvantage}
            />
          </div>
          <span
            className={clockClass(
              playerClockActive,
              !untimed && playerClockMs < LOW_TIME_MS,
              untimed,
            )}
            aria-label={`Your clock ${untimed ? 'untimed' : formatClock(playerClockMs)}`}
          >
            {untimed ? '—' : formatClock(playerClockMs)}
          </span>
        </div>

        <p className="play-turn" role="status">
          {reviewing
            ? `Move ${browser.ply} of ${browser.total} · ${browser.turn === 'w' ? 'White' : 'Black'} to move`
            : finished
              ? 'Game over'
              : premoves.length > 1
                ? `${premoves.length} premoves queued · click or Esc to clear`
                : premoves.length === 1
                  ? 'Premove queued · click or Esc to cancel'
                  : botThinking
                  ? 'Opponent is thinking…'
                  : playerTurn
                    ? 'Your move'
                    : 'Opponent to move'}
        </p>

        {/* Transport lives under the board, where the review screen keeps it:
            the right rail is for reading moves and acting on the game. */}
        <div className="play-review__nav play-stage__nav" role="group" aria-label="Move browser">
          <button
            type="button"
            className="play-nav__btn"
            onClick={browser.first}
            disabled={browser.ply === 0}
            aria-label="Start position"
            title="Start position (Home)"
          >
            «
          </button>
          <button
            type="button"
            className="play-nav__btn"
            onClick={browser.prev}
            disabled={browser.ply === 0}
            aria-label="Previous move"
            title="Previous move (←)"
          >
            ‹
          </button>
          <span className="play-review__counter">
            <strong>{browser.ply}</strong> / {browser.total}
          </span>
          <button
            type="button"
            className="play-nav__btn"
            onClick={browser.next}
            disabled={browser.atLive}
            aria-label="Next move"
            title="Next move (→)"
          >
            ›
          </button>
          <button
            type="button"
            className="play-nav__btn"
            onClick={browser.last}
            disabled={browser.atLive}
            aria-label="Latest position"
            title="Latest position (End)"
          >
            »
          </button>
          <button
            type="button"
            className="play-nav__btn play-nav__flip"
            onClick={onFlip}
            aria-label="Flip board"
            title="Flip board"
          >
            ⇅
          </button>
          <button
            type="button"
            className="play-nav__btn play-nav__flip"
            onClick={() => setShowEval((current) => !current)}
            aria-pressed={showEval}
            aria-label={showEval ? 'Hide evaluation bar' : 'Show evaluation bar'}
            title={showEval ? 'Hide evaluation bar' : 'Show evaluation bar'}
          >
            ±
          </button>
          <span className={`play-review__turn${reviewing ? ' is-reviewing' : ''}`}>
            {reviewing ? 'Reviewing' : 'Live'}
          </span>
          {reviewing ? (
            <button type="button" className="play-live-return" onClick={browser.last}>
              Back to live ›
            </button>
          ) : null}
        </div>
        </div>
      </div>

      <aside className="play-rail play-rail--right" aria-label="Moves and game actions">
        <div className="play-rail__card">
          <div className="play-side__head">
            <p className="play-eyebrow">Moves</p>
            <span className="play-side__count">{session.sans.length} plies</span>
          </div>
          <div className="play-moves" ref={movesRef} tabIndex={0} aria-label="Move list">
            {rows.length === 0 ? (
              <p className="play-moves__empty">No moves yet.</p>
            ) : (
              rows.map((row) => {
                const whitePly = (row.number - 1) * 2 + 1;
                const blackPly = whitePly + 1;
                return (
                  <div className="play-moves__row" key={row.number}>
                    <span className="play-moves__num">{row.number}.</span>
                    {row.white ? (
                      <button
                        type="button"
                        className={`play-moves__ply play-moves__ply--button${
                          browser.ply === whitePly ? ' is-selected' : ''
                        }`}
                        onClick={() => browser.go(whitePly)}
                        aria-current={browser.ply === whitePly}
                      >
                        {row.white}
                      </button>
                    ) : (
                      <span className="play-moves__ply is-empty" />
                    )}
                    {row.black ? (
                      <button
                        type="button"
                        className={`play-moves__ply play-moves__ply--button${
                          browser.ply === blackPly ? ' is-selected' : ''
                        }`}
                        onClick={() => browser.go(blackPly)}
                        aria-current={browser.ply === blackPly}
                      >
                        {row.black}
                      </button>
                    ) : (
                      <span className="play-moves__ply is-empty" />
                    )}
                  </div>
                );
              })
            )}
          </div>
          <p className="play-side__footnote">Click a move or use ← → to look back.</p>

          {notice ? (
            <div className="play-notice" role="status">
              <span>{notice}</span>
              <button type="button" onClick={onDismissNotice} aria-label="Dismiss message">
                ×
              </button>
            </div>
          ) : null}

          {/* Queued intentions, then the buttons that end the game: the
              actions are the rail's floor, always on it. */}
          <div className="play-rail__foot">
            {premoves.length > 0 ? (
              <p className="play-premove-queue">
                <span className="play-premove-queue__label">Queued</span>
                {describePremoveQueue(session.fen, premoves, session.playerColor).join(' · ')}
              </p>
            ) : null}
            <div className="play-actions">
              <button
                type="button"
                className="play-action"
                onClick={() => setConfirm('draw')}
                disabled={!playing}
              >
                ½ Draw
              </button>
              <button
                type="button"
                className="play-action"
                onClick={() => setConfirm('resign')}
                disabled={!playing}
              >
                Resign
              </button>
              {premoves.length > 0 ? (
                <button
                  type="button"
                  className="play-action play-action--premove"
                  onClick={() => onPremove(null)}
                >
                  {premoves.length > 1 ? 'Clear premoves' : 'Clear premove'}
                </button>
              ) : null}
              <button type="button" className="play-action" onClick={onNewGame}>
                New game
              </button>
            </div>
          </div>
        </div>
      </aside>

      {confirm ? (
        <PlayOverlay>
        <div
          className="play-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="play-confirm-title"
        >
          <div className="play-modal__card">
            <p className="play-eyebrow">
              {confirm === 'resign' ? 'End the game' : 'Draw offer'}
            </p>
            <h3 id="play-confirm-title">
              {confirm === 'resign' ? 'Resign this game?' : 'Offer a draw?'}
            </h3>
            <p>
              {confirm === 'resign'
                ? 'The game will be recorded as a loss and saved to your history.'
                : 'The opponent accepts only if the position is close to equal.'}
            </p>
            <div className="play-modal__actions">
              <button type="button" className="secondary-btn" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button type="button" className="primary-btn" onClick={confirmAction}>
                {confirm === 'resign' ? 'Resign' : 'Offer draw'}
              </button>
            </div>
          </div>
        </div>
        </PlayOverlay>
      ) : null}

      {finished && session.result ? (
        <PlayOverlay>
        <div className="play-end" role="dialog" aria-modal="true" aria-labelledby="play-end-title">
          <div className="play-end__card">
            <OpponentAvatar opponent={session.opponent} size="lg" loading="eager" />
            <p className="play-eyebrow">{resultReasonLabel(session.reason ?? 'checkmate')}</p>
            <h3 id="play-end-title">{outcomeTitle(session.result, session.playerColor)}</h3>
            <p className="play-end__score">
              {session.result} · {session.sans.length} plies · {formatDuration(duration)}
            </p>
            {session.ratingDelta !== null ? (
              <p
                className={`play-end__elo is-${session.ratingDelta > 0 ? 'up' : session.ratingDelta < 0 ? 'down' : 'flat'}`}
              >
                {session.ratingDelta > 0 ? `+${session.ratingDelta}` : session.ratingDelta} Elo
                {session.ratingAfter ? ` · now ${session.ratingAfter}` : ''}
              </p>
            ) : null}
            {practiceFeedback}
            {session.reaction ? (
              <p className="play-end__line">{session.reaction.text}</p>
            ) : null}
            {session.saveError ? (
              <p className="play-end__warn">{session.saveError}</p>
            ) : (
              <p className="play-end__saved">
                {session.savedGameId ? 'Saved to Game History.' : 'Saving game…'}
              </p>
            )}
            <div className="play-modal__actions">
              <button type="button" className="primary-btn" onClick={onRematch}>
                Rematch
              </button>
              {session.savedGameId ? (
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => onReview(session.savedGameId as string)}
                >
                  Review game
                </button>
              ) : null}
              <button type="button" className="secondary-btn" onClick={onHistory}>
                Game History
              </button>
            </div>
            <button type="button" className="play-link" onClick={onNewGame}>
              Set up a new game
            </button>
          </div>
        </div>
        </PlayOverlay>
      ) : null}
    </div>
  );
}
