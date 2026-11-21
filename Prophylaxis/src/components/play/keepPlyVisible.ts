/**
 * Keeps the selected ply inside the move list without moving the page.
 *
 * `Element.scrollIntoView` scrolls every scrollable ancestor, the window
 * included. On a phone the notation sits below the board, so a new move would
 * drag the whole view down to the move list and the player would have to scroll
 * back up before they could move. This adjusts only the list's own
 * `scrollTop`, so the board stays where it is.
 */
export function keepPlyVisible(container: HTMLElement | null): void {
  if (!container) return;

  const selected = container.querySelector<HTMLElement>('.play-moves__ply.is-selected');
  if (!selected) return;

  const box = container.getBoundingClientRect();
  const target = selected.getBoundingClientRect();
  /* Already fully in view: leave the list — and the page — alone. */
  if (target.top >= box.top && target.bottom <= box.bottom) return;

  const delta = target.top < box.top ? target.top - box.top : target.bottom - box.bottom;
  container.scrollTop += delta;
}
