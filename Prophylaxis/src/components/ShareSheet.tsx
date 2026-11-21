import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { useModalOverlay } from './useModalOverlay';
import './ShareSheet.css';

/**
 * One activity in the sheet. Titles are verb-first and short, and the symbol is
 * decorative: the label carries the meaning, exactly as an activity view does.
 */
export interface ShareActivity {
  id: string;
  label: string;
  description?: string;
  symbol: string;
  onSelect: () => void;
}

export interface ShareSheetProps {
  open: boolean;
  /** Names the context, not the app: "Share position", "Share game". */
  title: string;
  subtitle?: string;
  activities: ShareActivity[];
  onClose: () => void;
}

/**
 * An activity view: a sheet on phones, a centred card on wide windows. The
 * first activity takes focus, Escape closes, Tab stays inside, and focus
 * returns to whatever opened it.
 */
export default function ShareSheet({
  open,
  title,
  subtitle,
  activities,
  onClose,
}: ShareSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useModalOverlay(open, onClose, panelRef, '.share-row');

  if (!open) return null;

  /* Portalled to the body: a view's entry transform would otherwise become the
     containing block for this fixed sheet and the nav would paint over it. */
  return createPortal(
    <div className="share">
      <button
        type="button"
        className="share__scrim"
        aria-label="Close share sheet"
        tabIndex={-1}
        onClick={onClose}
      />

      <div
        className="share__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-sheet-title"
        ref={panelRef}
      >
        <header className="share__head">
          <div className="share__heading">
            <p className="share__eyebrow">Share</p>
            <h2 className="share__title" id="share-sheet-title">
              {title}
            </h2>
            {subtitle ? <p className="share__subtitle">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            className="share__close"
            aria-label="Close"
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div className="share__list">
          {activities.map((activity) => (
            <button
              key={activity.id}
              type="button"
              className="share-row"
              onClick={() => {
                onClose();
                activity.onSelect();
              }}
            >
              <span className="share-row__symbol" aria-hidden="true">
                {activity.symbol}
              </span>
              <span className="share-row__text">
                <span className="share-row__label">{activity.label}</span>
                {activity.description ? (
                  <span className="share-row__desc">{activity.description}</span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
