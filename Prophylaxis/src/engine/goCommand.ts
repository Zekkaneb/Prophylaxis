/**
 * The `go` line for one Stockfish search.
 *
 * Depth is the quality ceiling; movetime is the wall-clock ceiling used by the
 * play clock. Passing both makes the search iterative-deepening with a
 * deadline: it stops when the depth is reached, or at the deadline with the
 * best line found so far.
 *
 * `nodes` is the third ceiling and the one the beginner bands use: a bot given
 * a 45-node budget stops after a handful of positions however much time is on
 * its clock, so it cannot see the tactic a stronger opponent sees.
 */
export function buildGoCommand(depth: number, movetimeMs = 0, nodes = 0): string {
  const parts = [`go depth ${depth}`];
  if (nodes > 0) parts.push(`nodes ${nodes}`);
  if (movetimeMs > 0) parts.push(`movetime ${movetimeMs}`);
  return parts.join(' ');
}
