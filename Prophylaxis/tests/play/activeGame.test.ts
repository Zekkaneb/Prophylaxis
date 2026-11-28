/**
 * Unfinished-game records and the archive they turn into: PGN headers, FEN
 * setup tags, move replay and the fields resuming depends on.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { Chess } from 'chess.js';
import {
  activePgn,
  activeToPlayedGame,
  createActiveRecord,
  finishActiveRecord,
  recordLooksConsistent,
} from '../../src/play/activeGame.ts';
import {
  STANDARD_START_FEN,
  buildMoveText,
  buildPgn,
  pgnDate,
} from '../../src/play/pgn.ts';
import { replaySans } from '../../src/play/replay.ts';
import { getOpponent } from '../../src/play/opponents.ts';
import type { GameConfig } from '../../src/play/types.ts';

/* By id, not by position: the roster order is a display choice. */
const junior = getOpponent('junior')!;

const config: GameConfig = {
  color: 'w',
  timeControlId: '5+3',
  initialSeconds: 300,
  incrementSeconds: 3,
  untimed: false,
};

const SANS = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'];

function activeRecord(overrides: Partial<Parameters<typeof createActiveRecord>[0]> = {}) {
  return createActiveRecord({
    id: 'game_test',
    opponent: junior,
    config,
    playerColor: 'w',
    orientation: 'white',
    initialFen: STANDARD_START_FEN,
    currentFen: STANDARD_START_FEN,
    sans: SANS,
    whiteMs: 288_500,
    blackMs: 291_000,
    active: 'w',
    clockStarted: true,
    paused: false,
    startedAt: 1_700_000_000_000,
    now: 1_700_000_060_000,
    ...overrides,
  });
}

test('round-trips everything a resume needs', () => {
  const record = activeRecord();

  assert.equal(record.game_id, 'game_test');
  assert.equal(record.opponent_id, 'junior');
  assert.equal(record.opponent_name, 'Johnfer Quispe (Junior)');
  assert.equal(record.opponent_elo, 2150);
  assert.equal(record.opponent_kind, 'personality');
  assert.equal(record.player_color, 'w');
  assert.equal(record.orientation, 'white');
  assert.equal(record.initial_fen, STANDARD_START_FEN);
  assert.deepEqual(record.sans, SANS);
  assert.equal(record.initial_seconds, 300);
  assert.equal(record.increment_seconds, 3);
  assert.equal(record.time_control_id, '5+3');
  assert.equal(record.untimed, false);
  assert.equal(record.white_ms, 288_500);
  assert.equal(record.black_ms, 291_000);
  assert.equal(record.active_clock, 'w');
  assert.equal(record.clock_started, true);
  assert.equal(record.paused, false);
  assert.equal(record.started_at, 1_700_000_000_000);
  assert.equal(record.last_sync_at, 1_700_000_060_000);
  assert.equal(record.status, 'playing');
  assert.equal(record.result, null);
  assert.equal(record.ended_at, null);
  assert.equal(recordLooksConsistent(record), true);
});

test('flags a corrupt record instead of offering it for resume', () => {
  const record = activeRecord();
  assert.equal(recordLooksConsistent({ ...record, sans: 'e4' as unknown as string[] }), false);
  assert.equal(recordLooksConsistent({ ...record, game_id: '' }), false);
  assert.equal(recordLooksConsistent({ ...record, white_ms: Number.NaN } as never), false);
});

test('builds numbered move text', () => {
  assert.equal(buildMoveText(['e4']), '1. e4');
  assert.equal(buildMoveText(['e4', 'e5', 'Nf3']), '1. e4 e5 2. Nf3');
});

