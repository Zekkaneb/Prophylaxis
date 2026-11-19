/**
 * Example 1 — parse a PGN and print the move tree.
 *
 *   node learn/examples/01-parse-and-inspect.ts
 *
 * Notice what the tree shows that a flat move list cannot: `e4` has two
 * children, so the Sicilian is stored next to `e5`, not appended to the end.
 */

import { countNodes, mainline, parsePgn } from '../../src/pgn/index.ts';
import type { PgnNode } from '../../src/pgn/index.ts';

const pgn = `[Event "Course example"]
[Site "Local"]
[White "Ada"]
[Black "Grace"]
[Result "*"]

1. e4 { king pawn } e5 (1... c5 2. Nf3 { Sicilian Defence } (2. Nc3 Nc6)) 2. Nf3 Nc6 $14 *`;

const { games, warnings } = parsePgn(pgn);

console.log(`games: ${games.length}, moves in tree: ${countNodes(games[0].root)}\n`);

for (const game of games) {
  console.log('tags:');
  for (const [name, value] of Object.entries(game.headers)) {
    console.log(`  ${name.padEnd(8)} ${value}`);
  }

  console.log(`\nmain line: ${mainline(game).map((node) => node.san).join(' ')}`);

  console.log('\ntree:');
  printTree(game.root, 0);

  if (game.warnings.length > 0) {
    console.log('\nwarnings:');
    for (const warning of game.warnings) console.log(`  - ${warning}`);
  }
}

if (warnings.length > 0) console.log(`\nlexer warnings: ${warnings.join('; ')}`);

/** Indented tree: variations are printed with a leading index. */
function printTree(node: PgnNode, depth: number): void {
  node.children.forEach((child, index) => {
    const branch = index > 0 ? `[var ${index}] ` : '';
    const nag = child.nags.length ? ` $${child.nags.join(' $')}` : '';
    const note = child.comment ? `  { ${child.comment} }` : '';
    console.log(`${'  '.repeat(depth)}${branch}${child.san}${nag}${note}`);
    printTree(child, depth + 1);
  });
}
