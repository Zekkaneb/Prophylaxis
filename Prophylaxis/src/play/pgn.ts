import type { PlayResult } from './types.ts';

/**
 * PGN writing for played games.
 *
 * The move text is derived from SAN, so the generated file is valid even
 * without chess.js headers, and the finished record stores the same PGN the
 * history export hands out. `[SetUp]`/`[FEN]` are added only when the game
 * started somewhere other than the initial position.
 */

export const STANDARD_START_FEN =
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** `YYYY.MM.DD`, the date format PGN requires. */
export function pgnDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

/** Numbered SAN text ("1. e4 e5 2. Nf3 …"), independent of chess.js headers. */
export function buildMoveText(sans: readonly string[]): string {
  const parts: string[] = [];
  for (let index = 0; index < sans.length; index += 2) {
    const number = index / 2 + 1;
    const white = sans[index] ?? '';
    const black = sans[index + 1];
    parts.push(black ? `${number}. ${white} ${black}` : `${number}. ${white}`);
  }
  return parts.join(' ');
}

export interface PgnOptions {
  white: string;
  black: string;
  /** Result from White's point of view. */
  result: PlayResult | '*';
  /** Epoch ms used for the `[Date]` tag. */
  date: number;
  /** `"5+3"` or `"-"` for untimed. */
  timeControl: string;
  whiteElo?: number | null;
  blackElo?: number | null;
  startingFen?: string | null;
  event?: string;
  site?: string;
}

function sameFen(a: string, b: string): boolean {
  return a.trim().split(/\s+/).join(' ') === b.trim().split(/\s+/).join(' ');
}

/** A complete PGN: tag pairs, a blank line, then the numbered moves + result. */
export function buildPgn(options: PgnOptions, sans: readonly string[]): string {
  const tags = [
    `[Event "${options.event ?? 'Johnfer Quispe — Playing Lab'}"]`,
    `[Site "${options.site ?? 'Local'}"]`,
    `[Date "${pgnDate(options.date)}"]`,
    `[White "${options.white}"]`,
    `[Black "${options.black}"]`,
    `[Result "${options.result}"]`,
    `[TimeControl "${options.timeControl}"]`,
  ];

  if (typeof options.whiteElo === 'number') tags.push(`[WhiteElo "${options.whiteElo}"]`);
  if (typeof options.blackElo === 'number') tags.push(`[BlackElo "${options.blackElo}"]`);

  const startingFen = options.startingFen?.trim();
  if (startingFen && !sameFen(startingFen, STANDARD_START_FEN)) {
    tags.push('[SetUp "1"]', `[FEN "${startingFen}"]`);
  }

  const moveText = buildMoveText(sans);
  return `${tags.join('\n')}\n\n${moveText ? `${moveText} ` : ''}${options.result}`;
}
