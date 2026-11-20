import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { BOARD_SCALE_MAX, BOARD_SCALE_MIN, useAppearance } from '../theme/ThemeProvider';
import './BoardScaleGrip.css';

const clampScale = (value: number) =>
  Math.min(BOARD_SCALE_MAX, Math.max(BOARD_SCALE_MIN, value));

const roundScale = (value: number) => Math.round(value * 100) / 100;

/**
 * Corner grip for the board: drag it and the board grows or shrinks with the
 * pointer, the same global `boardScale` the − / + / Fit controls drive.
 *
 * The size is converted through the board's real pixel size, not the drag
 * distance alone, so a drag moves the corner under the cursor at every scale.
 * Arrow keys do the same job in 5% steps for keyboard users.
 */
export default function BoardScaleGrip() {
  const { boardScale, setBoardScale } = useAppearance();
  const drag = useRef<{ x: number; y: number; scale: number; size: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const begin = (event: PointerEvent<HTMLButtonElement>) => {
    const slot = event.currentTarget.parentElement?.querySelector<HTMLElement>('.board-slot');
    const size = slot?.getBoundingClientRect().width ?? 0;
    if (!size) return;

    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that is already gone cannot be captured; the drag still
      // works from the events that follow.
    }
    drag.current = { x: event.clientX, y: event.clientY, scale: boardScale, size };
    setDragging(true);
  };

  const resize = (event: PointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (!state) return;

    // The corner moves on both axes: their mean is the size change in pixels.
    const delta = (event.clientX - state.x + (event.clientY - state.y)) / 2;
    setBoardScale(roundScale(clampScale((state.scale * (state.size + delta)) / state.size)));
  };

  const end = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return;

    drag.current = null;
    setDragging(false);
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

  return (
    <button
      type="button"
      className={`board-grip${dragging ? ' is-dragging' : ''}`}
      onPointerDown={begin}
      onPointerMove={resize}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onKeyDown={step}
      aria-label="Resize the board"
      title="Drag to resize the board (arrow keys step it)"
    >
      <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false">
        <path d="M9 1 1 9M9 5 5 9" />
      </svg>
    </button>
  );
}
