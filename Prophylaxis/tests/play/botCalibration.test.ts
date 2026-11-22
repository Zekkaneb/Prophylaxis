import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { chooseBotMove } from '../../src/play/personality/chooseMove.ts';
import { PERSONALITY_STYLES } from '../../src/play/personality/styles.ts';
import { HUMAN_MULTI_PV, humanSearchDepth } from '../../src/play/humanStrength.ts';
import { botTraces, setBotTraceEnabled } from '../../src/play/botDebug.ts';
import type { StockfishController } from '../../src/engine/useStockfish.ts';

/**
 * Calibration test for the bot strength pipeline.
 *
 * The failure this guards against: a 1400-rated character played a whole game at
 * 95.8% accuracy against Stockfish. Stockfish's own strength options were not
 * involved — the pipeline never sends `UCI_LimitStrength`, strength lives in
 * move selection. Every character searched at the shared depth-16 ceiling over a
 * five-line list and took the engine's favourite almost every turn; a narrow,
 * deep list holds no move bad enough for the rating's error bands, so the rated
 * mistakes were silently replaced by best moves.
 *
 * What is measured here: a character bot searches at its rating's depth over a
 * ten-line list and fills the rated error bands. The stub scores every legal
 * move with a static evaluation in White's POV (the engine's contract), so a
 * line's position in the list means something and centipawn loss is real.
 */

const START = 'r1bqkb1r/pp2pppp/2np1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq - 4 7';
const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 } as const;

/** Static evaluation in White's POV, the way the engine reports a score. */
function whiteEval(fen: string): number {
  const game = new Chess(fen);
  if (game.isCheckmate()) return game.turn() === 'w' ? -100_000 : 100_000;
  if (game.isDraw()) return 0;
  let material = 0;
  for (const row of game.board()) {
    for (const piece of row) {
      if (!piece) continue;
      material += piece.color === 'w' ? VALUE[piece.type] : -VALUE[piece.type];
    }
  }
  const mobility = (game.turn() === 'w' ? 1 : -1) * game.moves().length * 3;
  return Math.round(material + mobility);
}

interface Line {
  uci: string;
  /** White's POV, as the engine sends it. */
  cp: number;
  /** The mover's POV, so the list can be ordered best-first for the bot. */
  mover: number;
}

/** Legal moves, best for the side to move first. */
function rankMoves(fen: string): Line[] {
  const game = new Chess(fen);
  const sign = game.turn() === 'w' ? 1 : -1;
  return game
    .moves({ verbose: true })
    .map((move) => {
      const child = new Chess(fen);
      child.move({ from: move.from, to: move.to, promotion: move.promotion });
      const cp = whiteEval(child.fen());
      return { uci: `${move.from}${move.to}${move.promotion ?? ''}`, cp, mover: sign * cp };
    })
    .sort((a, b) => b.mover - a.mover);
}

/** Deterministic PRNG so a failure is reproducible. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface RunOptions {
  elo: number;
  seed: number;
  turns?: number;
}

interface Stats {
  topShare: number;
  meanLoss: number;
  meanRank: number;
  /** Share of moves that gave up 100 cp or more — the mistakes a game reads. */
  bigLossShare: number;
  samples: number;
}

/**
 * Plays a self-game through the real chooser: the board keeps changing, so the
 * profile has to find moves in positions whose features move with it. Quiet
 * positions only — a forced mate would make centipawn loss meaningless.
 */
async function run({ elo, seed, turns = 240 }: RunOptions): Promise<{
  stats: Stats;
  seenEngine: { depth: number; multipv: number; nodes: number };
}> {
  const seenEngine = { depth: 0, multipv: 0, nodes: 0 };
  const engine = {
    evaluateWithin: async (
      fen: string,
      depth: number,
      multiPv: number,
      _movetime?: number,
      nodes?: number,
    ) => {
      seenEngine.depth = depth;
      seenEngine.multipv = multiPv;
      seenEngine.nodes = nodes ?? 0;
      const lines = rankMoves(fen).slice(0, multiPv);
      return {
        fen,
        depth,
        bestMove: lines[0]?.uci ?? null,
        secondBestMove: lines[1]?.uci ?? null,
        ponder: null,
        pv: lines[0] ? [lines[0].uci] : [],
        scoreCp: lines[0]?.cp ?? 0,
        mate: null,
        secondScoreCp: lines[1]?.cp ?? 0,
        secondMate: null,
        shallowScoreCp: lines[0]?.cp ?? 0,
        shallowMate: null,
        candidates: lines.map((line, index) => ({
          rank: index + 1,
          uci: line.uci,
          scoreCp: line.cp,
          mate: null,
          pv: [line.uci],
        })),
      };
    },
  } as unknown as StockfishController;

  const random = seeded(seed);
  const style = elo >= 2000 ? PERSONALITY_STYLES.brandon : PERSONALITY_STYLES['bryan-widjaja'];
  const game = new Chess(START);
  const ranks: number[] = [];
  const losses: number[] = [];

  for (let turn = 0; turn < turns; turn += 1) {
    if (game.isGameOver()) game.load(START);
    const lines = rankMoves(game.fen()).slice(0, HUMAN_MULTI_PV);
    /* Mate scores and one-move wins are not a calibration question. */
    if (lines.length === 0 || Math.abs(lines[0].cp) > 800) {
      game.load(START);
      continue;
    }
    const chosen = await chooseBotMove({
      game,
      fen: game.fen(),
      /* Twenty plies of history: every theory window is closed, so this measures
         the rated engine path and not the book. */
      history: Array.from({ length: 20 }, (_, index) => `m${index}`),
      botColor: game.turn() as 'w' | 'b',
      style,
      elo,
      clockMs: 180_000,
      incrementMs: 2000,
      initialMs: 180_000,
      engine,
      random,
    });
    assert.ok(chosen, 'the chooser always returns a move');
    const index = lines.findIndex((line) => line.uci === chosen.uci);
    assert.ok(index >= 0, `illegal move ${chosen.uci}`);
    ranks.push(index + 1);
    losses.push(Math.max(0, lines[0].mover - lines[index].mover));
    game.move(chosen.uci as never);
  }

  const n = losses.length;
  return {
    seenEngine,
    stats: {
      samples: n,
      topShare: ranks.filter((rank) => rank === 1).length / n,
      meanRank: ranks.reduce((sum, rank) => sum + rank, 0) / n,
      meanLoss: losses.reduce((sum, loss) => sum + loss, 0) / n,
      bigLossShare: losses.filter((loss) => loss >= 100).length / n,
    },
  };
}

