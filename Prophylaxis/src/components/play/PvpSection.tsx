import { useState } from 'react';
import type { PvpTimeControl } from '../../play/pvp.ts';
import { useLocalPvp } from '../../play/useLocalPvp.ts';
import { useOnlineRoom, type OnlineRoomApi } from '../../play/pvpOnline.ts';
import { PvpGameView } from './PvpGameView';
import { PvpOnlineLobby, PvpOnlineRoom } from './PvpOnline';
import { PvpSetupView, type PvpStartOptions } from './PvpSetupView';

/**
 * The PvP tab: a lobby, then a board.
 *
 * The board is keyed by the round, so "Play again" mounts a fresh game (and a
 * fresh clock) instead of unpicking the finished one.
 */
export function PvpSection() {
  const [match, setMatch] = useState<{ control: PvpTimeControl; autoFlip: boolean } | null>(null);
  const [onlineMatch, setOnlineMatch] = useState<{
    room: OnlineRoomApi;
    control: PvpTimeControl;
  } | null>(null);
  const [round, setRound] = useState(0);
  /* The room lives here, above the lobby/game switch: the lobby's own lifetime
     ends the moment the game starts, and the channel must not. */
  const room = useOnlineRoom();

  if (onlineMatch) {
    return (
      <PvpOnlineRoom
        room={onlineMatch.room}
        control={onlineMatch.control}
        onExit={() => {
          room.leave();
          setOnlineMatch(null);
        }}
      />
    );
  }

  if (!match) {
    return (
      <PvpSetupView
        onStart={(options: PvpStartOptions) => {
          setMatch(options);
          setRound((value) => value + 1);
          window.scrollTo({ top: 0 });
        }}
        online={(control) =>
          control ? (
            <PvpOnlineLobby
              room={room}
              control={control}
              onStart={(args) => {
                setOnlineMatch(args);
                window.scrollTo({ top: 0 });
              }}
            />
          ) : null
        }
      />
    );
  }

  return (
    <PvpRoom
      key={round}
      control={match.control}
      autoFlip={match.autoFlip}
      onRematch={() => setRound((value) => value + 1)}
      onExit={() => setMatch(null)}
    />
  );
}

function PvpRoom({
  control,
  autoFlip,
  onRematch,
  onExit,
}: {
  control: PvpTimeControl;
  autoFlip: boolean;
  onRematch: () => void;
  onExit: () => void;
}) {
  const game = useLocalPvp({ ...control, autoFlip });
  return (
    <PvpGameView game={game} control={control} onRematch={onRematch} onExit={onExit} />
  );
}

export default PvpSection;
