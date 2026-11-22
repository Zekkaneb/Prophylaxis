import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { TITLE_UNLOCK_EVENT, type TitleUnlockDetail } from '../../play/titleStore.ts';
import { titleSpec } from '../../play/titles.ts';
import { usePlayerProfile } from '../../profile/usePlayerProfile.ts';
import { playerDisplayName } from '../../profile/playerProfile.ts';
import { PlayerNameplate } from '../PlayerNameplate';

/**
 * The congratulations card.
 *
 * Sits above whichever game ended and shows the badge that was just earned,
 * what earned it, and how the nameplate will read from now on. More than one
 * title can be earned by a single game, so they are queued rather than stacked.
 */
export function TitleUnlockModal() {
  const [queue, setQueue] = useState<TitleUnlockDetail[]>([]);
  const profile = usePlayerProfile();
  const name = playerDisplayName(profile) || 'Player';

  useEffect(() => {
    const onUnlock = (event: Event) => {
      const detail = (event as CustomEvent<TitleUnlockDetail>).detail;
      if (!detail || !Array.isArray(detail.titles) || detail.titles.length === 0) return;
      setQueue((current) => [...current, detail]);
    };
    window.addEventListener(TITLE_UNLOCK_EVENT, onUnlock);
    return () => window.removeEventListener(TITLE_UNLOCK_EVENT, onUnlock);
  }, []);

  const current = queue[0];
  if (!current) return null;

  const strongest = current.titles[current.titles.length - 1];
  const spec = titleSpec(strongest);
  const close = () => setQueue((rest) => rest.slice(1));

  return createPortal(
    <div className="title-modal" role="dialog" aria-modal="true" aria-labelledby="title-modal-heading">
      <div className="title-modal__card">
        <p className="play-eyebrow">Milestone reached</p>
        <h2 id="title-modal-heading">Congratulations!</h2>

        <div className={`title-modal__badge nameplate__badge--${spec.tone}`}>{spec.id}</div>
        <p className="title-modal__name">{spec.name}</p>

        <dl className="title-modal__stats">
          <div>
            <dt>Peak rating</dt>
            <dd>{current.peak}</dd>
          </div>
          {spec.norm ? (
            <div>
              <dt>Norm average</dt>
              <dd>
                {current.average ?? spec.norm.average}
                <small> over {spec.norm.games} rated games</small>
              </dd>
            </div>
          ) : (
            <div>
              <dt>Required</dt>
              <dd>{spec.rating} peak Elo</dd>
            </div>
          )}
        </dl>

        {current.titles.length > 1 ? (
          <p className="title-modal__note">
            Also earned: {current.titles.slice(0, -1).join(', ')}
          </p>
        ) : null}

        <p className="title-modal__preview-label">Your name now reads</p>
        <p className="title-modal__preview">
          <PlayerNameplate
            name={name}
            rating={profile.elo || current.peak}
            title={strongest}
            size="lg"
          />
        </p>

        <p className="title-modal__note">
          A title is permanent: it stays yours even if your rating drops.
        </p>

        <div className="play-modal__actions">
          <button type="button" className="primary-btn" onClick={close}>
            {queue.length > 1 ? `Next (${queue.length - 1})` : 'Nice'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default TitleUnlockModal;
