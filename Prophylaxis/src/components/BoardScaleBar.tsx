import { BOARD_SCALE_MAX, BOARD_SCALE_MIN, useAppearance } from '../theme/ThemeProvider';
import './BoardScaleBar.css';

/**
 * The board size control, shown in the top bar and in the review transport.
 *
 * It drives the single global `boardScale`, so − / + / Fit move the same board
 * everywhere: 50% compact board up to 200%, without ever changing the board's
 * internal proportions or letting the panels resize it. Sizing is a drag on the
 * board's own corner grip (BoardScaleGrip) — this control is the keyboard- and
 * tap-friendly way to the same number.
 *
 * The percentage is a multiplier on the fitted board: 100% is the largest
 * square the window can hold with its header and footer bars.
 */
export default function BoardScaleBar() {
  const { boardScale, setBoardScale, fitBoard } = useAppearance();
  const percent = Math.round(boardScale * 100);

  return (
    <div className="board-zoom" role="group" aria-label="Board size">
      <button
        type="button"
        className="board-zoom__step"
        onClick={() => setBoardScale(boardScale - 0.1)}
        disabled={boardScale <= BOARD_SCALE_MIN}
        aria-label="Make the board smaller"
        title="Smaller"
      >
        −
      </button>

      <button
        type="button"
        className="board-zoom__step"
        onClick={() => setBoardScale(boardScale + 0.1)}
        disabled={boardScale >= BOARD_SCALE_MAX}
        aria-label="Make the board bigger"
        title="Bigger"
      >
        +
      </button>

      <button
        type="button"
        className="board-zoom__fit"
        onClick={fitBoard}
        title="Fit the board to the window (100%)"
      >
        Fit
      </button>

      <span className="board-zoom__value" aria-hidden="true">
        {percent}%
      </span>
    </div>
  );
}
