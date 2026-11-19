/**
 * Tree helpers.
 *
 * A parsed game is a tree because chess itself is a tree: every position has
 * one chosen continuation and any number of alternatives. These helpers answer
 * the questions the rest of the app actually asks — "give me the main line",
 * "how big is this game", "clone it so I can edit safely" — without exposing
 * traversal code to callers.
 */

import type { PgnGame, PgnNode } from './types.ts';

/** The main line: follow `children[0]` from the root to the end. */
export function mainline(game: PgnGame): PgnNode[] {
  return mainlineFrom(game.root);
}

export function mainlineFrom(root: PgnNode): PgnNode[] {
  const moves: PgnNode[] = [];
  let node: PgnNode | undefined = root;
  while (node && node.children.length > 0) {
    node = node.children[0];
    moves.push(node);
  }
  return moves;
}

/** End nodes of every branch (each is the final move of one complete line). */
export function leaves(root: PgnNode): PgnNode[] {
  const result: PgnNode[] = [];
  const stack: PgnNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.children.length === 0) {
      if (node !== root) result.push(node);
      continue;
    }
    for (const child of node.children) stack.push(child);
  }
  return result;
}

/** Total number of moves in the tree, variations included. */
export function countNodes(root: PgnNode): number {
  let total = 0;
  const stack: PgnNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    for (const child of node.children) {
      total += 1;
      stack.push(child);
    }
  }
  return total;
}

/**
 * Depth-first walk with the ply number (0-based half-move count) alongside each
 * node. Used by UI code that needs "show note for ply 7".
 */
export function* walk(
  root: PgnNode,
  ply = 0,
  line: number[] = [],
): Generator<{ node: PgnNode; ply: number; line: number[] }> {
  for (let index = 0; index < root.children.length; index += 1) {
    const node = root.children[index];
    const path = [...line, index];
    yield { node, ply, line: path };
    yield* walk(node, ply + 1, path);
  }
}

/**
 * Structural clone.
 *
 * `structuredClone` is used rather than JSON round-tripping so NaN/undefined
 * semantics are preserved and Dates survive, even though today's nodes contain
 * neither — the tree is a public shape and this helper should not silently
 * change behaviour if it grows a field.
 */
export function cloneTree(root: PgnNode): PgnNode {
  return structuredClone(root);
}

/** All comments in the tree, in reading order — handy for search. */
export function collectComments(root: PgnNode): Array<{ san: string; comment: string }> {
  const found: Array<{ san: string; comment: string }> = [];
  if (root.comment) found.push({ san: '', comment: root.comment });
  for (const node of walk(root)) {
    if (node.node.comment) found.push({ san: node.node.san, comment: node.node.comment });
  }
  return found;
}
