/**
 * The `go` line for one Stockfish search.
 *
 * Depth is the quality ceiling; movetime is the wall-clock ceiling used by the
 * play clock. Passing both makes the search iterative-deepening with a
 * deadline: it stops when the depth is reached, or at the deadline with the
 * best line found so far.
 */
export function buildGoCommand(depth: number, movetimeMs = 0): string {
  return movetimeMs > 0 ? `go depth ${depth} movetime ${movetimeMs}` : `go depth ${depth}`;
}