test('unfinished PGN keeps the neutral result and replays legally', () => {
  const pgn = activePgn({
    opponent: junior,
    config,
    playerColor: 'w',
    initialFen: STANDARD_START_FEN,
    sans: SANS,
    startedAt: 1_700_000_000_000,
  });

  assert.match(pgn, /\[Result "\*"\]/);
  assert.match(pgn, /\[White "Player One"\]/);
  assert.match(pgn, /\[Black "Johnfer Quispe \(Junior\)"\]/);
  assert.match(pgn, /\[BlackElo "2150"\]/);
  assert.match(pgn, /\[WhiteElo "1200"\]/, 'the profile rating labels the human side');
  assert.doesNotMatch(pgn, /\[FEN /);

  const reimported = new Chess();
  reimported.loadPgn(pgn);
  assert.deepEqual(reimported.history(), SANS);
});

test('final PGN carries every header and re-imports with chess.js', () => {
  const finished = finishActiveRecord(
    activeRecord(),
    '0-1',
    'checkmate',
    1_700_000_360_000,
    'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
  );
  const played = activeToPlayedGame(finished);

  const reimported = new Chess();
  reimported.loadPgn(played.pgn);
  const headers = reimported.getHeaders();

  assert.equal(headers.Event, 'Playing Lab');
  assert.equal(headers.Site, 'Local');
  assert.equal(headers.Date, pgnDate(finished.ended_at ?? 0));
  assert.equal(headers.White, 'Player One');
  assert.equal(headers.Black, 'Johnfer Quispe (Junior)');
  assert.equal(headers.Result, '0-1');
  assert.equal(headers.TimeControl, '300+3');
  assert.equal(headers.BlackElo, '2150');
  /* The human side carries the Dashboard profile rating (1200 by default). */
  assert.equal(headers.WhiteElo, '1200');
  assert.deepEqual(reimported.history(), SANS);
  assert.equal(reimported.isCheckmate(), false);

  assert.equal(played.result, '0-1');
  assert.equal(played.reason, 'checkmate');
  assert.equal(played.duration_seconds, 360);
  assert.deepEqual(played.sans, SANS);
  assert.equal(played.starting_fen, STANDARD_START_FEN);
  assert.equal(played.board_orientation, 'white');
  assert.equal(played.time_control_id, '5+3');
});

test('a game from a custom position writes SetUp and FEN headers', () => {
  const startFen = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1';
  const finished = finishActiveRecord(
    activeRecord({ initialFen: startFen, sans: ['e4'], currentFen: startFen }),
    '1-0',
    'resignation',
    1_700_000_100_000,
    '4k3/8/8/8/4P3/8/8/4K3 b - - 0 1',
  );
  const played = activeToPlayedGame(finished);

  assert.match(played.pgn, /\[SetUp "1"\]/);
  assert.match(played.pgn, /\[FEN "4k3\/8\/8\/8\/8\/8\/4P3\/4K3 w - - 0 1"\]/);

  const reimported = new Chess();
  reimported.loadPgn(played.pgn);
  assert.deepEqual(reimported.history(), ['e4']);
});

test('buildPgn marks untimed games with a dash', () => {
  const pgn = buildPgn(
    {
      white: 'A',
      black: 'B',
      result: '1/2-1/2',
      date: 1_700_000_000_000,
      timeControl: '-',
    },
    ['e4', 'e5'],
  );
  assert.match(pgn, /\[TimeControl "-"\]/);
  assert.match(pgn, /1\. e4 e5 1\/2-1\/2$/);
});

test('replays stored moves into every intermediate position', () => {
  const replay = replaySans(STANDARD_START_FEN, SANS);

  assert.equal(replay.fens.length, SANS.length + 1);
  assert.equal(replay.plies.length, SANS.length);
  assert.equal(replay.startingFen, STANDARD_START_FEN);
  assert.deepEqual(
    replay.plies.map((ply) => [ply.san, ply.from, ply.to]),
    [
      ['e4', 'e2', 'e4'],
      ['e5', 'e7', 'e5'],
      ['Nf3', 'g1', 'f3'],
      ['Nc6', 'b8', 'c6'],
      ['Bb5', 'f1', 'b5'],
      ['a6', 'a7', 'a6'],
    ],
  );
  assert.equal(replay.fens[0], new Chess().fen());

  const board = new Chess();
  for (const san of SANS) board.move(san);
  assert.equal(replay.fens[SANS.length], board.fen());
});

test('replay rejects an illegal or unreadable game', () => {
  assert.throws(() => replaySans(STANDARD_START_FEN, ['e4', 'Qh5']), /does not fit/);
  assert.throws(() => replaySans('not-a-fen', ['e4']), /unreadable/);
});
