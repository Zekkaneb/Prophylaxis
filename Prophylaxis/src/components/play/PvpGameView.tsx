import { createPortal } from 'react-dom';
import { BoardSlot } from '../../board/PersistentBoard';
import { formatClock } from '../../play/timeControls.ts';
import { bonusTypeLabel, pvpTimeControlLabel, type PvpTimeControl } from '../../play/pvp.ts';
import { resultReasonLabel, type PlayColor } from '../../play/types.ts';
import type { PvpGame } from '../../play/useLocalPvp';

/**
 * Pass-and-play board: one clock per side, each on its own edge of the board, so
 * whoever is at the bottom of the screen owns the clock nearest them. With
 * auto-flip on, the board turns after every move and the clocks turn with it.
 */

const LOW_MS = 20_000;

function clockClass(active: boolean, low: boolean): string {
  return ['pvp-clock', active ? 'is-active' : '', low ? 'is-low' : '']
    .filter(Boolean)
    .join(' ');
}

function PvpSeat({
  side,
  label,
  ms,
  active,
  untimed,
  delayMs,
  inDelay,
  onResign,
  finished,
}: {
  side: PlayColor;
  label: string;
  ms: number;
  active: boolean;
  untimed: boolean;
  delayMs: number;
  inDelay: boolean;
  onResign: () => void;
  finished: boolean;
}) {
  return (
    <div className={`pvp-seat${active ? ' is-active' : ''}`}>
      <span className="pvp-seat__side">
        <span
          className={`play-seat__dot play-seat__dot--${side === 'w' ? 'white' : 'black'}`}
          aria-hidden="true"
        />
        {label}
      </span>
      <span
        className={clockClass(active, !untimed && ms < LOW_MS)}
        aria-label={`${label} clock ${untimed ? 'untimed' : formatClock(ms)}`}
        role="timer"
      >
        {untimed ? '—' : formatClock(ms)}
      </span>
      {inDelay ? (
        <span className="pvp-seat__delay" aria-label="Delay remaining">
          delay {formatClock(delayMs)}
        </span>
      ) : null}
      <button
        type="button"
        className="pvp-seat__resign"
        onClick={onResign}
        disabled={finished}
        aria-label={`${label} resigns`}
      >
        Resign
      </button>
    </div>
  );
}

export function PvpGameView({
  game,
  control,
  onExit,
  onRematch,
  online,
}: {
  game: PvpGame;
  control: PvpTimeControl;
  onExit: () => void;
  onRematch: () => void;
  /** Present in an online room: the code and which seat this screen owns. */
  online?: { code: string; side: PlayColor };
}) {
  const { state, clock, orientation, playMove, pause, resume, resign, flip, playing, paused, canMove } =
    game;
  const untimed = control.untimed;

  /* The board's bottom edge belongs to whichever side the board shows at the
     bottom, so the two clock plates read as that side and its opponent. */
  const bottomSide: PlayColor = orientation === 'white' ? 'w' : 'b';
  const topSide: PlayColor = bottomSide === 'w' ? 'b' : 'w';
  const sideLabel = (side: PlayColor) => (side === 'w' ? 'White' : 'Black');
  const finished = state.status === 'finished';

  const seatProps = (side: PlayColor) => ({
    side,
    label: sideLabel(side),
    ms: side === 'w' ? clock.whiteMs : clock.blackMs,
    active: playing && state.turn === side,
    untimed,
    delayMs: clock.delayMs,
    inDelay: clock.inDelay && state.turn === side,
    onResign: () => resign(side),
    finished,
  });

  const moves: Array<{ number: number; white: string; black: string | null }> = [];
  for (let index = 0; index < state.sans.length; index += 2) {
    moves.push({
      number: index / 2 + 1,
      white: state.sans[index] ?? '',
      black: state.sans[index + 1] ?? null,
    });
  }

  return (
    <div className="pvp-game">
      <div className="pvp-bar">
        <div className="pvp-bar__meta">
          <p className="play-eyebrow">
            {online ? `Room ${online.code} · you are ${online.side === 'w' ? 'White' : 'Black'}` : 'Pass and play'}
          </p>
          <p className="pvp-bar__control">
            {pvpTimeControlLabel(control)}
            <span className="pvp-bar__bonus">· {bonusTypeLabel(control.bonusType)}</span>
          </p>
        </div>
        <div className="pvp-bar__actions">
          {online ? null : (
            <button
              type="button"
              className="secondary-btn"
              onClick={paused ? resume : pause}
              disabled={finished}
            >
              {paused ? 'Resume' : 'Pause'}
            </button>
          )}
          <button type="button" className="play-action" onClick={flip} disabled={finished}>
            Flip
          </button>
          <button type="button" className="play-action" onClick={onExit}>
            New game
          </button>
        </div>
      </div>

      <div className="pvp-stage">
        <PvpSeat {...seatProps(topSide)} />

        <div className="pvp-board-wrap">
          <BoardSlot
            props={{
              fen: state.fen,
              orientation,
              interactive: canMove,
              highlightLastMove: true,
              highlightCheck: true,
              lastMove: state.lastMove,
              soundFeedback: false,
              onMove: (move) => {
                playMove(move.from, move.to, move.promotion);
              },
            }}
          />
        </div>

        <PvpSeat {...seatProps(bottomSide)} />
      </div>

      <div className="pvp-foot">
        <p className="play-turn" role="status">
          {finished
            ? 'Game over'
            : paused
              ? 'Paused — both clocks are stopped'
              : `${sideLabel(state.turn)} to move`}
        </p>
        <div className="pvp-moves" aria-label="Move list">
          {moves.length === 0 ? (
            <p className="play-moves__empty">No moves yet.</p>
          ) : (
            moves.map((row) => (
              <span key={row.number} className="pvp-moves__row">
                <span className="play-moves__num">{row.number}.</span>
                <span>{row.white}</span>
                <span>{row.black ?? ''}</span>
              </span>
            ))
          )}
        </div>
      </div>

      {finished && state.result ? (
        createPortal(
          <div className="play-end" role="dialog" aria-modal="true" aria-labelledby="pvp-end-title">
            <div className="play-end__card">
              <p className="play-eyebrow">{resultReasonLabel(state.reason ?? 'checkmate')}</p>
              <h3 id="pvp-end-title">
                {state.result === '1/2-1/2'
                  ? 'Draw'
                  : state.result === '1-0'
                    ? 'White wins'
                    : 'Black wins'}
              </h3>
              {state.flaggedColor ? (
                <p className="play-end__score">
                  {sideLabel(state.flaggedColor)} ran out of time
                </p>
              ) : (
                <p className="play-end__score">
                  {state.result} · {state.sans.length} plies
                </p>
              )}
              <div className="play-modal__actions">
                <button type="button" className="primary-btn" onClick={onRematch}>
                  Play again
                </button>
                <button type="button" className="secondary-btn" onClick={onExit}>
                  Change the time control
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      ) : null}
    </div>
  );
}

export default PvpGameView;