test('a 1400 character searches at its rating depth over a ten-line list', async () => {
  const { seenEngine } = await run({ elo: 1400, seed: 7, turns: 40 });
  assert.equal(seenEngine.multipv, HUMAN_MULTI_PV, 'the slip picker needs a wide list');
  assert.equal(seenEngine.depth, humanSearchDepth(1400, -2), 'blitz pays a two-ply offset');
  assert.ok(seenEngine.depth < 10, `no deep search for a 1400 (asked for depth ${seenEngine.depth})`);
  assert.equal(seenEngine.nodes, 0, 'a 1400 is out of the beginner node-cap band');
});

test('a 1400 plays human moves, not a near-engine game', async () => {
  const { stats } = await run({ elo: 1400, seed: 11 });
  /* These are the numbers a 95.8%-accuracy game cannot produce: it takes the
     first line nearly every move, loses almost nothing and never makes a
     hundred-centipawn mistake. */
  assert.ok(stats.topShare < 0.85, `top-line share ${stats.topShare.toFixed(2)} is engine-like`);
  assert.ok(
    stats.meanLoss > 30,
    `mean loss ${stats.meanLoss.toFixed(1)}cp is too precise for a 1400`,
  );
  assert.ok(
    stats.bigLossShare > 0.08,
    `only ${(stats.bigLossShare * 100).toFixed(0)}% of moves gave up 100cp+`,
  );
});

test('the ladder separates: the top of the range plays engine lines', async () => {
  const weak = await run({ elo: 1400, seed: 23 });
  const strong = await run({ elo: 2350, seed: 29 });
  const engineBot = await run({ elo: 2800, seed: 31, turns: 160 });
  assert.ok(
    strong.stats.meanLoss < weak.stats.meanLoss,
    `2350 mean loss ${strong.stats.meanLoss.toFixed(1)}cp vs 1400 ${weak.stats.meanLoss.toFixed(1)}cp`,
  );
  assert.ok(
    strong.stats.topShare > weak.stats.topShare,
    `2350 top share ${strong.stats.topShare.toFixed(2)} vs 1400 ${weak.stats.topShare.toFixed(2)}`,
  );
  assert.ok(
    engineBot.stats.topShare > 0.85,
    `2800 top-line share ${engineBot.stats.topShare.toFixed(2)}`,
  );
  assert.ok(engineBot.stats.meanLoss < 30, `2800 mean loss ${engineBot.stats.meanLoss.toFixed(1)}cp`);
});

test('the trace records the target Elo, the chosen rank and the centipawn drop', async () => {
  setBotTraceEnabled(true);
  try {
    const { seenEngine } = await run({ elo: 1400, seed: 3, turns: 40 });
    assert.ok(botTraces.length >= 30, 'one trace per engine move');
    const last = botTraces[botTraces.length - 1];
    assert.equal(last.elo, 1400);
    assert.equal(last.multiPv, HUMAN_MULTI_PV);
    assert.equal(last.depth, seenEngine.depth);
    assert.ok(last.rank >= 1 && last.rank <= HUMAN_MULTI_PV, `rank ${last.rank}`);
    assert.ok(last.cpLoss >= 0, 'loss is a non-negative centipawn count');
    /* The recorded ranks must be the ones actually played, not decoration. */
    assert.ok(
      new Set(botTraces.map((trace) => trace.rank)).size > 1,
      'the bot does not always play the first line',
    );
    assert.ok(
      botTraces.some((trace) => trace.kind !== null),
      'some moves come from a rolled error band',
    );
  } finally {
    setBotTraceEnabled(false);
  }
});
