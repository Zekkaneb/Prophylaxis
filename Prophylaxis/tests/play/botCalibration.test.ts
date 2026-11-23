import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { chooseBotMove } from '../../src/play/personality/chooseMove.ts';
import { personalityWeighting, styleFor } from '../../src/play/personality/styles.ts';
import { PERSONALITY_OPPONENTS } from '../../src/play/opponents.ts';
import { HUMAN_MULTI_PV, humanSearchDepth } from '../../src/play/humanStrength.ts';
import { botTraces, setBotTraceEnabled } from '../../src/play/botDebug.ts';
import {
  MOVE_QUALITY_META,
  MOVE_QUALITY_ORDER,
  QUALITY_WEIGHTS,
  USCF_CLASSES,
  classBookPlies,
  classSearchDepth,
  classifyMoveQuality,
  isUnforcedPieceDrop,
  renormalizeWeights,
  rollClassQuality,
  selectClassMove,
  totalWeight,
  uscfClassFor,
  type MoveQuality,
} from '../../src/play/uscfClasses.ts';
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

/** The engine contract, answered with a static evaluation of every legal move. */
function staticEngine(seen: { depth: number; multipv: number; nodes: number }) {
  return {
    evaluateWithin: async (
      fen: string,
      depth: number,
      multiPv: number,
      _movetime?: number,
      nodes?: number,
    ) => {
      seen.depth = depth;
      seen.multipv = multiPv;
      seen.nodes = nodes ?? 0;
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
  const engine = staticEngine(seenEngine);

  const random = seeded(seed);
  /* The production path: `styleFor` resolves the profile's accuracy from the
     rating, which a raw `PERSONALITY_STYLES` lookup does not. */
  const style = styleFor(elo >= 2000 ? 'brandon' : 'bryan-widjaja', elo);
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

/**
 * Quiet, non-terminal positions every card is measured on.
 *
 * The ladder has to be compared on the *same* board: two self-games diverge on
 * move one, so a character's mean loss then mixes its strength with the
 * positions it happened to reach. These come from one neutral playout, and each
 * character is asked for a move on each of them.
 */
function quietPositions(count: number): string[] {
  const game = new Chess(START);
  const random = seeded(99);
  const out: string[] = [];
  for (let step = 0; step < count * 3 && out.length < count; step += 1) {
    if (game.isGameOver()) game.load(START);
    const lines = rankMoves(game.fen()).slice(0, HUMAN_MULTI_PV);
    if (lines.length > 1 && Math.abs(lines[0].cp) < 500) out.push(game.fen());
    const moves = game.moves({ verbose: true });
    const move = moves[Math.floor(random() * moves.length)];
    game.move({ from: move.from, to: move.to, promotion: move.promotion });
  }
  return out;
}

/** Mean centipawn loss of one card, measured on the shared positions. */
async function cardLoss(id: string, elo: number, positions: readonly string[]): Promise<number> {
  const style = styleFor(id, elo);
  const random = seeded(5);
  const engine = staticEngine({ depth: 0, multipv: 0, nodes: 0 });
  let total = 0;
  let samples = 0;

  for (const fen of positions) {
    const game = new Chess(fen);
    const lines = rankMoves(fen).slice(0, HUMAN_MULTI_PV);
    const chosen = await chooseBotMove({
      game,
      fen,
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
    /* A plan move or a book reply can sit outside the top ten lines; only moves
       the list contains can be scored for loss. */
    if (index < 0) continue;
    total += Math.max(0, lines[0].mover - lines[index].mover);
    samples += 1;
  }

  return total / samples;
}

test('the card ladder is monotone: a higher rating never plays measurably worse', async () => {
  const positions = quietPositions(60);
  const cards = PERSONALITY_OPPONENTS.filter((opponent) => opponent.kind === 'personality')
    .map((opponent) => ({ id: opponent.id, elo: opponent.elo }))
    .sort((a, b) => a.elo - b.elo);

  const byElo = new Map<number, number[]>();
  for (const card of cards) {
    assert.ok(styleFor(card.id, card.elo), `${card.id} has no style`);
    const loss = await cardLoss(card.id, card.elo, positions);
    byElo.set(card.elo, [...(byElo.get(card.elo) ?? []), loss]);
  }

  const levels = [...byElo.entries()]
    .map(([elo, losses]) => ({
      elo,
      loss: losses.reduce((sum, loss) => sum + loss, 0) / losses.length,
    }))
    .sort((a, b) => a.elo - b.elo);

  /* 60 shared positions through a static evaluation leave roughly ±8 cp of
     noise on a card's mean. Ten centipawns is the smallest bound that measures
     the ladder rather than that noise, so anything above it is a real
     inversion: the roster used to hide a ~20 cp step backwards at 1600 behind
     a 20 cp tolerance. */
  const TOLERANCE_CP = 10;
  for (let index = 1; index < levels.length; index += 1) {
    const lower = levels[index - 1];
    const higher = levels[index];
    assert.ok(
      higher.loss <= lower.loss + TOLERANCE_CP,
      `${higher.elo} (${higher.loss.toFixed(1)}cp) plays worse than ${lower.elo} (${lower.loss.toFixed(1)}cp)`,
    );
  }

  /* The ladder also has to separate at the ends: the top cards cannot be level
     with the middle of the roster. */
  const bottom = levels.filter((level) => level.elo <= 1450);
  const top = levels.filter((level) => level.elo >= 2000);
  const bottomLoss = bottom.reduce((sum, level) => sum + level.loss, 0) / bottom.length;
  const topLoss = top.reduce((sum, level) => sum + level.loss, 0) / top.length;
  assert.ok(
    topLoss < bottomLoss - 40,
    `top cards average ${topLoss.toFixed(1)}cp against ${bottomLoss.toFixed(1)}cp below 1450`,
  );
});

test('one weighting curve: accuracy rises and taste falls with the rating', () => {
  let previous = personalityWeighting(800);
  for (const elo of [1000, 1200, 1400, 1600, 1800, 2000, 2200, 2400]) {
    const next = personalityWeighting(elo);
    assert.ok(next.accuracy > previous.accuracy, `accuracy falls at ${elo}`);
    assert.ok(next.taste < previous.taste, `taste rises at ${elo}`);
    previous = next;
  }
  /* A profile's whole taste bonus is a few tens of centipawns, so at the top it
     can never outvote a real evaluation gap. */
  assert.ok(personalityWeighting(2400).taste < 0.12);
});

/**
 * The regression this file was missing: a 2000-rated card hung a whole piece
 * for no reason. Two separate holes produced it — the quality roll still gave a
 * 2000 a ~1% blunder bucket, and `slipBand('blunder', 2000)` sized that bucket
 * at 137-441 cp, roughly a piece. Both are closed, and the chooser's final
 * ceiling means no future band, character dial or engine list can reopen them.
 */
test('a 2000 bot never gives up a piece while a clean move exists', async () => {
  const positions = quietPositions(40);

  for (const elo of [2000, 2200]) {
    const style = styleFor('brandon', elo);
    assert.ok(style, `${elo} has no style`);
    const random = seeded(41 + elo);
    const engine = staticEngine({ depth: 0, multipv: 0, nodes: 0 });
    let worst = 0;
    let worstFen = '';

    for (const fen of positions) {
      const game = new Chess(fen);
      const lines = rankMoves(fen).slice(0, HUMAN_MULTI_PV);
      const best = lines[0];
      /* A bot already 500 cp down may gamble; that is not a hang. */
      if (!best || best.mover < -500) continue;

      const chosen = await chooseBotMove({
        game,
        fen,
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
      if (index < 0) continue;
      const loss = Math.max(0, best.mover - lines[index].mover);
      if (loss > worst) {
        worst = loss;
        worstFen = fen;
      }
    }

    /* 120 cp is the 2000 ceiling and 75 the 2200 one; 150 is the bound the bug
       report asked for, and a hung piece (~300+) is far outside it. */
    assert.ok(worst <= 150, `${elo} gave up ${worst}cp on ${worstFen}`);
  }
});

test('a 2000 searches deep enough to see the recapture', async () => {
  const { seenEngine } = await run({ elo: 2000, seed: 17, turns: 25 });
  assert.ok(seenEngine.depth >= 10, `a 2000 searched at depth ${seenEngine.depth}`);
  assert.equal(seenEngine.nodes, 0, 'a 2000 is out of the beginner node band');
});

/* --------------------------------------------------------------------------
   USCF classes and the 13-quality model
   -------------------------------------------------------------------------- */

const START_BOARD = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** One candidate list every class is measured on, best first. */
const CLASS_CANDIDATES = [
  { uci: 'e2e4', winPctLoss: 0 },
  { uci: 'd2d4', winPctLoss: 1 },
  { uci: 'g1f3', winPctLoss: 4 },
  { uci: 'b1c3', winPctLoss: 9 },
  { uci: 'a2a3', winPctLoss: 40 },
] as const;

/** Midpoint win-loss each quality stands for, in centipawns. */
const QUALITY_LOSS_CP: Record<MoveQuality, number> = {
  clutch: 0,
  brilliant: 0,
  great: 0,
  best: 0,
  excellent: 15,
  good: 60,
  forced: 0,
  book: 0,
  inaccuracy: 130,
  mistake: 250,
  miss: 220,
  blunder: 450,
  throw: 900,
};

test('every USCF class owns the search depth and book depth the spec lists', () => {
  assert.deepEqual(
    USCF_CLASSES.map((tier) => [tier.label, tier.min, tier.max, tier.depth, tier.bookPlies]),
    [
      ['Class E', 1000, 1199, 3, 3],
      ['Class D', 1200, 1399, 4, 5],
      ['Class C', 1400, 1599, 5, 7],
      ['Class B', 1600, 1799, 7, 9],
      ['Class A', 1800, 1999, 9, 11],
      ['Expert+', 2000, null, 11, 14],
    ],
  );

  /* The bands are contiguous and their edges belong to the lower class. */
  assert.deepEqual(
    [999, 1000, 1199, 1200, 1399, 1400, 1599, 1600, 1799, 1800, 1999, 2000, 2800].map(
      (elo) => uscfClassFor(elo).id,
    ),
    ['E', 'E', 'E', 'D', 'D', 'C', 'C', 'B', 'B', 'A', 'A', 'expert', 'expert'],
  );

  assert.equal(classSearchDepth(1000), 3);
  assert.equal(classSearchDepth(1400, -1), 4);
  assert.equal(classSearchDepth(1600), 7);
  assert.equal(classSearchDepth(1800), 9);
  /* Expert+ never drops below its eleven plies, even in bullet. */
  assert.equal(classSearchDepth(2000, -3), 11);
  assert.equal(classSearchDepth(2800), 13);
  assert.equal(classSearchDepth(999), null, 'the beginner curve owns sub-1000 depths');
  assert.equal(humanSearchDepth(1400), 5);
  assert.equal(humanSearchDepth(1800), 9);
  assert.equal(humanSearchDepth(2800), 13);

  assert.equal(classBookPlies(400), 4);
  assert.equal(classBookPlies(1000), 3);
  assert.equal(classBookPlies(1200), 5);
  assert.equal(classBookPlies(1400), 7);
  assert.equal(classBookPlies(1600), 9);
  assert.equal(classBookPlies(1800), 11);
  assert.equal(classBookPlies(2000), 14);
});

test('the classifier maps win-loss onto the 13 qualities', () => {
  assert.equal(MOVE_QUALITY_ORDER.length, 13);
  assert.equal(Object.keys(MOVE_QUALITY_META).length, 13);
  assert.equal(MOVE_QUALITY_META.forced.symbol, '⇒');
  assert.equal(MOVE_QUALITY_META.book.symbol, '▣');
  assert.equal(MOVE_QUALITY_META.clutch.symbol, '○');

  const classify = (winPctLoss: number, extra: Record<string, unknown> = {}) =>
    classifyMoveQuality({ winPctLoss, ...extra });

  /* Best / Excellent / Good / Inaccuracy / Mistake / Blunder / Throw bands. */
  assert.equal(classify(0), 'best');
  assert.equal(classify(0.49), 'best');
  assert.equal(classify(0.5), 'excellent');
  assert.equal(classify(1.99), 'excellent');
  assert.equal(classify(2), 'good');
  assert.equal(classify(4.99), 'good');
  assert.equal(classify(5), 'inaccuracy');
  assert.equal(classify(9.99), 'inaccuracy');
  assert.equal(classify(10), 'mistake');
  assert.equal(classify(19.99), 'mistake');
  assert.equal(classify(20), 'blunder');
  assert.equal(classify(34.99), 'blunder');
  assert.equal(classify(35), 'blunder', 'the blunder band ends at 35 inclusive');
  assert.equal(classify(35.01), 'throw');
  assert.equal(classify(90), 'throw');

  /* The win that was there and went is a Miss, not a Mistake. */
  assert.equal(classify(12, { bestWinPct: 92, winPct: 80 }), 'miss');
  assert.equal(classify(12, { bestWinPct: 60, winPct: 48 }), 'mistake');

  /* Deterministic overrides beat every band. */
  assert.equal(classify(40, { legalMoves: 1 }), 'forced');
  assert.equal(classify(40, { book: true }), 'book');
  assert.equal(classify(0, { rank: 1, clockMs: 8_000 }), 'clutch');
  assert.equal(classify(0, { rank: 1, defending: true }), 'clutch');
  assert.equal(classify(0, { rank: 1, sacrificeCp: 300, winPct: 70 }), 'brilliant');
  assert.equal(classify(0, { rank: 1, secondBestGap: 12 }), 'great');
  /* Only the engine's first line can be Best. */
  assert.equal(classify(0, { rank: 2 }), 'excellent');
});

test('each class has a probability matrix that sums to one and gates its worst moves', () => {
  for (const tier of USCF_CLASSES) {
    const row = QUALITY_WEIGHTS[tier.id];
    assert.ok(Math.abs(totalWeight(row) - 1) < 1e-9, `${tier.label} sums to ${totalWeight(row)}`);
    /* Deterministic overrides and by-products are never rolled for. */
    for (const quality of ['forced', 'book', 'clutch', 'brilliant'] as const) {
      assert.equal(row[quality], 0, `${tier.label} rolls ${quality}`);
    }
  }

  /* Class A and Expert+ have no blunder or throw mass at all; neither rolls a
     mistake, and only the two weakest classes can throw a game. */
  for (const id of ['A', 'expert'] as const) {
    assert.equal(QUALITY_WEIGHTS[id].blunder, 0, `${id} blunder`);
    assert.equal(QUALITY_WEIGHTS[id].throw, 0, `${id} throw`);
    assert.equal(QUALITY_WEIGHTS[id].mistake, 0, `${id} mistake`);
  }
  assert.ok(QUALITY_WEIGHTS.E.throw > 0);
  assert.ok(QUALITY_WEIGHTS.D.throw > 0);
  assert.equal(QUALITY_WEIGHTS.C.throw, 0);

  /* An empty bucket hands its mass to the buckets that do exist, in
     proportion: E's best/excellent ratio survives the re-normalization. */
  const kept = renormalizeWeights(
    QUALITY_WEIGHTS.E,
    (quality) => quality === 'best' || quality === 'excellent',
  );
  assert.ok(Math.abs(totalWeight(kept) - 1) < 1e-9);
  assert.ok(Math.abs(kept.best / kept.excellent - QUALITY_WEIGHTS.E.best / QUALITY_WEIGHTS.E.excellent) < 1e-9);
  assert.equal(kept.good, 0);

  const nothing = renormalizeWeights(QUALITY_WEIGHTS.E, () => false);
  assert.equal(nothing.best, 1);

  /* A strong class never rolls a blunder, throw, mistake or miss, whatever the
     die says. Inaccuracy survives for Class A: a 1800's loose move is real. */
  const forbidden = new Set<MoveQuality>(['blunder', 'throw', 'mistake', 'miss']);
  for (const elo of [1800, 2000, 2200, 2800]) {
    const rolled = new Set<MoveQuality>();
    const random = seeded(elo);
    for (let roll = 0; roll < 400; roll += 1) {
      rolled.add(rollClassQuality({ elo, random }));
    }
    for (const quality of rolled) {
      assert.ok(!forbidden.has(quality), `${elo} rolled ${quality}`);
    }
  }
  /* The floor class still has all 13 outcomes reachable through its matrix. */
  assert.ok(QUALITY_WEIGHTS.E.mistake > QUALITY_WEIGHTS.A.inaccuracy);
});

test('higher classes have strictly smaller expected loss', () => {
  const expected = (tier: (typeof USCF_CLASSES)[number]) =>
    MOVE_QUALITY_ORDER.reduce(
      (sum, quality) => sum + QUALITY_WEIGHTS[tier.id][quality] * QUALITY_LOSS_CP[quality],
      0,
    );
  const losses = USCF_CLASSES.map(expected);
  for (let index = 1; index < losses.length; index += 1) {
    assert.ok(
      losses[index] < losses[index - 1],
      `${USCF_CLASSES[index].label} (${losses[index].toFixed(1)}cp) is not better than ` +
        `${USCF_CLASSES[index - 1].label} (${losses[index - 1].toFixed(1)}cp)`,
    );
  }
  assert.ok(losses[0] > 100, `Class E expected loss ${losses[0].toFixed(1)}cp`);
  assert.ok(losses[losses.length - 1] < 10, `Expert+ expected loss ${losses.at(-1)!.toFixed(1)}cp`);
});

test('the class selector applies the forced, book, recapture and drop guards', () => {
  const forced = selectClassMove({
    fen: START_BOARD,
    elo: 1400,
    candidates: CLASS_CANDIDATES,
    legalMoves: 1,
    random: () => 0.99,
  });
  assert.equal(forced?.quality, 'forced');
  assert.equal(forced?.guard, 'forced');

  const book = selectClassMove({
    fen: START_BOARD,
    elo: 1400,
    candidates: CLASS_CANDIDATES,
    bookMove: 'e2e4',
  });
  assert.equal(book?.quality, 'book');
  assert.equal(book?.guard, 'book');

  /* An offered recapture is taken back from Class B up, without a roll. */
  const recaptureFen = '4k3/8/8/8/8/8/8/3qK3 w - - 0 1';
  const recapture = selectClassMove({
    fen: recaptureFen,
    elo: 1600,
    candidates: [
      { uci: 'e1d1', winPctLoss: 0 },
      { uci: 'e1f2', winPctLoss: 15 },
    ],
    lastCapture: { to: 'd1' },
    random: () => 0.99,
  });
  assert.equal(recapture?.uci, 'e1d1');
  assert.equal(recapture?.guard, 'recapture');

  /* An unforced piece drop is vetoed from Class B up. The rook on f3 hits g3;
     Nf2 is attacked too but defended by the king, so it is not a drop. */
  const dropFen = '4k3/8/8/8/8/5r2/8/4K2N w - - 0 1';
  assert.equal(isUnforcedPieceDrop(dropFen, 'h1g3'), true);
  assert.equal(isUnforcedPieceDrop(dropFen, 'h1f2'), false);
  const dropCandidates = [
    { uci: 'h1g3', winPctLoss: 0 },
    { uci: 'h1f2', winPctLoss: 30 },
  ];
  const guarded = selectClassMove({
    fen: dropFen,
    elo: 1600,
    candidates: dropCandidates,
    random: () => 0.5,
  });
  assert.equal(guarded?.uci, 'h1f2');
  const unguarded = selectClassMove({
    fen: dropFen,
    elo: 1000,
    candidates: dropCandidates,
    random: () => 0.5,
  });
  assert.equal(unguarded?.uci, 'h1g3');
});

test('Class A and Expert+ never pick a blunder, whatever they roll', () => {
  for (const elo of [1800, 2000, 2200, 2800]) {
    for (const roll of [0, 0.5, 0.75, 0.95, 0.999999]) {
      const pick = selectClassMove({
        fen: START_BOARD,
        elo,
        candidates: CLASS_CANDIDATES,
        random: () => roll,
      });
      assert.ok(pick, `${elo} returned no move`);
      assert.ok(
        !['blunder', 'throw', 'mistake', 'miss'].includes(pick.quality),
        `${elo} played ${pick.quality}`,
      );
      assert.notEqual(pick.uci, 'a2a3', `${elo} played the 25-point blunder`);
    }
  }

  /* Class E still has the whole distribution: the last roll is the throw. */
  const thrown = selectClassMove({
    fen: START_BOARD,
    elo: 1000,
    candidates: CLASS_CANDIDATES,
    random: () => 0.999999,
  });
  assert.equal(thrown?.quality, 'throw');
  assert.equal(thrown?.uci, 'a2a3');
});

test('on one candidate list every class plays better than the one below it', () => {
  const meanLoss = (elo: number) => {
    const random = seeded(1234 + elo);
    const draws = 900;
    let total = 0;
    for (let draw = 0; draw < draws; draw += 1) {
      const pick = selectClassMove({
        fen: START_BOARD,
        elo,
        candidates: CLASS_CANDIDATES,
        random,
      });
      assert.ok(pick, `${elo} returned no move`);
      const candidate = CLASS_CANDIDATES.find((entry) => entry.uci === pick.uci);
      assert.ok(candidate, `${elo} returned an off-list move`);
      total += candidate.winPctLoss;
    }
    return total / draws;
  };

  const elos = [1000, 1200, 1400, 1600, 1800, 2000];
  const means = elos.map(meanLoss);
  for (let index = 1; index < means.length; index += 1) {
    assert.ok(
      means[index] < means[index - 1],
      `${elos[index]} (${means[index].toFixed(2)} points) does not beat ` +
        `${elos[index - 1]} (${means[index - 1].toFixed(2)} points)`,
    );
  }
});
