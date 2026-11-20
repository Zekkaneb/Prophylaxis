import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { BOARD_SCALE_MAX, BOARD_SCALE_MIN, useAppearance } from '../theme/ThemeProvider';
import './BoardScaleGrip.css';

type Axis = 'corner' | 'x' | 'y';

const clampScale = (value: number) =>
  Math.min(BOARD_SCALE_MAX, Math.max(BOARD_SCALE_MIN, value));

const roundScale = (value: number) => Math.round(value * 100) / 100;

/**
 * Edge resize handles for the board, the way a resizable panel behaves: drag
 * the right edge, the bottom edge or the corner and the board follows the
 * pointer. All three write the one global `boardScale` the − / + / Fit controls
 * drive, converted through the board's real pixel size so the edge stays under
 * the cursor. Arrow keys step the focused handle by 5%.
 *
 * Rendered inside the persistent board layer, beside the board itself, so every
 * view that shows a board gets the same corner arrow — one instance, above the
 * board it resizes, impossible to clip or bury under a view's own panels.
 */
export default function BoardScaleGrip() {
  const { boardScale, setBoardScale } = useAppearance();
  const drag = useRef<{ x: number; y: number; scale: number; size: number } | null>(null);
  const [active, setActive] = useState<Axis | null>(null);

  const begin = (axis: Axis) => (event: PointerEvent<HTMLButtonElement>) => {
    /* The handles live in the persistent board layer, so they measure the board
       that layer is painting — the same box every view reserved for it. */
    const board = event.currentTarget.closest<HTMLElement>('.board-layer__board');
    const size = board?.getBoundingClientRect().width ?? 0;
    if (!size) return;

    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that is already gone cannot be captured; the drag still
      // works from the events that follow.
    }
    drag.current = { x: event.clientX, y: event.clientY, scale: boardScale, size };
    setActive(axis);
  };

  const resize = (axis: Axis) => (event: PointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (!state) return;

    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    const delta = axis === 'x' ? dx : axis === 'y' ? dy : (dx + dy) / 2;
    setBoardScale(roundScale(clampScale((state.scale * (state.size + delta)) / state.size)));
  };

  const end = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return;

    drag.current = null;
    setActive(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const step = (event: KeyboardEvent<HTMLButtonElement>) => {
    const grow =
      event.key === 'ArrowRight' || event.key === 'ArrowUp'
        ? 0.05
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? -0.05
          : 0;
    if (!grow) return;

    event.preventDefault();
    setBoardScale(roundScale(clampScale(boardScale + grow)));
  };

  const handle = (axis: Axis, className: string, label: string) => (
    <button
      type="button"
      className={`board-grip ${className}${active === axis ? ' is-dragging' : ''}`}
      onPointerDown={begin(axis)}
      onPointerMove={resize(axis)}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onKeyDown={step}
      aria-label={label}
      title={label}
    />
  );

  return (
    <div className="board-grips" aria-label="Board size" role="group">
      {handle('x', 'board-grip--right', 'Drag to resize the board width')}
      {handle('y', 'board-grip--bottom', 'Drag to resize the board height')}
      <button
        type="button"
        className={`board-grip board-grip--corner${active === 'corner' ? ' is-dragging' : ''}`}
        onPointerDown={begin('corner')}
        onPointerMove={resize('corner')}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
        onKeyDown={step}
        aria-label="Drag to resize the board"
        title="Drag to resize the board (arrow keys step it)"
      >
        <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false">
          <path d="M9 1 1 9M9 5 5 9" />
        </svg>
      </button>
    </div>
  );
}
