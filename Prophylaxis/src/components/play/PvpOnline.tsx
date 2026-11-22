import { useEffect, useRef } from 'react';
import { useState } from 'react';
import { bonusTypeLabel, pvpTimeControlLabel, type PvpTimeControl } from '../../play/pvp.ts';
import { useLocalPvp } from '../../play/useLocalPvp.ts';
import type { OnlineRoomApi } from '../../play/pvpOnline.ts';
import { PvpGameView } from './PvpGameView';
import type { PlayColor } from '../../play/types.ts';
import { playerDisplayName } from '../../profile/playerProfile.ts';
import { usePlayerProfile } from '../../profile/usePlayerProfile.ts';

/**
 * Online PvP: one room code, two browsers.
 *
 * The lobby hands the live room object up to the section once both seats are
 * present; the room itself mirrors the board and forwards every own move — with
 * the position and both clock readings — to the other client.
 */
export function PvpOnlineLobby({
  room,
  control,
  onStart,
}: {
  /** The room outlives this lobby: it is owned by the section, so starting the
      game does not close the channel the game is about to use. */
  room: OnlineRoomApi;
  control: PvpTimeControl | null;
  onStart: (args: { room: OnlineRoomApi; control: PvpTimeControl }) => void;
}) {
  const [code, setCode] = useState('');
  const profile = usePlayerProfile();
  const identity = {
    name: playerDisplayName(profile) || 'Player',
    elo: profile.elo,
  };

  /* Whichever side presses start, the other one starts too, on the same
     control — otherwise one player sits in the lobby while the other's clock
     is already running. */
  const startRef = useRef(onStart);
  startRef.current = onStart;
  useEffect(
    () =>
      room.onStart((incoming) => {
        startRef.current({ room, control: incoming });
      }),
    [room],
  );

  if (!control) {
    return (
      <p className="pvp-online__hint">
        Pick a time control below first; the room adopts it.
      </p>
    );
  }

  return (
    <div className="pvp-online">
      <div className="pvp-online__row">
        <button
          type="button"
          className="secondary-btn"
          onClick={() => room.create(control, identity)}
          disabled={room.status === 'connecting' || room.status === 'waiting'}
        >
          Create a room
        </button>
        <span className="pvp-online__or">or</span>
        <label className="pvp-online__join">
          <span className="visually-hidden">Room code</span>
          <input
            type="text"
            placeholder="Room code"
            value={code}
            maxLength={8}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
          <button
            type="button"
            className="play-action"
            onClick={() => room.join(code, control, identity)}
            disabled={code.trim().length < 4}
          >
            Join
          </button>
        </label>
      </div>

      {room.code ? (
        <div className="pvp-online__room" role="status">
          <p className="pvp-online__code">
            Room <strong>{room.code}</strong> · {pvpTimeControlLabel(control)} ·{' '}
            {bonusTypeLabel(control.bonusType)}
          </p>
          <p className="pvp-online__hint">
            {room.status === 'error'
              ? room.error
              : room.status === 'connecting'
                ? 'Connecting…'
                : room.opponentHere
                  ? `${room.opponent?.name ?? 'Your opponent'} is here — you play ${
                      room.role === 'host' ? 'White' : 'Black'
                    }.`
                  : 'Share the code — waiting for your opponent…'}
          </p>
          <div className="pvp-online__actions">
            {room.opponentHere ? (
              <button
                type="button"
                className="primary-btn"
                onClick={() => {
                  room.sendStart(control);
                  onStart({ room, control });
                }}
              >
                Start the game
              </button>
            ) : null}
            <button type="button" className="play-action" onClick={room.leave}>
              Leave room
            </button>
          </div>
        </div>
      ) : room.error ? (
        <p className="pvp-error" role="alert">
          {room.error}
        </p>
      ) : null}
    </div>
  );
}

/** The online board: the playing room's layout, locked to this screen's side. */
export function PvpOnlineRoom({
  room,
  control,
  onExit,
}: {
  room: OnlineRoomApi;
  control: PvpTimeControl;
  onExit: () => void;
}) {
  const profile = usePlayerProfile();
  const ownerSide: PlayColor = room.role === 'host' ? 'w' : 'b';
  /* Fixed orientation: an online game must not flip the board under you. */
  const game = useLocalPvp({ ...control, autoFlip: false, ownerSide });
  const sentPlyRef = useRef(0);
  const gameRef = useRef(game);
  gameRef.current = game;

  /* Seed the counter so a reconnect does not replay the whole move list. */
  useEffect(() => {
    sentPlyRef.current = game.state.sans.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Own moves go out with the position and both clock readings. */
  useEffect(() => {
    const { sans, lastMove, fen } = game.state;
    if (sans.length === 0 || sans.length <= sentPlyRef.current || !lastMove) return;

    const mover: PlayColor = sans.length % 2 === 1 ? 'w' : 'b';
    if (mover !== ownerSide) return;

    sentPlyRef.current = sans.length;
    const clock = gameRef.current.clock;
    room.sendMove({
      move: { from: lastMove.from, to: lastMove.to },
      fen,
      whiteTimeMs: Math.round(clock.whiteMs),
      blackTimeMs: Math.round(clock.blackMs),
      serverTimestamp: Date.now(),
      ply: sans.length,
      color: mover,
    });
  }, [game.state, ownerSide, room]);

  /* The opponent's move, applied only when it is the move we are expecting. */
  useEffect(
    () =>
      room.onMove((payload) => {
        const current = gameRef.current;
        if (payload.color === ownerSide) return;
        if (payload.ply !== current.state.sans.length + 1) return;
        const applied = current.playMove(
          payload.move.from,
          payload.move.to,
          payload.move.promotion,
          { remote: true },
        );
        if (applied) {
          sentPlyRef.current = payload.ply;
          /* Adopt the mover's readings only when they differ meaningfully:
             a correction below the transport latency would just jitter. */
          const clock = current.clock;
          if (
            Math.abs(clock.whiteMs - payload.whiteTimeMs) > 500 ||
            Math.abs(clock.blackMs - payload.blackTimeMs) > 500
          ) {
            current.adopt(payload.whiteTimeMs, payload.blackTimeMs);
          }
        }
      }),
    [ownerSide, room],
  );

  /* Only the side that owns it may resign, and the other client is told. */
  useEffect(
    () =>
      room.onResign((color) => {
        const current = gameRef.current;
        if (color === ownerSide) return;
        current.resign(color);
      }),
    [ownerSide, room],
  );

  return (
    <PvpGameView
      game={game}
      control={control}
      code={room.code ?? ''}
      ownSide={ownerSide}
      self={{
        name: playerDisplayName(profile) || 'Player',
        elo: profile.elo,
        avatar: profile.avatar,
      }}
      opponent={room.opponent ? { name: room.opponent.name, elo: room.opponent.elo } : null}
      onResign={() => {
        gameRef.current.resign(ownerSide);
        room.sendResign(ownerSide);
      }}
      onExit={onExit}
    />
  );
}
