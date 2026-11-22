import { useState } from 'react';
import type { PvpTimeControl } from '../../play/pvp.ts';
import { useOnlineRoom } from '../../play/pvpOnline.ts';
import { PvpOnlineLobby, PvpOnlineRoom } from './PvpOnline';
import { PvpSetupView } from './PvpSetupView';

/**
 * The PvP tab: a lobby, then a board.
 *
 * Only online play lives here. The room sits above the lobby/game switch so the
 * channel that carried the lobby is the one the game uses.
 */
export function PvpSection() {
  const [onlineMatch, setOnlineMatch] = useState<{
    room: ReturnType<typeof useOnlineRoom>;
    control: PvpTimeControl;
  } | null>(null);
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

  return (
    <PvpSetupView
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

export default PvpSection;
