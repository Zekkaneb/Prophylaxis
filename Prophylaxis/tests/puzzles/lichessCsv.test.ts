/**
 * Lichess CSV parsing: field splitting, quoted values, chunked streams,
 * structural rejections, duplicate ids and the committed fixture.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  CsvRecordSplitter,
  LICHESS_HEADER_LINE,
  isLichessHeader,
  parseCsv,
  parseLichessCsv,
  parseLichessPuzzleRow,
} from '../../src/puzzles/lichessCsv.ts';

const FIXTURE = new URL('../../scripts/fixtures/lichess-puzzles.sample.csv', import.meta.url);

const ROW =
  '00sHx,q3k1nr/1pp1nQpp/3p4/2P5/4q3/8/PPPP2PP/1K2R2R w kq - 0 16,e2e4 e7e5 d1d2,1760,75,96,7138,mate mateIn2 middlegame short,https://lichess.org/yyznGmXs/black,';

test('splits plain and quoted fields', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,2,3\n'), [
    ['a', 'b', 'c'],
    ['1', '2', '3'],
  ]);
  assert.deepEqual(parseCsv('a,"b,c",d\n'), [['a', 'b,c', 'd']]);
  assert.deepEqual(parseCsv('a,"say ""hi""",d'), [['a', 'say "hi"', 'd']]);
});

test('handles CRLF and a byte-order mark', () => {
  const rows = parseCsv('\uFEFFa,b\r\n1,2\r\n');
  assert.deepEqual(rows, [
    ['a', 'b'],
    ['1', '2'],
  ]);
});

test('produces the same records when the text arrives in arbitrary chunks', () => {
  const text = `${LICHESS_HEADER_LINE}\n${ROW}\n"x,y",b,c\n`;
  const expected = parseCsv(text);

  const splitter = new CsvRecordSplitter();
  const collected: string[][] = [];
  for (const chunk of text.match(/[\s\S]{1,7}/g) ?? []) {
    collected.push(...splitter.push(chunk));
  }
  collected.push(...splitter.flush());

  assert.deepEqual(collected, expected);
});

test('recognises the official header', () => {
  assert.equal(isLichessHeader(LICHESS_HEADER_LINE.split(',')), true);
  assert.equal(isLichessHeader(['puzzleid', 'FEN']), true);
  assert.equal(isLichessHeader(['00sHx', 'fen']), false);
});

test('parses one row into the normalized Lichess record', () => {
  const record = parseLichessPuzzleRow(ROW.split(','));

  assert.equal(record.puzzle_id, '00sHx');
  assert.equal(record.fen, 'q3k1nr/1pp1nQpp/3p4/2P5/4q3/8/PPPP2PP/1K2R2R w kq - 0 16');
  assert.deepEqual(record.moves, ['e2e4', 'e7e5', 'd1d2']);
  assert.equal(record.rating, 1760);
  assert.equal(record.rating_deviation, 75);
  assert.equal(record.popularity, 96);
  assert.equal(record.plays, 7138);
  assert.deepEqual(record.themes, ['mate', 'mateIn2', 'middlegame', 'short']);
  assert.equal(record.game_url, 'https://lichess.org/yyznGmXs/black');
  assert.deepEqual(record.opening_tags, []);
});

test('accepts a quoted Themes column', () => {
  const quoted = '00sHx,"8/8/8/8/8/8/8/K6k w - - 0 1","a1a2 a2a3",1500,80,90,400,"fork pin",,';
  const record = parseLichessPuzzleRow(parseCsv(`x,y\n${quoted}`)[1]);
  assert.deepEqual(record.themes, ['fork', 'pin']);
});

test('rejects structurally broken rows without throwing', () => {
  const result = parseLichessCsv(
    [
      LICHESS_HEADER_LINE,
      '00sHx,8/8/8/8/8/8/8/K6k w - - 0 1,a1a2,1500,80,90', // too few columns
      '00sHy,8/8/8/8/8/8/8/K6k w - - 0 1,a1a2,not-a-number,80,90,400,fork,,',
      ',8/8/8/8/8/8/8/K6k w - - 0 1,a1a2,1500,80,90,400,fork,,', // empty id
    ].join('\n'),
  );

  assert.equal(result.puzzles.length, 0);
  assert.equal(result.rejected.length, 3);
  assert.match(result.rejected[0].reason, /columns/);
  assert.match(result.rejected[1].reason, /Rating/);
  assert.match(result.rejected[2].reason, /PuzzleId/);
  assert.equal(result.headerColumns, 11);
});

test('drops duplicate ids and counts them', () => {
  const result = parseLichessCsv([LICHESS_HEADER_LINE, ROW, ROW].join('\n'));

  assert.equal(result.puzzles.length, 1);
  assert.equal(result.duplicates, 1);
});

test('parses the committed fixture completely', async () => {
  const text = await readFile(FIXTURE, 'utf8');
  const result = parseLichessCsv(text);

  assert.equal(result.headerColumns, 11);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.duplicates, 0);
  assert.equal(result.puzzles.length, 260);
  assert.equal(new Set(result.puzzles.map((puzzle) => puzzle.puzzle_id)).size, 260);

  const intermediate = result.puzzles.filter((puzzle) => puzzle.rating >= 1301 && puzzle.rating <= 1600);
  assert.equal(intermediate.length, 210);

  /* One daily puzzle every 25 rows carries the 11th column. */
  const dailies = result.puzzles.filter((puzzle) => puzzle.daily_date);
  assert.ok(dailies.length > 0, 'fixture should include DailyDate rows');
  assert.match(dailies[0].daily_date ?? '', /^20\d\d-\d\d-\d\d$/);
});

test('maps the 11th DailyDate column and tolerates 10-column rows', () => {
  const withDate = parseLichessPuzzleRow(
    '00sHx,8/8/8/8/8/8/8/K6k w - - 0 1,a1a2 a2a3,1500,80,90,400,fork,https://lichess.org/game/abc,Italian_Game,2024-05-01'.split(
      ',',
    ),
  );
  assert.equal(withDate.daily_date, '2024-05-01');
  assert.deepEqual(withDate.opening_tags, ['Italian_Game']);

  const withoutDate = parseLichessPuzzleRow(
    '00sHx,8/8/8/8/8/8/8/K6k w - - 0 1,a1a2 a2a3,1500,80,90,400,fork,,'.split(','),
  );
  assert.equal(withoutDate.daily_date, undefined);
});
