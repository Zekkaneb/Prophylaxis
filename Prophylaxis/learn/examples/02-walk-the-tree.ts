/**
 * Example 2 — walking every node with ply numbers.
 *
 *   node learn/examples/02-walk-the-tree.ts
 *
 * `walk()` is a generator, so a UI can stop early (find the node at ply 12,
 * the first comment mentioning "Sicilian", …) without materialising the tree.
 */

import { parsePgn, symbolToNag, walk, nagToSymbol } from '../../src/pgn/index.ts';

const { games } = parsePgn(
  '1. e4 e5 (1... c5 2. Nf3 { Sicilian } 2... d6) 2. Nf3 Nc6 3. Bb5 a6 *',
);

for (const { node, ply, line } of walk(games[0].root)) {
  const moveNumber = Math.floor(ply / 2) + 1;
  const side = ply % 2 === 0 ? '.' : '...';
  const branch = line.length > 1 ? ` (line ${line.join('.')})` : '';
  const symbol = node.nags.map((nag) => nagToSymbol(nag) || `$${nag}`).join('');
  const note = node.comment ? `  — ${node.comment}` : '';

  console.log(`${moveNumber}${side} ${node.san}${symbol}${branch}${note}`);
}

// The suffix map is public too, which is how a UI renders `!?` from `$5`.
console.log('\nsymbolToNag("!?") =', symbolToNag('!?'));
