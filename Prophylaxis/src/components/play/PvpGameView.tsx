import { useState } from 'react';
import { createPortal } from 'react-dom';
import { BoardSlot } from '../../board/PersistentBoard';
import { formatClock } from '../../play/timeControls.ts';
import { bonusTypeLabel, pvpTimeControlLabel, type PvpTimeControl } from '../../play/pvp.ts';
import { resultReasonLabel, type PlayColor } from '../../play/types.ts';
import type { PvpGame } from '../../play/useLocalPvp';
import { useTitleState } from '../../play/titleStore.ts';
import { ratingForSeconds, useRatingsMap } from '../../play/ratingStore.ts';
import type { TitleId } from '../../play/titles.ts';
import { PlayerNameplate } from '../PlayerNameplate';

/**
 * The online board.
 *
 * Laid out like the regular playing room — opponent on the left, the board
 * between two clocks, moves and the game-ending actions on the right — so
 * playing a person reads like playing a bot. Both seats carry the name and
 * rating of whoever is in them, and the only resignation on offer is your own.
 */

const LOW_MS = 20_000;

export interface PvpSeatIdentity {
  name: string;
  elo: number;
  avatar?: string;
  /** The title this seat wears, so the badge travels with presence. */
  title?: TitleId | null;
}

function initialsFor(identity: PvpSeatIdentity): string {
  return (
    identity.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}

function SeatAvatar({ identity, self }: { identity: PvpSeatIdentity; self: boolean }) {
  /* The picture travels in presence, so the opponent arrives with a face. */
  const photo = identity.avatar;
  return (
    <span
      className={`play-avatar play-avatar--md${self ? ' play-avatar--self' : ''}`}
      aria-hidden="true"
    >
      {photo ? (
        <img className="play-avatar__photo" src={photo} alt="" />
      ) : (
        <span className="play-avatar__initial">{initialsFor(identity)}</span>
      )}
    </span>
  );
}

function SeatClock({
  ms,
  active,
  untimed,
  delayMs,
  inDelay,
}: {
  ms: number;
  active: boolean;
  untimed: boolean;
  delayMs: number;
  inDelay: boolean;
}) {
  return (
    <span
      className={[
        'play-clock',
        active ? 'is-active' : '',
        !untimed && ms < LOW_MS ? 'is-low' : '',
        untimed ? 'is-untimed' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={`Clock ${untimed ? 'untimed' : formatClock(ms)}`}
      role="timer"
    >
      {untimed ? '—' : formatClock(ms)}
      {inDelay ? <small className="pvp-delay">{formatClock(delayMs)}</small> : null}
    </span>
  );
}

export function PvpGameView({
  game,
  control,
  code,
  ownSide,
  self,
  opponent,
  onResign,
  onExit,
  ratingMove,
}: {
  game: PvpGame;
  control: PvpTimeControl;
  code: string;
  /** The side this screen plays; resigning is limited to it. */
  ownSide: PlayColor;
  self: PvpSeatIdentity;
  opponent: PvpSeatIdentity | null;
  /** Ends the game for this screen's own side only. */
  onResign: () => void;
  onExit: () => void;
  /** What the finished game did to this side's rating, once it has settled. */
  ratingMove?: { delta: number; after: number } | null;
}) {
  const { state, clock, playMove, playing, canMove } = game;
  const titleState = useTitleState();
  const ratings = useRatingsMap();
  const ownRating = ratingForSeconds(ratings, control.initialSeconds, control.untimed);
  const [confirmResign, setConfirmResign] = useState(false);

  const untimed = control.untimed;
  const finished = state.status === 'finished';
  /* Your own side is always the one at the bottom, and the board faces it —
     the online room has no second seat to flip for. */
  const bottomSide: PlayColor = ownSide;
  const topSide: PlayColor = ownSide === 'w' ? 'b' : 'w';
  const boardOrientation = ownSide === 'w' ? 'white' : 'black';

  const identityFor = (side: PlayColor): PvpSeatIdentity => {
    if (side === ownSide) return self;
    return opponent ?? { name: 'Waiting for opponent', elo: 0 };
  };

  const sideLabel = (side: PlayColor) => (side === 'w' ? 'White' : 'Black');

  const rows: Array<{ number: number; white: string; black: string | null }> = [];
  for (let index = 0; index < state.sans.length; index += 2) {
    rows.push({
      number: index / 2 + 1,
      white: state.sans[index] ?? '',
      black: state.sans[index + 1] ?? null,
    });
  }

  const seatProps = (side: PlayColor) => {
    const identity = identityFor(side);
    return {
      side,
      identity,
      self: side === ownSide,
      ms: side === 'w' ? clock.whiteMs : clock.blackMs,
      active: playing && state.turn === side,
      untimed,
      delayMs: clock.delayMs,
      inDelay: clock.inDelay && state.turn === side,
    };
  };

  const top = seatProps(topSide);
  const bottom = seatProps(bottomSide);

  return (
    <div className="play-current pvp-current">
      <aside className="play-rail play-rail--left" aria-label="Opponent and game">
        <div className="play-rail__card">
          <section className="play-rail__section">
            <div className="play-side__head">
              <p className="play-eyebrow">Opponent</p>
              <span className="play-side__count">
                {opponent ? `${sideLabel(ownSide === 'w' ? 'b' : 'w')} · ${opponent.elo} Elo` : 'Empty seat'}
              </span>
            </div>
            <div className="play-rail__who">
              <SeatAvatar identity={identityFor(ownSide === 'w' ? 'b' : 'w')} self={false} />
              <div className="play-rail__identity">
                <h2>{identityFor(ownSide === 'w' ? 'b' : 'w').name}</h2>
                <p className="play-preview__elo">
                  {opponent ? `${sideLabel(ownSide === 'w' ? 'b' : 'w')} · ${opponent.elo} Elo` : 'Waiting for someone to join'}
                </p>
              </div>
            </div>
            <p className="play-rail__style">
              Room {code} · {pvpTimeControlLabel(control)} · {bonusTypeLabel(control.bonusType)}
            </p>
          </section>

          <section className="play-rail__section">
            <div className="play-side__head">
              <p className="play-eyebrow">Game</p>
              <span className={`play-side__status${finished ? '' : ' is-live'}`}>
                {finished ? 'Finished' : 'Live'}
              </span>
            </div>
            <dl className="play-facts">
              <div>
                <dt>Time control</dt>
                <dd>{pvpTimeControlLabel(control)}</dd>
              </div>
              <div>
                <dt>You played</dt>
                <dd>{sideLabel(ownSide)}</dd>
              </div>
              <div>
                <dt>Room</dt>
                <dd>{code}</dd>
              </div>
            </dl>
          </section>
        </div>
      </aside>

      <div className="play-stage">
        <div className="play-stage__stack">
          <div className={`play-seat play-seat--opponent${top.active ? ' is-active' : ''}`}>
            <SeatAvatar identity={top.identity} self={false} />
            <div className="play-seat__id">
              <span className="play-seat__name">
                <span
                  className={`play-seat__dot play-seat__dot--${top.side === 'w' ? 'white' : 'black'}`}
                  aria-hidden="true"
                />
                <PlayerNameplate
                  name={top.identity.name}
                  rating={top.identity.elo}
                  title={top.identity.title ?? null}
                  size="sm"
                />
              </span>
              <span className="play-seat__meta">{sideLabel(top.side)}</span>
            </div>
            <SeatClock
              ms={top.ms}
              active={top.active}
              untimed={untimed}
              delayMs={top.delayMs}
              inDelay={top.inDelay}
            />
          </div>

          <div className="play-board-wrap">
            <BoardSlot
              props={{
                fen: state.fen,
                orientation: boardOrientation,
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

          <div className={`play-seat play-seat--self${bottom.active ? ' is-active' : ''}`}>
            <SeatAvatar identity={bottom.identity} self={bottom.side === ownSide} />
            <div className="play-seat__id">
              <span className="play-seat__name">
                <span
                  className={`play-seat__dot play-seat__dot--${bottom.side === 'w' ? 'white' : 'black'}`}
                  aria-hidden="true"
                />
                <PlayerNameplate
                  name={bottom.identity.name}
                  rating={
                    bottom.side === ownSide ? ownRating || bottom.identity.elo : bottom.identity.elo
                  }
                  title={bottom.side === ownSide ? titleState.worn : (bottom.identity.title ?? null)}
                  size="sm"
                />
              </span>
              <span className="play-seat__meta">
                {bottom.side === ownSide ? 'You · ' : ''}
                {sideLabel(bottom.side)}
              </span>
            </div>
            <SeatClock
              ms={bottom.ms}
              active={bottom.active}
              untimed={untimed}
              delayMs={bottom.delayMs}
              inDelay={bottom.inDelay}
            />
          </div>

          <p className="play-turn" role="status">
            {finished
              ? 'Game over'
              : !playing
                ? 'Waiting…'
                : canMove
                  ? 'Your move'
                  : `${identityFor(topSide).name} to move`}
          </p>

          <div className="play-review__nav play-stage__nav" role="group" aria-label="Game state">
            <span className="play-review__turn">{finished ? 'Finished' : 'Live'}</span>
          </div>
        </div>
      </div>

      <aside className="play-rail play-rail--right" aria-label="Moves and actions">
        <div className="play-rail__card">
          <div className="play-side__head">
            <p className="play-eyebrow">Moves</p>
            <span className="play-side__count">{state.sans.length} plies</span>
          </div>
          <div className="play-moves" tabIndex={0} aria-label="Move list">
            {rows.length === 0 ? (
              <p className="play-moves__empty">No moves yet.</p>
            ) : (
              rows.map((row) => (
                <div className="play-moves__row" key={row.number}>
                  <span className="play-moves__num">{row.number}.</span>
                  <span className="play-moves__ply">{row.white}</span>
                  <span className={`play-moves__ply${row.black ? '' : ' is-empty'}`}>
                    {row.black ?? ''}
                  </span>
                </div>
              ))
            )}
          </div>
          <p className="play-side__footnote">Both clocks run on the mover's side only.</p>

          <div className="play-rail__foot">
            <div className="play-actions">
              <button
                type="button"
                className="play-action"
                onClick={() => setConfirmResign(true)}
                disabled={finished}
              >
                Resign
              </button>
              <button type="button" className="play-action" onClick={onExit}>
                New game
              </button>
            </div>
          </div>
        </div>
      </aside>

      {confirmResign ? (
        createPortal(
          <div className="play-modal" role="dialog" aria-modal="true" aria-labelledby="pvp-resign-title">
            <div className="play-modal__card">
              <p className="play-eyebrow">End the game</p>
              <h3 id="pvp-resign-title">Resign as {sideLabel(ownSide)}?</h3>
              <p>Your opponent is told at once and the game is theirs.</p>
              <div className="play-modal__actions">
                <button type="button" className="secondary-btn" onClick={() => setConfirmResign(false)}>
                  Keep playing
                </button>
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => {
                    setConfirmResign(false);
                    onResign();
                  }}
                >
                  Resign
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      ) : null}

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
              {ratingMove ? (
                <p
                  className={`play-end__elo is-${ratingMove.delta > 0 ? 'up' : ratingMove.delta < 0 ? 'down' : 'flat'}`}
                >
                  {ratingMove.delta > 0 ? `+${ratingMove.delta}` : ratingMove.delta} Elo · now{' '}
                  {ratingMove.after}
                </p>
              ) : null}
              <div className="play-modal__actions">
                <button type="button" className="primary-btn" onClick={onExit}>
                  Back to the lobby
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
