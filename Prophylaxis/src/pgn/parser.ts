/**
 * Stage 2 — the parser.
 *
 * A hand-written recursive-descent-ish state machine that turns tokens into a
 * move TREE. The important design decisions, each explained where it is made:
 *
 *   • children[0] is the main line, children[1..] are variations
 *   • a comment belongs to the move BEFORE it (PGN's rule, not ours)
 *   • variations are stored as siblings, not as a separate "variation" type
 *   • nothing throws: malformed input yields warnings and keeps going
 *
 * The last point matters for a chess trainer: an imported study with one bad
 * move should still open, with the bad branch flagged, rather than refuse to
 * load at all.
 */

import { splitSuffix } from './annotations.ts';
import { normalizePgnText, tokenize } from './tokenizer.ts';
import type { PgnGame, PgnNode, ParseResult, Token } from './types.ts';

/** Result strings normalised to the three PGN spellings plus `*`. */
function normalizeResult(raw: string): string {
  return raw === '½-½' ? '1/2-1/2' : raw;
}

/**
 * Housekeeping for comments.
 *
 * `[%clk 0:03:00]` and friends are Lichess-specific embedded commands, not
 * prose. They are stripped so a lesson's coaching note is not polluted with
 * clock data. Runs of blank lines are collapsed for the same reason.
 */
