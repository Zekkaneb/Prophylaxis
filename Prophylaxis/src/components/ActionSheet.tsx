import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useModalOverlay } from './useModalOverlay';
import './ActionSheet.css';

export interface ActionSheetProps {
  open: boolean;
  /** One short line naming the action, kept to a single line: "Delete course?" */
  title: string;
  /** Only when the title cannot carry the consequence by itself. */
  message?: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * An action sheet for an intentional action that destroys data: the
 * destructive choice is first and styled as danger, Cancel is last, and focus
 * lands on Cancel so Enter cannot delete by reflex.
 */
export default function ActionSheet({
  open,
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: ActionSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const messageId = useId();

  useModalOverlay(open, onCancel, panelRef, '.action-sheet__cancel');

  if (!open) return null;

  return createPortal(
    <div className="action-sheet">
      <button
        type="button"
        className="action-sheet__scrim"
        aria-label="Cancel"
        tabIndex={-1}
        onClick={onCancel}
      />

      <div
        className="action-sheet__panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? messageId : undefined}
        ref={panelRef}
      >
        <h2 className="action-sheet__title" id={titleId}>
          {title}
        </h2>
        {message ? (
          <p className="action-sheet__message" id={messageId}>
            {message}
          </p>
        ) : null}

        <div className="action-sheet__actions">
          <button type="button" className="action-sheet__confirm" onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button type="button" className="action-sheet__cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
