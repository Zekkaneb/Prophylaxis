import { useState } from 'react';
import type { PvpTimeControl } from '../../play/pvp.ts';
import { useOnlineRoom } from '../../play/pvpOnline.ts';
import {
  clearPvpSession,
  loadPvpSession,
  savePvpSession,
  sessionLabel,
  type PvpSession,
} from '../../play/pvpSession.ts';
import { playerDisplayName } from '../../profile/playerProfile.ts';
import { usePlayerProfile } from '../../profile/usePlayerProfile.ts';
import { PvpOnlineLobby, PvpOnlineRoom } from './PvpOnline';
import { PvpSetupView } from './PvpSetupView';

/**
 * The PvP tab: a lobby, then a board.
 *
 * Only online play lives here. The room sits above the lobby/game switch so the
 * channel that carried the lobby is the one the game uses, and the last room is
 * remembered so a game left halfway can be picked up again by code.
 */
export function PvpSection() {
  /* Only the control is kept: holding the room *object* would freeze its
     presence state at the moment the game started, and a rejoin would then
     never see the other seat. */
  const [onlineMatch, setOnlineMatch] = useState<{ control: PvpTimeControl } | null>(null);
  const [resume, setResume] = useState<PvpSession | null>(() => loadPvpSession());
  const room = useOnlineRoom();
  const profile = usePlayerProfile();

  const rejoin = (session: PvpSession) => {
    savePvpSession(session);
    room.rejoin(session.code, session.role, session.control, {
      name: playerDisplayName(profile) || 'Player',
      elo: profile.elo,
      avatar: profile.avatar,
    });
    setOnlineMatch({ control: session.control });
    window.scrollTo({ top: 0 });
  };

  if (onlineMatch) {
    return (
      <PvpOnlineRoom
        room={room}
        control={onlineMatch.control}
        onExit={() => {
          room.leave();
          setOnlineMatch(null);
          setResume(loadPvpSession());
        }}
      />
    );
  }

  return (
    <PvpSetupView
      resume={
        resume
          ? {
              code: resume.code,
              label: sessionLabel(resume.control),
              side: resume.role === 'host' ? 'White' : 'Black',
              onRejoin: () => rejoin(resume),
              onDismiss: () => {
                clearPvpSession();
                setResume(null);
              },
            }
          : null
      }
      online={(control) =>
        control ? (
          <PvpOnlineLobby
            room={room}
            control={control}
            onStart={(args) => {
              setOnlineMatch(args);
              setResume(null);
              window.scrollTo({ top: 0 });
            }}
          />
        ) : null
      }
    />
  );
}

export default PvpSection;
