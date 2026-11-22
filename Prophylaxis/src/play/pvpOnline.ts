import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, syncConfigured } from '../sync/client.ts';
import type { PlayColor } from './types.ts';
import type { PvpTimeControl } from './pvp.ts';

/**
 * Online PvP over a Supabase Realtime broadcast channel.
 *
 * No table and no migration: a room is a channel name (`pvp:<code>`) and the
 * two clients exchange moves, clocks and resignations on it. The move itself is
 * authoritative because it carries the whole payload — the position after the
 * move and both clocks as the mover saw them — so a client that reconnects
 * mid-game can be brought up to date from one message.
 *
 * Presence carries who is in the room, which side they took (host is White,
 * guest is Black) and the name and rating each seat is shown under.
 */

export interface PvpIdentity {
  name: string;
  elo: number;
}

export interface PvpMovePayload {
  /** `from`+`to`+promotion, the same UCI the local board produces. */
  move: { from: string; to: string; promotion?: string };
  fen: string;
  whiteTimeMs: number;
  blackTimeMs: number;
  /** The mover's clock reading at the moment of sending. */
  serverTimestamp: number;
  ply: number;
  /** Who moved, so a stale or echoed message can be ignored. */
  color: PlayColor;
}

export type RoomStatus = 'idle' | 'connecting' | 'waiting' | 'ready' | 'error' | 'closed';

export interface PvpRoomState {
  code: string | null;
  role: 'host' | 'guest' | null;
  status: RoomStatus;
  error: string | null;
  /** The other seat is present. */
  opponentHere: boolean;
  /** The other seat's name and rating, once it has announced them. */
  opponent: PvpIdentity | null;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newRoomCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
}

export interface OnlineRoomApi extends PvpRoomState {
  create: (control: PvpTimeControl, identity: PvpIdentity) => void;
  join: (code: string, control: PvpTimeControl, identity: PvpIdentity) => void;
  leave: () => void;
  sendMove: (payload: PvpMovePayload) => void;
  onMove: (handler: (payload: PvpMovePayload) => void) => () => void;
  /** Only ever called for this screen's own side. */
  sendResign: (color: PlayColor) => void;
  onResign: (handler: (color: PlayColor) => void) => () => void;
  /** "Start" carries the time control, so both clients begin on the same one. */
  sendStart: (control: PvpTimeControl) => void;
  onStart: (handler: (control: PvpTimeControl) => void) => () => void;
}

export function useOnlineRoom(): OnlineRoomApi {
  const [state, setState] = useState<PvpRoomState>({
    code: null,
    role: null,
    status: 'idle',
    error: null,
    opponentHere: false,
    opponent: null,
  });

  const channelRef = useRef<ReturnType<NonNullable<typeof supabase>['channel']> | null>(null);
  const moveHandlers = useRef(new Set<(payload: PvpMovePayload) => void>());
  const resignHandlers = useRef(new Set<(color: PlayColor) => void>());
  const startHandlers = useRef(new Set<(control: PvpTimeControl) => void>());

  const leave = useCallback(() => {
    const channel = channelRef.current;
    channelRef.current = null;
    if (channel) void supabase?.removeChannel(channel);
    setState({
      code: null,
      role: null,
      status: 'idle',
      error: null,
      opponentHere: false,
      opponent: null,
    });
  }, []);

  useEffect(() => () => leave(), [leave]);

  const open = useCallback(
    (code: string, role: 'host' | 'guest', control: PvpTimeControl, identity: PvpIdentity) => {
      if (!syncConfigured || !supabase) {
        setState({
          code,
          role,
          status: 'error',
          error: 'Online play needs the app’s hosted backend, which this build does not have.',
          opponentHere: false,
          opponent: null,
        });
        return;
      }

      setState({
        code,
        role,
        status: 'connecting',
        error: null,
        opponentHere: false,
        opponent: null,
      });

      const channel = supabase.channel(`pvp:${code}`, {
        config: { broadcast: { self: false }, presence: { key: role } },
      });
      channelRef.current = channel;

      channel.on('broadcast', { event: 'move' }, (message) => {
        const payload = (message as { payload?: PvpMovePayload }).payload;
        if (!payload) return;
        for (const handler of moveHandlers.current) handler(payload);
      });

      channel.on('broadcast', { event: 'resign' }, (message) => {
        const color = (message as { payload?: { color?: PlayColor } }).payload?.color;
        if (color !== 'w' && color !== 'b') return;
        for (const handler of resignHandlers.current) handler(color);
      });

      channel.on('broadcast', { event: 'start' }, (message) => {
        const control = (message as { payload?: { control?: PvpTimeControl } }).payload?.control;
        if (!control) return;
        for (const handler of startHandlers.current) handler(control);
      });

      channel.on('presence', { event: 'sync' }, () => {
        const states = channel.presenceState() as Record<
          string,
          Array<{ identity?: PvpIdentity }>
        >;
        const others = Object.entries(states)
          .filter(([key]) => key !== role)
          .flatMap(([, entries]) => entries);
        const opponent = others.find((entry) => entry.identity)?.identity ?? null;
        setState((current) => ({
          ...current,
          opponentHere: others.length > 0,
          opponent,
          status: others.length > 0 ? 'ready' : 'waiting',
        }));
      });

      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void channel.track({ role, control, identity });
          setState((current) => ({
            ...current,
            status: current.opponentHere ? 'ready' : 'waiting',
          }));
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setState((current) => ({
            ...current,
            status: 'error',
            error: 'The room could not be reached. Check the connection and try again.',
          }));
        }
      });
    },
    [],
  );

  const create = useCallback(
    (control: PvpTimeControl, identity: PvpIdentity) =>
      open(newRoomCode(), 'host', control, identity),
    [open],
  );

  const join = useCallback(
    (code: string, control: PvpTimeControl, identity: PvpIdentity) => {
      const clean = code.trim().toUpperCase();
      if (clean.length < 4) {
        setState((current) => ({
          ...current,
          status: 'error',
          error: 'Enter the room code your opponent shared.',
        }));
        return;
      }
      open(clean, 'guest', control, identity);
    },
    [open],
  );

  const sendMove = useCallback((payload: PvpMovePayload) => {
    const channel = channelRef.current;
    if (!channel) return;
    void channel.send({ type: 'broadcast', event: 'move', payload });
  }, []);

  const onMove = useCallback((handler: (payload: PvpMovePayload) => void) => {
    moveHandlers.current.add(handler);
    return () => {
      moveHandlers.current.delete(handler);
    };
  }, []);

  const sendResign = useCallback((color: PlayColor) => {
    const channel = channelRef.current;
    if (!channel) return;
    void channel.send({ type: 'broadcast', event: 'resign', payload: { color } });
  }, []);

  const onResign = useCallback((handler: (color: PlayColor) => void) => {
    resignHandlers.current.add(handler);
    return () => {
      resignHandlers.current.delete(handler);
    };
  }, []);

  const sendStart = useCallback((control: PvpTimeControl) => {
    const channel = channelRef.current;
    if (!channel) return;
    void channel.send({ type: 'broadcast', event: 'start', payload: { control } });
  }, []);

  const onStart = useCallback((handler: (control: PvpTimeControl) => void) => {
    startHandlers.current.add(handler);
    return () => {
      startHandlers.current.delete(handler);
    };
  }, []);

  return {
    ...state,
    create,
    join,
    leave,
    sendMove,
    onMove,
    sendResign,
    onResign,
    sendStart,
    onStart,
  };
}