export function cleanComment(text: string): string {
  return text
    .replace(/\[%[^\]]*\]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function createNode(san = '', comment = ''): PgnNode {
  return { san, comment, nags: [], children: [] };
}

function appendComment(node: PgnNode, text: string): void {
  const clean = cleanComment(text);
  if (!clean) return;
  node.comment = node.comment ? `${node.comment}\n${clean}` : clean;
}

/**
 * Mutable state for one game while it is being read.
 *
 * Keeping it in a single object (rather than six locals) is what makes the
 * variation stack easy to reason about: `push`/`pop` of the three fields below
 * is the entire "where am I" question.
 */
interface GameState {
  index: number;
  headers: Record<string, string>;
  root: PgnNode;
  result: string | null;
  warnings: string[];
  /** Pointer to the node whose `children` the next move is appended to. */
  cursor: PgnNode;
  /** Most recently created move — the target for comments and NAGs. */
  lastNode: PgnNode | null;
  /** Parent of `lastNode`; where a `(` returns to. */
  lastParent: PgnNode | null;
  /** Saved cursors, one entry per open `(`. */
  stack: Array<{ cursor: PgnNode; lastNode: PgnNode | null; lastParent: PgnNode | null }>;
  /** Depth of parentheses to ignore (used for variations with no move to branch from). */
  skipDepth: number;
  /** Comment waiting for the next move (comments before the first move, or after `(`). */
  pending: string;
  started: boolean;
  finished: boolean;
}

function createGameState(index: number): GameState {
  const root = createNode();
  return {
    index,
    headers: {},
    root,
    result: null,
    warnings: [],
    cursor: root,
    lastNode: null,
    lastParent: null,
    stack: [],
    skipDepth: 0,
    pending: '',
    started: false,
    finished: false,
  };
}

function addComment(game: GameState, text: string): void {
  const clean = cleanComment(text);
  if (!clean) return;

  // A comment after a move belongs to that move — PGN's rule. `pending` only
  // catches comments with no move yet (file preamble, or right after `(`).
  if (game.lastNode) {
    appendComment(game.lastNode, clean);
    return;
  }
  if (game.stack.length === 0 && game.root.children.length === 0) {
    appendComment(game.root, clean);
    return;
  }
  game.pending = game.pending ? `${game.pending}\n${clean}` : clean;
}

function addMove(game: GameState, san: string): void {
  const node = createNode(san, game.pending);
  game.pending = '';
  game.cursor.children.push(node);
  game.lastParent = game.cursor;
  game.lastNode = node;
  game.cursor = node;
}

/**
 * Validates a word as a SAN token before committing it to the tree.
 *
 * This is a *shape* check, not a legality check: no board is involved here.
 * The character class allows the full SAN alphabet (piece letters, files,
 * ranks, captures, promotion, check/mate, castling, drops and the `@` used by
 * variants) while rejecting prose that leaked out of a broken comment.
 */
const SAN_SHAPE = /^[A-Za-z-][A-Za-z0-9=+#x\-@]*$/;

function readWord(game: GameState, token: Extract<Token, { kind: 'word' }>): void {
  // Castling is written with zeros by some engines and by hand-typed PGN.
  let word = token.value.replace(/^0-0-0/, 'O-O-O').replace(/^0-0/, 'O-O');

  // A stray move number glued to the move (`1.e4`, `1...e5`, `1…e4`).
  word = word.replace(/^\d+(?:\.{1,3}|…)/, '');
  if (!word || /^\d+$/.test(word) || /^\.+$/.test(word) || word === '…') {
    return; // Pure numbering, not a move.
  }

  const { san, nag } = splitSuffix(word);

  if (!SAN_SHAPE.test(san)) {
    game.warnings.push(`Unrecognised token "${san}" at offset ${token.at} ignored.`);
    return;
  }

  addMove(game, san);
  if (nag && game.lastNode && !game.lastNode.nags.includes(nag)) {
    game.lastNode.nags.push(nag);
  }
}

/**
 * Parses PGN text into games with a full move tree.
 *
 * Multi-game files are supported: a new `[Event …]` tag (or any move text after
 * a result) starts a new game. Warnings are attached to the game they occurred
 * in, so a UI can say "game 3: 2 unclosed variations".
 */
export function parsePgn(input: string): ParseResult {
  const text = normalizePgnText(input);
  const games: PgnGame[] = [];
  /** Lexer + global warnings, ordered as encountered. */
  const warnings: string[] = [];

  let game: GameState | null = null;
  let lexerWarningsUntil = 0;

  const flush = (): void => {
    if (!game) return;
    if (game.stack.length > 0) {
      game.warnings.push(`${game.stack.length} unclosed variation(s) at end of game.`);
    }
    const hasContent = game.root.children.length > 0 || Object.keys(game.headers).length > 0;
    if (hasContent) {
      games.push({
        index: game.index,
        headers: game.headers,
        root: game.root,
        result: game.result,
        warnings: game.warnings,
      });
    }
    game = null;
  };

  const ensureGame = (): GameState => {
    if (game && !game.finished) return game;
    flush();
    game = createGameState(games.length);
    return game;
  };

  // The lexer appends to `warnings` as it walks. Draining what has accumulated
  // at each token boundary keeps lexer warnings attributed to the right game.
  const drainLexerWarnings = (into: GameState): void => {
    for (; lexerWarningsUntil < warnings.length; lexerWarningsUntil += 1) {
      into.warnings.push(warnings[lexerWarningsUntil]);
    }
  };

  for (const token of tokenize(text, warnings)) {
    /* ----------------------------- tag pairs ----------------------------- */
    if (token.kind === 'tag') {
      // A tag pair after move text means "next game".
      if (!game || game.started || game.finished) {
        flush();
        game = createGameState(games.length);
      }
      game.headers[token.name] = token.value;
      drainLexerWarnings(game);
      continue;
    }

    const current = ensureGame();
    drainLexerWarnings(current);
    current.started = true;

    switch (token.kind) {
      /* ----------------------------- comments ---------------------------- */
      case 'comment':
        // Comments inside a skipped variation are dropped with it.
        if (current.skipDepth === 0) addComment(current, token.text);
        break;

      /* ------------------------------- NAGs ------------------------------ */
      case 'nag':
        if (current.skipDepth > 0) break;
        if (current.lastNode) {
          if (!current.lastNode.nags.includes(token.value)) {
            current.lastNode.nags.push(token.value);
          }
        } else {
          current.warnings.push(`Annotation $${token.value} has no move to attach to.`);
        }
        break;

      /* --------------------------- move numbers -------------------------- */
      case 'number':
        // Purely decorative: the tree's shape already encodes the numbering.
        // `12...` is honoured by the writer when a variation starts on Black.
        break;

      /* ------------------------------ results ---------------------------- */
      case 'result':
        // A result inside a variation is not the game's result.
        if (current.stack.length === 0) {
          current.result = normalizeResult(token.value);
          current.finished = true;
        }
        break;

      /* ---------------------------- variations --------------------------- */
      case 'variation-start':
        if (current.skipDepth > 0) {
          current.skipDepth += 1;
          break;
        }
        if (!current.lastNode || !current.lastParent) {
          // `(1. e4)` before any move: there is nothing to branch from.
          current.warnings.push('A variation appeared before any move and was skipped.');
          current.skipDepth = 1;
          break;
        }
        /*
         * Starting a variation means: rewind to the parent of the last move and
         * append the alternative there. `lastNode = null` is what makes the next
         * comment pending instead of attaching to the move we came from.
         */
        current.stack.push({
          cursor: current.cursor,
          lastNode: current.lastNode,
          lastParent: current.lastParent,
        });
        current.cursor = current.lastParent;
        current.lastNode = null;
        current.lastParent = null;
        break;

      case 'variation-end':
        if (current.skipDepth > 0) {
          current.skipDepth -= 1;
          break;
        }
        if (current.stack.length === 0) {
          current.warnings.push('Unmatched ")" ignored.');
          break;
        }
        {
          const saved = current.stack.pop()!;
          current.cursor = saved.cursor;
          current.lastNode = saved.lastNode;
          current.lastParent = saved.lastParent;
        }
        break;

      /* ------------------------------- moves ----------------------------- */
      case 'word':
        if (current.skipDepth > 0) break;
        readWord(current, token);
        break;
    }
  }

  flush();
  return { games, warnings };
}

/**
 * Parses exactly one game — the common case for "paste a PGN".
 *
 * Throws (with the first warning as the message) when the input has no moves,
 * because an empty analysis screen is worse than an explanation.
 */
export function parseSingleGame(input: string): PgnGame {
  const { games } = parsePgn(input);
  if (games.length === 0) throw new Error('That PGN contains no readable moves.');
  if (games.length > 1) {
    // Still return the first game: importers generally want "the game you
    // selected", and the caller can inspect `parsePgn` for the full set.
    return games[0];
  }
  return games[0];
}
