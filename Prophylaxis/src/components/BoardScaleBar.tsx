import { BOARD_SCALE_MAX, BOARD_SCALE_MIN, useAppearance } from '../theme/ThemeProvider';
import './BoardScaleBar.css';

/**
 * The one board controller, shown in the top bar on every tab that has a board.
 *
 * It drives the single global `boardScale`, so − / + / Fit and the slider move
 * the same board everywhere: 50% compact board up to 200%, without ever
 * changing the board's internal proportions or letting the panels resize it.
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

      <input
        className="board-zoom__slider"
        type="range"
        min={BOARD_SCALE_MIN}
        max={BOARD_SCALE_MAX}
        step={0.01}
        value={boardScale}
        aria-label="Board scale"
        title={`Board ${percent}% of the fitted size`}
        onChange={(event) => setBoardScale(Number(event.target.value))}
      />

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
