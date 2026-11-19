/**
 * Stage 3 — the writer (serialiser).
 *
 * Writing PGN is where most libraries quietly lose data: they serialise the
 * main line, drop variations, and hope nobody notices. This writer round-trips
 * the whole tree — variations, comments, NAGs — so an import → edit → export
 * cycle is lossless.
 *
 * Two PGN rules drive all the formatting decisions here:
 *
 * 1. MOVETEXT IS NUMBERED, TAGS ARE NOT. `1. e4 e5 2. Nf3` — only White's moves
 *    carry a number in the main line. Black's number is only printed when the
 *    sequence restarts (after a variation, or when a line begins on Black's
 *    turn), where `2...` is required to avoid ambiguity.
 *
 * 2. TAGS ARE QUOTED, COMMENTS ARE NOT. Tag values escape `"` and `\`;
 *    comments are plain text and must not contain an unescaped `}`.
 */

import { nagToSymbol } from './annotations.ts';
import type { PgnGame, PgnNode } from './types.ts';

/** The Seven Tag Roster, in the order the PGN specification recommends. */
const SEVEN_TAG_ROSTER = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'] as const;

export interface WriteOptions {
  /**
   * Starting position, when the game does not begin from the standard array.
   * Emits `[SetUp "1"]` + `[FEN "…"]`, which is what makes the PGN reloadable.
   */
  startFen?: string | null;
  /**
   * `'number'` (default) writes `$5`; `'symbol'` writes `!?` when a glyph
   * exists and falls back to `$n`. Numbers are canonical; symbols are for
   * human-facing exports.
   */
  annotations?: 'number' | 'symbol';
  /** Extra tags to print after the roster (e.g. `ChapterName`). */
  extraTags?: Record<string, string>;
}

/** Escapes a tag value per the PGN spec: only `\` and `"` are special. */
export function escapeTagValue(value: string): string {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

/** Comments are free text; a `}` would terminate them early, so it is dropped. */
function escapeComment(value: string): string {
  return value.replace(/\}/g, '');
}

/**
 * Reads the clock out of a FEN.
 *
 * A FEN's last two fields are exactly what movetext numbering needs: whose turn
 * it is and which full move that is. Parsing them by hand keeps this module
 * free of a chess-rules dependency — the writer only counts, it never judges.
 */
export function fenClock(fen?: string | null): { turn: 'w' | 'b'; fullmove: number } {
  if (!fen) return { turn: 'w', fullmove: 1 };
  const fields = fen.trim().split(/\s+/);
  const turn = fields[1] === 'b' ? 'b' : 'w';
  const fullmove = Number.parseInt(fields[5] ?? '1', 10);
  return { turn, fullmove: Number.isFinite(fullmove) && fullmove > 0 ? fullmove : 1 };
}

/**
 * Serialises the move tree into movetext (no tags).
 *
 * `ply` counts half-moves from the start position, so `ply % 2 === 0` is White.
 * `forceNumber` is threaded through because the token that follows a variation
 * or a comment must repeat the move number to stay unambiguous.
 */
