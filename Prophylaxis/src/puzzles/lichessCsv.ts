/**
 * Lichess Open Puzzle Database: CSV parsing.
 *
 * Official columns (see https://database.lichess.org/#puzzles):
 *
 *   PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags,DailyDate
 *
 * The current export has an 11th column, `DailyDate`, which is empty for almost
 * every row (only puzzles that were Lichess's daily puzzle carry a date). Rows
 * with 10 columns — older exports and our fixtures before 2026 — are still
 * accepted, so the parser handles both.
 *
 * Parsing is split from validation on purpose: this module only turns bytes into
 * fields, so the ingest script can stream millions of rows while counting why
 * individual rows were rejected instead of aborting.
 *
 * Pure module: safe to import from Node scripts and tests.
 */

import type { LichessPuzzleRecord } from './types.ts';

export const LICHESS_PUZZLE_COLUMNS = [
  'PuzzleId',
  'FEN',
  'Moves',
  'Rating',
  'RatingDeviation',
  'Popularity',
  'NbPlays',
  'Themes',
  'GameUrl',
  'OpeningTags',
  'DailyDate',
] as const;

export const LICHESS_HEADER_LINE = LICHESS_PUZZLE_COLUMNS.join(',');

/** Lichess puzzle ids are five alphanumerics (`00sHx`, `d9r7E`, …). */
export const LICHESS_ID_PATTERN = /^[A-Za-z0-9]{5}$/;

export interface CsvRejection {
  /** 1-based data row (header excluded). */
  line: number;
  reason: string;
  /** First 180 characters of the offending row, for the report. */
  snippet: string;
}

export interface LichessCsvParseResult {
  puzzles: LichessPuzzleRecord[];
  rejected: CsvRejection[];
  /** Rows that repeated an id already seen; the first occurrence wins. */
  duplicates: number;
  /** Number of columns found in the header (10 for the official file). */
  headerColumns: number;
}

/**
 * Splits CSV text into records, across arbitrary chunk boundaries.
 *
 * Quoted fields are supported (some mirrors quote Themes), including `""`
 * escapes and line breaks inside quotes. State lives on the instance, so
 * `push` may be called with as many chunks as the stream produces.
 */
export class CsvRecordSplitter {
  /** Fields of the record currently being assembled. */
  private pending: string[] = [];
  private field = '';
  private inQuotes = false;

  push(chunk: string): string[][] {
    const records: string[][] = [];

    for (let index = 0; index < chunk.length; index += 1) {
      const char = chunk[index];

      if (this.inQuotes) {
        if (char === '"') {
          if (chunk[index + 1] === '"') {
            this.field += '"';
            index += 1;
            continue;
          }
          this.inQuotes = false;
          continue;
        }
        this.field += char;
        continue;
      }

      if (char === '"') {
        this.inQuotes = true;
        continue;
      }
      if (char === ',') {
        this.pending.push(this.field);
        this.field = '';
        continue;
      }
      if (char === '\n' || char === '\r') {
        if (char === '\r' && chunk[index + 1] === '\n') index += 1;
        this.pending.push(this.field);
        this.field = '';
        const record = this.pending;
        this.pending = [];
        if (record.some((value) => value.trim() !== '')) records.push(record);
        continue;
      }

      this.field += char;
    }

    return records;
  }

  /** Emits the last record when the text did not end with a newline. */
  flush(): string[][] {
    if (!this.inQuotes && this.field === '' && this.pending.length === 0) return [];
    this.pending.push(this.field);
    this.field = '';
    this.inQuotes = false;
    const record = this.pending;
    this.pending = [];
    return record.some((value) => value.trim() !== '') ? [record] : [];
  }
}

/** Parses a whole CSV document. */
export function parseCsv(text: string): string[][] {
  const splitter = new CsvRecordSplitter();
  const rows = splitter.push(text.replace(/^\uFEFF/, ''));
  rows.push(...splitter.flush());
  return rows;
}

function toNumber(value: string | undefined): number {
  if (value === undefined) return Number.NaN;
  const trimmed = value.trim();
  if (trimmed === '') return Number.NaN;
  return Number(trimmed);
}

function splitTags(value: string | undefined): string[] {
  return (value ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * One CSV row → a Lichess record.
 *
 * Throws with a human reason for structural problems (missing id/FEN/moves,
 * unparseable rating). Semantic checks (legal moves, rating range, quality) live
 * in `puzzleValidation.ts`.
 */
export function parseLichessPuzzleRow(row: string[]): LichessPuzzleRecord {
  if (row.length < 8) {
    throw new Error(`expected at least 8 columns, found ${row.length}`);
  }

  const [id, fen, moves, rating, ratingDeviation, popularity, plays, themes, gameUrl, openingTags, dailyDate] =
    row;

  const puzzleId = (id ?? '').trim();
  if (!puzzleId) throw new Error('empty PuzzleId');

  const position = (fen ?? '').trim();
  if (!position) throw new Error('empty FEN');

  const solution = (moves ?? '').trim().split(/\s+/).filter(Boolean);
  if (solution.length === 0) throw new Error('empty Moves');

  const value = toNumber(rating);
  if (!Number.isFinite(value)) throw new Error(`unparseable Rating "${rating ?? ''}"`);

  return {
    puzzle_id: puzzleId,
    fen: position,
    moves: solution,
    rating: value,
    rating_deviation: toNumber(ratingDeviation),
    popularity: toNumber(popularity),
    plays: toNumber(plays),
    themes: splitTags(themes),
    game_url: (gameUrl ?? '').trim(),
    opening_tags: splitTags(openingTags),
    daily_date: (dailyDate ?? '').trim() || undefined,
  };
}

/** True when the row looks like the official header. */
export function isLichessHeader(row: string[]): boolean {
  return (row[0] ?? '').trim().toLowerCase() === 'puzzleid';
}

/**
 * Parses a CSV document into records, keeping every structural failure as a
 * rejection instead of throwing. Duplicate ids are dropped (first one wins) and
 * counted, so ingestion is idempotent over concatenated exports.
 */
export function parseLichessCsv(
  text: string,
  options: { limit?: number; skipDuplicates?: boolean } = {},
): LichessCsvParseResult {
  const rows = parseCsv(text);
  const result: LichessCsvParseResult = {
    puzzles: [],
    rejected: [],
    duplicates: 0,
    headerColumns: 0,
  };

  const seen = new Set<string>();
  let dataLine = 0;

  for (const row of rows) {
    if (isLichessHeader(row)) {
      result.headerColumns = row.length;
      continue;
    }
    dataLine += 1;

    let record: LichessPuzzleRecord;
    try {
      record = parseLichessPuzzleRow(row);
    } catch (cause) {
      result.rejected.push({
        line: dataLine,
        reason: (cause as Error).message,
        snippet: row.join(',').slice(0, 180),
      });
      continue;
    }

    if (seen.has(record.puzzle_id)) {
      result.duplicates += 1;
      if (options.skipDuplicates !== false) continue;
    }
    seen.add(record.puzzle_id);

    result.puzzles.push(record);
    if (options.limit !== undefined && result.puzzles.length >= options.limit) break;
  }

  return result;
}
