import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, syncConfigured } from '../sync/client.ts';
import type { PlayColor } from './types.ts';
import type { PvpTimeControl } from './pvp.ts';

/**
 * Online PvP over a Supabase Realtime broadcast channel.
 *
 * No table and no migration: a room is a channel name (`pvp:<code>`) and the
 * two clients exchange moves and clock readings on it. The move itself is
 * authoritative because it carries the whole payload — the position after the
 * move and both clocks as the mover saw them — so a client that joins late or
 * reconnects mid-game can be brought up to date from one message.
 *
 * Presence carries who is in the room and which side they took: the host is
 * White, the guest is Black.
 */

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
  /** The other seat is present and has announced its time control. */
  opponentHere: boolean;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newRoomCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
}

export interface OnlineRoomApi extends PvpRoomState {
  create: (control: PvpTimeControl) => void;
  join: (code: string, control: PvpTimeControl) => void;
  leave: () => void;
  sendMove: (payload: PvpMovePayload) => void;
  onMove: (handler: (payload: PvpMovePayload) => void) => () => void;
}

export function useOnlineRoom(): OnlineRoomApi {
  const [state, setState] = useState<PvpRoomState>({
    code: null,
    role: null,
    status: 'idle',
    error: null,
    opponentHere: false,
  });

  const channelRef = useRef<ReturnType<NonNullable<typeof supabase>['channel']> | null>(null);
  const handlersRef = useRef(new Set<(payload: PvpMovePayload) => void>());
  const controlRef = useRef<PvpTimeControl | null>(null);

  const leave = useCallback(() => {
    const channel = channelRef.current;
    channelRef.current = null;
    if (channel) void supabase?.removeChannel(channel);
    setState({ code: null, role: null, status: 'idle', error: null, opponentHere: false });
  }, []);

  useEffect(() => () => leave(), [leave]);

  const open = useCallback(
    (code: string, role: 'host' | 'guest', control: PvpTimeControl) => {
      if (!syncConfigured || !supabase) {
        setState({
          code,
          role,
          status: 'error',
          error: 'Online play needs the app’s hosted backend, which this build does not have.',
          opponentHere: false,
        });
        return;
      }

      controlRef.current = control;
      setState({ code, role, status: 'connecting', error: null, opponentHere: false });

      const channel = supabase.channel(`pvp:${code}`, {
        config: { broadcast: { self: false }, presence: { key: role } },
      });
      channelRef.current = channel;

      channel.on('broadcast', { event: 'move' }, (message) => {
        const payload = (message as { payload?: PvpMovePayload }).payload;
        if (!payload) return;
        for (const handler of handlersRef.current) handler(payload);
      });

      channel.on('presence', { event: 'sync' }, () => {
        const present = Object.keys(channel.presenceState());
        const opponent = present.some((key) => key !== role);
        setState((current) => ({
          ...current,
          opponentHere: opponent,
          status: opponent ? 'ready' : 'waiting',
        }));
      });

      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void channel.track({ role, control });
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
    (control: PvpTimeControl) => open(newRoomCode(), 'host', control),
    [open],
  );

  const join = useCallback(
    (code: string, control: PvpTimeControl) => {
      const clean = code.trim().toUpperCase();
      if (clean.length < 4) {
        setState((current) => ({
          ...current,
          status: 'error',
          error: 'Enter the room code your opponent shared.',
        }));
        return;
      }
      open(clean, 'guest', control);
    },
    [open],
  );

  const sendMove = useCallback((payload: PvpMovePayload) => {
    const channel = channelRef.current;
    if (!channel) return;
    void channel.send({ type: 'broadcast', event: 'move', payload });
  }, []);

  const onMove = useCallback((handler: (payload: PvpMovePayload) => void) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  return { ...state, create, join, leave, sendMove, onMove };
}