export function writeMovetext(root: PgnNode, startFen?: string | null, options: WriteOptions = {}): string {
  const { turn, fullmove } = fenClock(startFen);
  const startPly = (fullmove - 1) * 2 + (turn === 'b' ? 1 : 0);
  const out: string[] = [];

  const annotations = options.annotations ?? 'number';

  const emitMove = (node: PgnNode, ply: number, forceNumber: boolean): void => {
    const moveNumber = Math.floor(ply / 2) + 1;
    if (ply % 2 === 0) {
      out.push(`${moveNumber}.`);
    } else if (forceNumber) {
      out.push(`${moveNumber}...`);
    }

    /*
     * `!?` is a suffix, not a token: it must be glued to the move ("e4!?"),
     * while `$5` is a separate token ("e4 $5"). Getting this wrong produces
     * PGN that most parsers still accept but no human wants to read.
     */
    let moveText = node.san;
    const nagTokens: string[] = [];
    for (const nag of node.nags) {
      const symbol = annotations === 'symbol' ? nagToSymbol(nag) : '';
      if (symbol) {
        moveText += symbol;
      } else {
        nagTokens.push(`$${nag}`);
      }
    }

    out.push(moveText, ...nagTokens);
    if (node.comment) out.push(`{ ${escapeComment(node.comment)} }`);
  };

  /**
   * Walks one continuation. `index` is the child slot being followed: 0 is the
   * main line, 1+ are variations — the same convention the parser produced.
   */
  const walk = (parent: PgnNode, index: number, ply: number): void => {
    let cursor = parent;
    let slot = index;
    let forceNumber = true;

    while (cursor.children[slot]) {
      const node = cursor.children[slot];
      emitMove(node, ply, forceNumber);

      // Siblings of the main line are printed as bracketed side lines straight
      // after the main move they replace.
      let hadVariation = false;
      if (slot === 0) {
        for (let alternative = 1; alternative < cursor.children.length; alternative += 1) {
          out.push('(');
          walk(cursor, alternative, ply);
          out.push(')');
          hadVariation = true;
        }
      }

      // A number is needed again after a side line or a comment, because the
      // reader has lost the thread of whose move it is.
      forceNumber = hadVariation || Boolean(node.comment);
      cursor = node;
      slot = 0;
      ply += 1;
    }
  };

  if (root.comment) out.push(`{ ${escapeComment(root.comment)} }`);
  walk(root, 0, startPly);

  return out.join(' ');
}

/**
 * Serialises a whole game: tags first, then movetext, then the result token.
 *
 * Tag order is roster-first so exported files look like the ones a chess GUI
 * produces; any header the source carried (ECO, Opening, TimeControl …) is kept
 * after the roster instead of being thrown away.
 */
export function gameToPgn(game: PgnGame, options: WriteOptions = {}): string {
  const headers = game.headers ?? {};
  const result = game.result ?? headers.Result ?? '*';

  const roster: Record<string, string> = {
    Event: headers.Event || '?',
    Site: headers.Site || '?',
    Date: headers.Date || '????.??.??',
    Round: headers.Round || '?',
    White: headers.White || '?',
    Black: headers.Black || '?',
    Result: result,
  };

  const lines: string[] = SEVEN_TAG_ROSTER.map(
    (name) => `[${name} "${escapeTagValue(roster[name] ?? '?')}"]`,
  );

  const handled = new Set<string>([...SEVEN_TAG_ROSTER, 'FEN', 'SetUp']);
  for (const [name, value] of Object.entries(headers)) {
    if (handled.has(name)) continue;
    lines.push(`[${name} "${escapeTagValue(value)}"]`);
  }

  for (const [name, value] of Object.entries(options.extraTags ?? {})) {
    lines.push(`[${name} "${escapeTagValue(value)}"]`);
  }

  // `SetUp` + `FEN` must come from the same source of truth: the writer only
  // knows the position it was told to write from.
  const startFen = options.startFen ?? headers.FEN ?? null;
  if (startFen) {
    lines.push('[SetUp "1"]');
    lines.push(`[FEN "${escapeTagValue(startFen)}"]`);
  }

  const movetext = writeMovetext(game.root, startFen, options);
  return `${lines.join('\n')}\n\n${movetext ? `${movetext} ` : ''}${result}\n`;
}

/** Concatenates several games, separated by a blank line (a PGN "database"). */
export function gamesToPgn(games: PgnGame[], options: WriteOptions = {}): string {
  return games.map((game) => gameToPgn(game, options)).join('\n');
}

/**
 * Minimal single-line PGN ("e4 e5 Nf3 Nc6 Bc4") — for logs, tests and the
 * lesson importer, which wants moves without the ceremony.
 */
export function writeSanLine(root: PgnNode): string {
  const moves: string[] = [];
  let node: PgnNode | undefined = root;
  while (node && node.children.length > 0) {
    node = node.children[0];
    moves.push(node.san);
  }
  return moves.join(' ');
}
