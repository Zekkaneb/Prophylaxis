/**
 * PGN toolkit — public entry point.
 *
 * The modules are split by pipeline stage so the course can teach them one at a
 * time; consumers only ever need this barrel:
 *
 *   import { parsePgn, gameToPgn, mainline } from '../pgn';
 *
 * Everything here is pure: no DOM, no chess rules, no storage. That keeps the
 * parser testable in Node and reusable if the app ever gains a server.
 */

export type { PgnGame, PgnNode, ParseResult, Token } from './types.ts';
export { describeToken } from './types.ts';

export { normalizePgnText, tokenize, tokenizeAll } from './tokenizer.ts';

export { cleanComment, createNode, parsePgn, parseSingleGame } from './parser.ts';

export { escapeTagValue, fenClock, gamesToPgn, gameToPgn, writeMovetext, writeSanLine } from './writer.ts';
export type { WriteOptions } from './writer.ts';

export { cloneTree, collectComments, countNodes, leaves, mainline, mainlineFrom, walk } from './tree.ts';

export { NAG_SYMBOL, SUFFIX_TO_NAG, nagToSymbol, splitSuffix, symbolToNag } from './annotations.ts';
