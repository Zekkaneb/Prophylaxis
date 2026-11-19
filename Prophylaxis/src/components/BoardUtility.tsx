import { useEffect, useRef, useState } from 'react';
import BoardScaleBar from './BoardScaleBar';
import { useAppearance } from '../theme/ThemeProvider';
import './BoardUtility.css';

/**
 * The board's size control, folded into one compact button so the top bar stays
 * a navigation bar. The slider, − / + and Fit live in a small popover that
 * opens under the button; the percentage is announced on the button itself.
 */
export default function BoardUtility() {
  const { effectiveBoardScale } = useAppearance();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const percent = Math.round(effectiveBoardScale * 100);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="board-utility" ref={wrapRef}>
      <button
        type="button"
        className={`board-utility__btn${open ? ' is-open' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Board size, ${percent}%`}
        title={`Board size ${percent}%`}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">▦</span>
      </button>

      {open ? (
        <div className="board-utility__panel" role="dialog" aria-label="Board size">
          <BoardScaleBar />
        </div>
      ) : null}
    </div>
  );
}
