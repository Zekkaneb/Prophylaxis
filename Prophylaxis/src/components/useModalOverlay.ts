import { useEffect, useRef, type RefObject } from 'react';

/**
 * The behaviour every sheet in the app shares: move focus into the panel when
 * it opens, keep Tab inside, close on Escape, and hand focus back to whatever
 * opened it. `focusSelector` decides which control is the safe landing spot —
 * the first activity, or Cancel for a destructive choice.
 */
export function useModalOverlay(
  open: boolean,
  onClose: () => void,
  panelRef: RefObject<HTMLDivElement | null>,
  focusSelector: string,
) {
  const restoreRef = useRef<HTMLElement | null>(null);
  /* Kept in a ref so an inline `onClose` cannot re-run the effect and re-focus. */
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    restoreRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const panel = panelRef.current;
    panel?.querySelector<HTMLButtonElement>(focusSelector)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>('button:not(:disabled)'),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      restoreRef.current?.focus?.();
    };
  }, [focusSelector, open, panelRef]);
}
