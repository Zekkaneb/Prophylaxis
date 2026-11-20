import { Chess, type Square } from 'chess.js';
import {
  db,
  type MoveEvaluation,
  type Puzzle,
  type SavedReview,
  type WoodpeckerSet,
} from '../db';
import { isMoveClassification, type MoveClassification } from '../config/moveClassifications';
import type { EngineEvaluation } from '../engine/useStockfish';
import { sampleLessons } from '../lessons/sampleLessons';
import { mainline, parsePgn as parsePgnText } from '../pgn';
import { BOOK_PLY_LIMIT, loadOpeningBook, lookupBookMove, normalizeBookFen } from './openingBook';
import { toChessComRating } from '../puzzles/tiers.ts';

/**
 * Default search depth for game review.
 *
 * 16 is the floor for the "deep engine-only" Brilliant rule: the depth-6
 * snapshot has to be visibly wrong about the move before a deeper search
 * overturns it.
 */
export const ANALYSIS_DEPTH = 16;

/* -------------------------------------------------------------------------- */
/*                                PGN parsing                                 */
/* -------------------------------------------------------------------------- */

export interface ParsedMove {
  san: string;
  uci: string;
  color: 'w' | 'b';
  moveNumber: number;
  fenBefore: string;
  fenAfter: string;
  /** Annotation text that followed this move in the source PGN, if any. */
  comment?: string;
  /** Numeric Annotation Glyphs (`$5`) and suffix forms (`!?`) already normalised. */
  nags?: number[];
}

export interface ParsedGame {
  pgn: string;
  white: string;
  black: string;
  /** `WhiteElo` tag when the PGN carried a real rating, else null. */
  whiteElo?: string | null;
  /** `BlackElo` tag when the PGN carried a real rating, else null. */
  blackElo?: string | null;
  result: string;
  event: string;
  date: string;
  startingFen: string;
  moves: ParsedMove[];
  /** Non-fatal problems met while reading the file (variations dropped, junk tokens). */
  warnings?: string[];
}

/**
 * Parses PGN text into headers and a fully positioned move list.
 *
 * The tokens and the move TREE come from `src/pgn` (the merged parser): it
 * understands variations, comments, NAGs and multi-game files that chess.js's
 * `loadPgn` silently flattens. chess.js is then used only for what it is good
 * at — replaying the main line to produce legal FENs — so a bad move is
 * reported with its move number instead of a generic parse error.
 */
export function parsePgn(pgn: string): ParsedGame {
  const trimmed = pgn.trim();
  if (!trimmed) throw new Error('Paste a PGN or upload a .pgn file first.');

  const { games } = parsePgnText(trimmed);
  const game = games[0];
  if (!game) throw new Error('That PGN contains no moves.');

  const headers = game.headers;
  const headerFen = headers.FEN?.trim();

  let board: Chess;
  try {
    board = headerFen ? new Chess(headerFen) : new Chess();
  } catch {
    throw new Error('That PGN starts from an unreadable FEN position.');
  }

  const nodes = mainline(game);
  if (nodes.length === 0) throw new Error('That PGN contains no moves.');

  const moves: ParsedMove[] = nodes.map((node) => {
    const fenBefore = board.fen();
    const [turnField, , , , , fullmoveField] = fenBefore.split(' ');
    const moveNumber = Number.parseInt(fullmoveField ?? '1', 10) || 1;
    const side = turnField === 'b' ? 'b' : 'w';

    try {
      const move = board.move(node.san);
      return {
        san: move.san,
        uci: `${move.from}${move.to}${move.promotion ?? ''}`,
        color: move.color,
        moveNumber,
        fenBefore,
        fenAfter: move.after,
        ...(node.comment ? { comment: node.comment } : {}),
        ...(node.nags.length > 0 ? { nags: [...node.nags] } : {}),
      };
    } catch {
      throw new Error(
        `Illegal move ${moveNumber}${side === 'w' ? '.' : '...'} ${node.san} — check the PGN around that point.`,
      );
    }
  });

  return {
    pgn: trimmed,
    white: headers.White || 'White',
    black: headers.Black || 'Black',
    /* Unrated games carry `?` and online exports often carry `-`, so only a
       numeric tag is worth showing next to a name. */
    whiteElo: /^\d{3,4}$/.test((headers.WhiteElo ?? '').trim()) ? headers.WhiteElo.trim() : null,
    blackElo: /^\d{3,4}$/.test((headers.BlackElo ?? '').trim()) ? headers.BlackElo.trim() : null,
    result: game.result ?? headers.Result ?? '*',
    event: headers.Event || '',
    date: headers.Date || '',
    startingFen: moves[0].fenBefore,
    moves,
    ...(game.warnings.length > 0 ? { warnings: [...game.warnings] } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/*                    Evaluation maths (White-perspective cp)                 */
/* -------------------------------------------------------------------------- */

export interface EvalSnapshot {
  scoreCp: number;
  mate: number | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundTo1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * UCI scores are relative to the side to move in the evaluated FEN. This maps
 * one such raw score onto White's perspective.
 */
export function toWhitePov(rawScore: number, turn: 'w' | 'b'): number {
  return turn === 'w' ? rawScore : -rawScore;
}

/**
 * White-perspective score as the mover experiences it. `EngineEvaluation`
 * already stores White-POV scores (see `useStockfish.buildEvaluation`), so this
 * is the only remaining flip: White's +2.0 is -2.0 for a Black mover.
 */
export function toMoverPov(whiteScore: number, mover: 'w' | 'b'): number {
  return mover === 'w' ? whiteScore : -whiteScore;
}

/** Score from the moving side's point of view. */
function valueForSide(evaluation: EvalSnapshot, color: 'w' | 'b'): number {
  return toMoverPov(evaluation.scoreCp, color);
}

/** Mate distance from the moving side's point of view (negative = getting mated). */
function mateForSide(evaluation: EvalSnapshot, color: 'w' | 'b'): number | null {
  if (evaluation.mate === null) return null;
  return color === 'w' ? evaluation.mate : -evaluation.mate;
}

/**
 * Lichess's win-probability curve: centipawns → 0-100% for one side.
 *
 * `cp` is measured from the perspective being scored and is clamped to
 * ±1000 so a mate-sized score cannot fold the curve. Forced mates are
 * absolute: 100% for the mating side, 0% for the side being mated.
 */
export function cpToWinPercent(cp: number, mate: number | null = null): number {
  if (mate !== null) {
    if (mate > 0) return 100;
    if (mate < 0) return 0;
    // mate === 0 means the side to move is already checkmated; the signed
    // centipawn score still tells us who won.
    return cp > 0 ? 100 : cp < 0 ? 0 : 50;
  }
  const clamped = clamp(cp, -1000, 1000);
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamped)) - 1);
}

/** Win probability (0-100) for the given side, used for accuracy and the bar. */
export function winPercentForSide(evaluation: EvalSnapshot, color: 'w' | 'b' = 'w'): number {
  return cpToWinPercent(valueForSide(evaluation, color), mateForSide(evaluation, color));
}

/* -------------------------------------------------------------------------- */
/*                     Three-layer weighted accuracy model                    */
/* -------------------------------------------------------------------------- */

/** Everything the accuracy model needs to know about one played move. */
export interface AccuracyMoveInput {
  classification: MoveClassification;
  /** Win probability before the move, mover's point of view (0–100). */
  winBefore: number;
  /** Win probability after the move, mover's point of view (0–100). */
  winAfter: number;
  /** Gap to the runner-up engine move, in win-probability points. */
  secondBestWinGap: number;
  /** The label was escalated by the defending-position rule. */
  escalated?: boolean;
}

/** Layer 1: a smooth falloff in win probability, before any tag is applied. */
function baseAccuracyScore(winDrop: number): number {
  return 100 * Math.exp(-0.045 * Math.pow(Math.max(0, winDrop), 1.15));
}

/** Layers 1 + 2: the per-move score after the classification overrides. */
export function moveAccuracyScore(move: AccuracyMoveInput): number {
  const winDrop = Math.max(0, move.winBefore - move.winAfter);
  let score = baseAccuracyScore(winDrop);

  switch (move.classification) {
    case 'brilliant':
    case 'clutch':
    case 'great':
    case 'best':
    case 'book':
      score = 100;
      break;
    case 'mistake':
      // An escalated mistake is worse than its win-drop alone suggests.
      if (move.escalated) score = Math.min(score, 35);
      break;
    case 'blunder':
    case 'throw':
      score = 0;
      break;
    default:
      break;
  }

  return clamp(score, 0, 100);
}

/** Layer 3: how much this move counts in the game average. */
export function moveAccuracyWeight(move: AccuracyMoveInput): number {
  switch (move.classification) {
    case 'forced':
      return 0;
    case 'book':
      return 0.5;
    case 'brilliant':
    case 'clutch':
      return 1.3;
    case 'great':
      return 1.15;
    case 'mistake':
      return 1.6;
    case 'blunder':
    case 'throw':
      return 2.5;
    default:
      // Sharp positions make ordinary decisions count more; quiet ones less.
      if (move.secondBestWinGap >= 15) return 1.4;
      if (move.secondBestWinGap < 3) return 0.75;
      return 1;
  }
}

/**
 * Weighted game accuracy: `Σ(score · weight) / Σ(weight)`, 0–100 to 1 dp.
 * A game made entirely of forced moves has no decisions to score, so it reads
 * as 100 rather than dividing by zero.
 */
export function calculateGameAccuracy(moves: AccuracyMoveInput[]): number {
  let weighted = 0;
  let weight = 0;

  for (const move of moves) {
    const moveWeight = moveAccuracyWeight(move);
    if (moveWeight <= 0) continue;
    weighted += moveAccuracyScore(move) * moveWeight;
    weight += moveWeight;
  }

  if (weight <= 0) return 100;
  return Math.round(clamp(weighted / weight, 0, 100) * 10) / 10;
}

/* -------------------------------------------------------------------------- */
/*                          Repertoire + material helpers                     */
/* -------------------------------------------------------------------------- */

/** FEN key -> UCI motions the saved repertoire expects at that position. */
function buildRepertoireIndex(): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();

  for (const lesson of sampleLessons) {
    const game = new Chess(lesson.startingFen);
    const repertoireSide: 'w' | 'b' = lesson.repertoireColor === 'white' ? 'w' : 'b';
    for (const move of lesson.moves) {
      let played;
      try {
        played = game.move({
          from: move.uci.slice(0, 2),
          to: move.uci.slice(2, 4),
          ...(move.uci.length === 5 ? { promotion: move.uci[4] } : {}),
        });
      } catch {
        break;
      }
      if (played.color !== repertoireSide) continue;

      const key = normalizeBookFen(played.before);
      const allowed = index.get(key) ?? new Set<string>();
      allowed.add(`${played.from}${played.to}${played.promotion ?? ''}`);
      index.set(key, allowed);
    }
  }

  return index;
}

const PIECE_VALUE: Record<string, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 0,
};

/** Material total for one side, in centipawns, read straight from the FEN board. */
function materialFor(fen: string, color: 'w' | 'b'): number {
  const board = fen.split(' ')[0];
  let total = 0;
  for (const char of board) {
    const value = PIECE_VALUE[char.toLowerCase()];
    if (!value) continue;
    const isWhitePiece = char === char.toUpperCase();
    if ((color === 'w' && isWhitePiece) || (color === 'b' && !isWhitePiece)) total += value;
  }
  return total;
}

/** Deepest capture chain SEE resolves before giving up on the position. */
const SEE_MAX_PLIES = 8;

/**
 * Static exchange: material the side to move nets by capturing on `to`, in
 * centipawns, assuming both sides keep taking while it pays.
 *
 * The board after the capture must be re-created for the recursion because the
 * piece lists change with every move; promotions are valued as a queen.
 */
function seeCapture(game: Chess, from: Square, to: Square, plies = SEE_MAX_PLIES): number {
  const target = game.get(to);
  const attacker = game.get(from);
  if (!target || !attacker) return 0;

  const captured = PIECE_VALUE[target.type] ?? 0;
  // Promotion is what SEE assumes: the pawn turns into a queen.
  const promotion = attacker.type === 'p' && (to[1] === '8' || to[1] === '1') ? 800 : 0;

  const next = new Chess(game.fen());
  try {
    next.move({ from, to, promotion: 'q' });
  } catch {
    // Illegal capture (pinned piece, king exposure): it simply is not available.
    return 0;
  }

  if (plies <= 1) return captured + promotion;

  // Whatever the opponent takes back, they will pick the line that hurts most;
  // declining the recapture is worth 0 to them.
  let bestReply = 0;
  for (const square of next.attackers(to, next.turn())) {
    bestReply = Math.max(bestReply, seeCapture(next, square, to, plies - 1));
  }

  return captured + promotion - Math.max(0, bestReply);
}

/**
 * Net material exchange of the move itself, in centipawns (negative = material
 * given up). Quiet moves exchange nothing, so they score 0.
 *
 * A capture only counts as material won once the recapture is priced in: taking
 * a defended pawn with a knight is -2.2 even though the board briefly shows
 * White up a pawn.
 */
function immediateMaterialDiff(fenBefore: string, uci: string): number {
  const game = new Chess(fenBefore);
  const from = uci.slice(0, 2) as Square;
  const to = uci.slice(2, 4) as Square;
  if (!game.get(to)) return 0;
  return seeCapture(game, from, to);
}

/**
 * Material the opponent can win by capturing a knight, bishop, rook or queen
 * the mover just left hanging, in centipawns (0 when nothing is offered).
 * Equal trades price out at 0, so they never register as a sacrifice.
 */
function offeredMaterialLoss(fenAfter: string, color: 'w' | 'b'): number {
  const game = new Chess(fenAfter);
  const opponent = color === 'w' ? 'b' : 'w';

  let worst = 0;
  for (const row of game.board()) {
    for (const piece of row) {
      if (!piece || piece.color !== color) continue;
      if (piece.type !== 'n' && piece.type !== 'b' && piece.type !== 'r' && piece.type !== 'q') {
        continue;
      }
      for (const from of game.attackers(piece.square, opponent)) {
        worst = Math.max(worst, seeCapture(game, from, piece.square));
      }
    }
  }

  return worst;
}

/**
 * True when the move offers material: it loses the exchange immediately (a
 * defended pawn taken with a piece) or leaves a piece hanging where the
 * opponent's best capture drops the mover at least a pawn below the material
 * balance they had before the move.
 *
 * The comparison against `balanceBefore` is what keeps equal trades out: after
 * Rxe2 the rook is capturable, but recapturing only restores the material the
 * move just took, so the balance is unchanged and it is not a sacrifice.
 */
function isPieceSacrifice(
  fenBefore: string,
  fenAfter: string,
  uci: string,
  color: 'w' | 'b',
): boolean {
  if (immediateMaterialDiff(fenBefore, uci) <= -100) return true;

  const opponent = color === 'w' ? 'b' : 'w';
  const balanceBefore = materialFor(fenBefore, color) - materialFor(fenBefore, opponent);
  const balanceAfter = materialFor(fenAfter, color) - materialFor(fenAfter, opponent);
  const offered = offeredMaterialLoss(fenAfter, color);

  return balanceAfter - offered <= balanceBefore - 100;
}

/**
 * True when the previous move captured on the square this move captures on —
 * an ordinary take-back. Recaptures are forced by the position, so they must
 * never be dressed up as a Brilliant or a Great move.
 */
function isRoutineRecapture(uci: string, previous: MoveEvaluation | null): boolean {
  if (!previous || !previous.uci) return false;
  const target = uci.slice(2, 4);
  if (previous.uci.slice(2, 4) !== target) return false;
  try {
    return Boolean(new Chess(previous.fen_before).get(target as Square));
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/*                             Classification engine                          */
/* -------------------------------------------------------------------------- */

export interface ClassificationInput {
  color: 'w' | 'b';
  uci: string;
  fenBefore: string;
  fenAfter: string;
  before: EngineEvaluation;
  after: EngineEvaluation;
  /** Previous ply, needed for the recapture check. */
  previous: MoveEvaluation | null;
  /** How this player's own previous move (two plies back) was classified. */
  prevPlayerMoveClass?: MoveClassification | null;
  /** Played move in SAN, used only by the debug trace. */
  san?: string;
}

export interface ClassificationResult {
  classification: MoveClassification;
  centipawnLoss: number;
  accuracy: number;
  /** Win probability (0-100) before the move, mover's point of view. */
  winBefore: number;
  /** Win probability right after the move, mover's point of view. */
  winAfter: number;
  /** Win probability after the move as a depth-6 search sees it. */
  shallowWinAfter: number;
  /** `Math.max(0, winBefore - winAfter)`, the severity unit. */
  winDrop: number;
  /** Win-probability gap to the runner-up line, in points. */
  secondBestWinGap: number;
  /** The defending-position rule escalated the label. */
  escalated: boolean;
  /** Evaluation before the move, mover's point of view. */
  scoreBefore: number;
  scoreAfter: number;
  secondScore: number | null;
}

/**
 * Severity bands, in win-probability points.
 *
 * Each value is its band's *lower* edge, matching the six-tier model the
 * Elo-rated bots are calibrated on (`qualityShares` in `play/humanStrength.ts`):
 * Best < 0.4, Excellent 0.4-1.8, Good 1.8-4.5, Inaccuracy 4.5-10, Mistake
 * 10-20, Blunder 20+.
 *
 * Best is not a band: it is an identity test (the move must be the engine's own
 * first choice), so there is no win-drop threshold for it. Everything that is
 * not #1 lands in the bands below, which is what makes the label trustworthy.
 * Review and play then speak the same language: a move the bot played as an
 * Excellent is labelled an Excellent when the game is analysed.
 */
export const WIN_THRESHOLDS = {
  /** Good starts here: 2% of win probability given up. */
  good: 2,
  /** Inaccuracy starts here: 5%. */
  inaccuracy: 5,
  /** Mistake starts here: 10%. */
  mistake: 10,
  /** Blunder: 20 ≤ winDrop. */
  blunder: 20,
  missedWinDrop: 15,
  missedWinStillWinning: 68,
  missDrop: 20,
  /** Centipawns lost that count as dropping at least a minor piece. */
  pieceHangCp: 250,
  /** Below this mover-relative score the game was already gone. */
  hopelessEval: -400,
  /** Win% at or below which a collapse is treated as throwing the game. */
  collapseWinAfter: 50,
  /** A throw starts from a game that was already won… */
  throwWinBefore: 60,
  /** …gives up at least this much win probability… */
  throwDrop: 45,
  /** …and leaves the mover in a lost position. */
  throwWinAfter: 15,
} as const;

/**
 * Contextual escalation: judging the damage a move adds, not just the raw
 * swing. When the mover is already the side under pressure, the win-percentage
 * scale is compressed — a 100 cp slip from −2.0 barely moves the bar but is
 * another pawn gone in practice. These thresholds let that extra damage count.
 *
 * All values are mover-relative.
 */
export const CONTEXT_ESCALATION = {
  /** Centipawns behind the mover must be to count as defending. */
  deficitCp: 150,
  /** Win probability (0-100) below which the mover counts as under pressure. */
  pressureWin: 35,
  /** Inaccuracy → Mistake: damage that must accompany the slip. */
  inaccuracyCpLoss: 100,
  inaccuracyWinDrop: 12,
  /** Mistake → Blunder: damage that clears the blunder bar in that context. */
  blunderWinDrop: 20,
  blunderCpLoss: 250,
} as const;

/**
 * Applies the 15-tier hierarchy in priority order. Special and tactical tags
 * are resolved first, then the plain centipawn-loss bands.
 *
 * Priority: book (handled by the caller, engine skipped) → forced → clutch →
 * accidental hang → brilliant → great → forced mate → miss → best / excellent /
 * good / inaccuracy / mistake → blunder → throw.
 */
export function classifyMove(input: ClassificationInput): ClassificationResult {
  const { color, uci, fenBefore, fenAfter, before, after, prevPlayerMoveClass } = input;

  const beforeSnapshot: EvalSnapshot = { scoreCp: before.scoreCp, mate: before.mate };
  const afterSnapshot: EvalSnapshot = { scoreCp: after.scoreCp, mate: after.mate };

  const bestScore = valueForSide(beforeSnapshot, color);
  const afterScore = valueForSide(afterSnapshot, color);
  const mateBefore = mateForSide(beforeSnapshot, color);
  const mateAfter = mateForSide(afterSnapshot, color);

  const second: EvalSnapshot | null = before.secondBestMove
    ? { scoreCp: before.secondScoreCp, mate: before.secondMate }
    : null;
  const secondScore = second ? valueForSide(second, color) : null;
  const secondMate = second ? mateForSide(second, color) : null;

  // Win probability, not centipawns, is the severity unit: the same 200 cp
  // slip is background noise at +9.0 and a disaster at 0.0.
  const winBefore = cpToWinPercent(bestScore, mateBefore);
  const winAfter = cpToWinPercent(afterScore, mateAfter);
  const winDrop = Math.max(0, winBefore - winAfter);

  // Depth-6 opinion of the resulting position: the blunder rule only fires
  // when the damage is concrete, not a 14-ply engine-only squeeze.
  const shallowAfterSnapshot: EvalSnapshot = {
    scoreCp: Number.isFinite(after.shallowScoreCp) ? after.shallowScoreCp : after.scoreCp,
    mate: after.shallowMate ?? null,
  };
  const shallowWinAfter = cpToWinPercent(
    valueForSide(shallowAfterSnapshot, color),
    mateForSide(shallowAfterSnapshot, color),
  );

  const centipawnLoss = Math.max(0, Math.round(bestScore - afterScore));

  // Is the mover already the one suffering? `bestScore` is mover-relative, so
  // a deficit is negative — a piece down reads as −150 or worse. Win
  // probability below 35% catches the same thing when material is level.
  const moverDeficit = Math.max(0, -bestScore);
  const defending =
    moverDeficit >= CONTEXT_ESCALATION.deficitCp || winBefore < CONTEXT_ESCALATION.pressureWin;

  /*
   * `Best` is a claim about identity, not closeness: the played move has to be
   * the engine's own first choice. A #2 line that gives up 0.1% of win
   * probability is not "what the engine wanted", so it can never be Best — the
   * bands below hand it Excellent instead. MultiPV's top line is the reference;
   * `bestMove` is the fallback for callers that only kept one line.
   */
  const topEngineMove = before.candidates[0]?.uci ?? before.bestMove;
  const isTopEngineMove =
    topEngineMove !== null && topEngineMove.toLowerCase() === uci.toLowerCase();

  // Win-probability gap between the played/top move and the runner-up engine
  // move, in points: how much better this move is than the alternative. Used
  // by the Clutch and Brilliant rules, which care about uniqueness rather than
  // raw centipawns. No second line (or a mate) means there is no evidence of
  // uniqueness, so the gap stays 0 and the special tags cannot fire.
  const secondWinPercent = secondScore === null ? null : cpToWinPercent(secondScore, secondMate);
  const secondBestWinGap =
    secondWinPercent === null ? 0 : Math.max(0, winAfter - secondWinPercent);

  // How much the depth-6 search dislikes the move compared with the full
  // search: the distance between "looks like a mistake" and "is the move".
  const shallowWinDrop = Math.max(0, winBefore - shallowWinAfter);

  // A single legal move is not a decision, so it is tagged before anything is
  // said about its quality.
  let legalMoveCount = 2;
  try {
    legalMoveCount = new Chess(fenBefore).moves().length;
  } catch {
    legalMoveCount = 2;
  }
  const forcedMove = legalMoveCount === 1;

  const recapture = isRoutineRecapture(uci, input.previous);

  const accuracyInput = (
    classification: MoveClassification,
    escalated: boolean,
  ): AccuracyMoveInput => ({
    classification,
    winBefore,
    winAfter,
    secondBestWinGap,
    escalated,
  });

  const result = (
    classification: MoveClassification,
    escalated = false,
  ): ClassificationResult => {
    const accuracy = moveAccuracyScore(accuracyInput(classification, escalated));
    /* Vite replaces `import.meta.env` at build time; the cast keeps this
       function callable from plain Node (the unit tests import it directly). */
    const viteDev = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV;
    if (viteDev) {
      // Temporary trace: shows exactly how the engine score was re-oriented.
      // `raw*` is side-to-move POV as Stockfish sent it, `white*` is the
      // stored White-POV score, `mover*` is what the rules compare.
      const turnBefore = before.fen.split(' ')[1] === 'b' ? 'b' : 'w';
      const turnAfter = after.fen.split(' ')[1] === 'b' ? 'b' : 'w';
      console.debug('[review] classifyMove', {
        san: input.san ?? uci,
        turnBefore,
        rawBefore: toWhitePov(before.scoreCp, turnBefore),
        whiteBefore: before.scoreCp,
        moverEvalBefore: Math.round(bestScore),
        turnAfter,
        rawAfter: toWhitePov(after.scoreCp, turnAfter),
        whiteAfter: after.scoreCp,
        moverEvalAfter: Math.round(afterScore),
        cpLoss: centipawnLoss,
        winBefore: roundTo1(winBefore),
        winAfter: roundTo1(winAfter),
        winDrop: roundTo1(winDrop),
        shallowWinAfter: roundTo1(shallowWinAfter),
        shallowWinDrop: roundTo1(shallowWinDrop),
        secondBestWinGap: roundTo1(secondBestWinGap),
        forced: forcedMove,
        recapture,
        defending,
        moverDeficit,
        classification,
        escalated,
        accuracy: roundTo1(accuracy),
      });
    }

    return {
      classification,
      escalated,
      centipawnLoss,
      accuracy,
      winBefore,
      winAfter,
      shallowWinAfter,
      winDrop,
      secondBestWinGap,
      scoreBefore: bestScore,
      scoreAfter: afterScore,
      secondScore,
    };
  };

  /**
   * Escalates the plain severity band when the mover was already defending:
   * an inaccuracy that also loses real material becomes a mistake, and a
   * mistake that throws more material while lost becomes a blunder.
   *
   * The special tags are never escalated — brilliant, clutch, forced and book
   * already describe intent rather than damage.
   */
  const withContext = (
    classification: MoveClassification,
  ): { classification: MoveClassification; escalated: boolean } => {
    if (!defending) return { classification, escalated: false };

    let next = classification;
    let escalated = false;

    if (
      next === 'inaccuracy' &&
      (centipawnLoss >= CONTEXT_ESCALATION.inaccuracyCpLoss ||
        winDrop >= CONTEXT_ESCALATION.inaccuracyWinDrop)
    ) {
      next = 'mistake';
      escalated = true;
    }

    // Checked after the first step: a huge loss while lost can climb two
    // rungs in one move (inaccuracy → mistake → blunder).
    if (
      next === 'mistake' &&
      (winDrop >= CONTEXT_ESCALATION.blunderWinDrop ||
        centipawnLoss >= CONTEXT_ESCALATION.blunderCpLoss)
    ) {
      next = 'blunder';
      escalated = true;
    }

    return { classification: next, escalated };
  };

  // Forced first: the position chose the move, not the player.
  if (forcedMove) return result('forced');

  /* Clutch: dead lost before the move (≤20% or a piece-and-more down), the
     only move that rescues the game (≥45%), and the runner-up stays lost —
     so the save really was the single resource. */
  const clutchPosition = winBefore <= 20 || bestScore <= -300;
  if (clutchPosition && isTopEngineMove && secondBestWinGap >= 25 && winAfter >= 45) {
    return result('clutch');
  }

  const pieceSacrifice = isPieceSacrifice(fenBefore, fenAfter, uci, color);

  /* A throw is a blunder that hands over a game that was already won: it is
     kept separate because the accuracy model zeroes it and weights it heaviest. */
  const throwsGame =
    winBefore >= WIN_THRESHOLDS.throwWinBefore &&
    winDrop >= WIN_THRESHOLDS.throwDrop &&
    winAfter <= WIN_THRESHOLDS.throwWinAfter;

  /*
   * Accidental hangs are graded before any brilliance rule can look at them.
   * Offering material and losing real evaluation is damage, not intent: the
   * move gets Mistake or Blunder straight away, so neither the sacrifice route
   * nor the deep-only route can rescue it.
   */
  const accidentalHang = pieceSacrifice && (winDrop >= 20 || centipawnLoss >= 150);

  if (accidentalHang) {
    const severe =
      winDrop >= WIN_THRESHOLDS.blunder ||
      centipawnLoss >= CONTEXT_ESCALATION.blunderCpLoss;
    return result(throwsGame ? 'throw' : severe ? 'blunder' : 'mistake');
  }

  /*
   * Brilliant, route 1 — the sound sacrifice.
   *
   * Material has to be offered, the position must not already have been won
   * (a sacrifice from +7 is just technique, not brilliance), the engine must
   * still call it at least equal (≥45%) and the move may cost at most 6 points
   * of win probability. That last allowance is what upgrades moves the plain
   * bands filed as Best or Excellent into Brilliant.
   *
   * The engine must also approve: the move is the top choice (≤2 points lost),
   * is clearly better than the runner-up line, or is one of the two lines the
   * engine actually considered.
   */
  const sacrificeSound =
    isTopEngineMove && pieceSacrifice && winBefore <= 90 && winAfter >= 45;
  const brilliantSacrifice = sacrificeSound && winDrop <= 3;

  /*
   * Brilliant, route 2 — the deep engine-only move. Unchanged: depth 6 thinks
   * it is a mistake, the full search and a wide runner-up gap prove it is the
   * only move that holds the position.
   */
  const brilliantDeep =
    isTopEngineMove && shallowWinDrop >= 12 && winDrop <= 2 && secondBestWinGap >= 15;

  if (!recapture && (brilliantSacrifice || brilliantDeep)) {
    return result('brilliant');
  }

  /* Great is the same "only move" idea at a lower bar — but never for a
     routine recapture, which is just bookkeeping, and only for the engine's
     own first choice: a #2 that happens to hold the position is not unique. */
  const followUpToBrilliant = prevPlayerMoveClass === 'brilliant';

  /* The runner-up has to be a real alternative the engine considered, and it
     has to be at least ten points of win probability worse. */
  const onlyMove = secondScore !== null && secondBestWinGap >= 10;

  if (!recapture && isTopEngineMove && onlyMove) return result('great');

  // ---- Blunders first: a hung piece must never be filed as a mere miss ----

  // Rule 1: a forced mate appears that did not exist before.
  const allowsMate =
    mateAfter !== null && mateAfter < 0 && (mateBefore === null || mateBefore > 0);

  // Rule 2: material-scale loss (>= a minor piece) from a playable position
  // that leaves the mover no longer comfortably winning. This is the direct
  // "hung a piece" catch and does not depend on the shallow-search opinion.
  const hangsMaterial =
    bestScore > WIN_THRESHOLDS.hopelessEval &&
    centipawnLoss >= WIN_THRESHOLDS.pieceHangCp &&
    (afterScore <= 150 || (bestScore >= 150 && afterScore <= 50));

  // Rule 3: win-probability collapse to a draw or worse.
  const winCollapse =
    winBefore > 25 &&
    winDrop >= WIN_THRESHOLDS.blunder &&
    winAfter <= WIN_THRESHOLDS.collapseWinAfter;

  if (allowsMate || hangsMaterial || winCollapse) {
    return result(throwsGame ? 'throw' : 'blunder');
  }

  // Missed knockout: the knockout was there (88%+ or a forced mate) and is
  // gone, but the game is still comfortably won — that is never a blunder.
  const hadKnockout = winBefore >= 88 || (mateBefore !== null && mateBefore > 0);
  if (
    hadKnockout &&
    winDrop >= WIN_THRESHOLDS.missedWinDrop &&
    winAfter >= WIN_THRESHOLDS.missedWinStillWinning
  ) {
    return result('miss');
  }

  // Plain severity band: 20 points of win probability is a blunder even when
  // none of the tactical rules above fired. Checked after the missed knockout
  // so a knockout missed from a still-won position stays a miss.
  if (winDrop >= WIN_THRESHOLDS.blunder) {
    return result(throwsGame ? 'throw' : 'blunder');
  }

  /* A Brilliant sets up a forcing line. If the very next move lets the win slip
     back to equal, the continuation was missed — that is a miss, not a mere
     inaccuracy (severe collapses were already graded as blunders above). */
  if (followUpToBrilliant && winDrop >= 12 && winAfter < 55) {
    return result('miss');
  }

  // Miss: pv1 would have reached a winning position (>= 75%) and the move
  // leaves the game around equal — a chance was missed, nothing was ruined.
  if (winBefore >= 75 && winDrop >= WIN_THRESHOLDS.missDrop && winAfter >= 42) {
    return result('miss');
  }

  if (winDrop >= WIN_THRESHOLDS.mistake) {
    const escalated = withContext('mistake');
    return result(escalated.classification, escalated.escalated);
  }

  if (winDrop >= WIN_THRESHOLDS.inaccuracy) {
    const escalated = withContext('inaccuracy');
    return result(escalated.classification, escalated.escalated);
  }

  if (winDrop >= WIN_THRESHOLDS.good) return result('good');

  /* Under 5% of win probability nothing real was given up. Best is reserved for
     the engine's own first move; every other move — however small the gap — is
     an Excellent, which is what keeps Best meaningful. */
  if (isTopEngineMove) return result('best');
  return result('excellent');
}

/* -------------------------------------------------------------------------- */
/*                               Analysis pass                                */
/* -------------------------------------------------------------------------- */

export interface AnalysisProgress {
  completed: number;
  total: number;
}

export interface AnalysisOptions {
  depth?: number;
  signal?: AbortSignal;
  onProgress?: (progress: AnalysisProgress) => void;
}

export type ClassificationCounts = Record<MoveClassification, number>;

export interface ReviewSummary {
  whiteAccuracy: number;
  blackAccuracy: number;
  whiteCounts: ClassificationCounts;
  blackCounts: ClassificationCounts;
  whiteAverageCpl: number;
  blackAverageCpl: number;
}

/**
 * Performance rating for one player, predicted from the game itself.
 *
 * Accuracy supplies the scale and average centipawn loss the damage: a log
 * term means 10 → 40 cp still matters, while 150 → 300 cp barely moves the
 * number. Deliberately coarse — a fun estimate, not an official rating — and
 * clamped to a plausible range.
 */
export function estimateElo(accuracy: number, averageCpl: number): number {
  if (!Number.isFinite(accuracy) || !Number.isFinite(averageCpl)) return 0;
  const clampedAccuracy = Math.min(100, Math.max(0, accuracy));
  const clampedCpl = Math.max(0, averageCpl);
  const estimate = 481 + 21.7 * clampedAccuracy - 195.8 * Math.log(clampedCpl + 1);
  return Math.round(Math.min(2900, Math.max(400, estimate)) / 10) * 10;
}

export interface AnalysisResult {
  review: SavedReview;
  summary: ReviewSummary;
}

const EMPTY_COUNTS = (): ClassificationCounts => ({
  brilliant: 0,
  clutch: 0,
  great: 0,
  best: 0,
  excellent: 0,
  good: 0,
  forced: 0,
  book: 0,
  inaccuracy: 0,
  mistake: 0,
  miss: 0,
  blunder: 0,
  throw: 0,
});

function abortError(): Error {
  const error = new Error('Analysis cancelled.');
  error.name = 'AbortError';
  return error;
}

/**
 * Evaluates every non-book position (MultiPV 2), then derives centipawn loss,
 * the 15-tier classification, accuracy and per-move data before persisting.
 */
export async function analyzeGame(
  parsed: ParsedGame,
  evaluatePosition: (fen: string, depth?: number) => Promise<EngineEvaluation>,
  options: AnalysisOptions = {},
): Promise<AnalysisResult> {
  const depth = options.depth ?? ANALYSIS_DEPTH;
  const signal = options.signal;
  const total = parsed.moves.length;
  const fens = [parsed.startingFen, ...parsed.moves.map((move) => move.fenAfter)];

  if (signal?.aborted) throw abortError();
  await loadOpeningBook();
  if (signal?.aborted) throw abortError();

  const repertoire = buildRepertoireIndex();
  const deviationSeen: Record<'w' | 'b', boolean> = { w: false, b: false };

  const evaluations: MoveEvaluation[] = [];
  const counts = { w: EMPTY_COUNTS(), b: EMPTY_COUNTS() };
  /** Each player's previous move label, for the sequence-aware follow-up rules. */
  const playerClass: Record<'w' | 'b', MoveClassification | null> = { w: null, b: null };
  const accuracyInputs: Record<'w' | 'b', AccuracyMoveInput[]> = { w: [], b: [] };
  const cplTotals: Record<'w' | 'b', number> = { w: 0, b: 0 };

  let before: EngineEvaluation | null = null;
  let previous: MoveEvaluation | null = null;

  for (let index = 0; index < total; index += 1) {
    const move = parsed.moves[index];
    if (signal?.aborted) throw abortError();

    const allowed = repertoire.get(normalizeBookFen(move.fenBefore));
    const deviation = !deviationSeen[move.color] && allowed ? !allowed.has(move.uci) : false;
    if (deviation) deviationSeen[move.color] = true;

    const bookMatch = index < BOOK_PLY_LIMIT ? lookupBookMove(move.fenAfter) : null;

    if (bookMatch && !deviation) {
      const bookBefore: EvalSnapshot = before
        ? { scoreCp: before.scoreCp, mate: before.mate }
        : { scoreCp: 0, mate: null };

      counts[move.color].book += 1;
      accuracyInputs[move.color].push({
        classification: 'book',
        winBefore: 50,
        winAfter: 50,
        secondBestWinGap: 0,
      });

      previous = {
        ply: index + 1,
        move_number: move.moveNumber,
        color: move.color,
        san: move.san,
        uci: move.uci,
        fen_before: move.fenBefore,
        fen_after: move.fenAfter,
        eval_before: bookBefore.scoreCp,
        eval_after: 0,
        mate_before: bookBefore.mate,
        mate_after: null,
        best_move: before?.bestMove ?? '',
        best_line: before?.pv ?? [],
        centipawn_loss: 0,
        classification: 'book',
        accuracy: 100,
      };
      evaluations.push(previous);
      playerClass[move.color] = 'book';

      before = null;
      options.onProgress?.({ completed: index + 1, total });
      continue;
    }

    // This position was skipped if the previous move followed the book.
    if (!before) before = await evaluatePosition(fens[index], depth);
    const after = await evaluatePosition(fens[index + 1], depth);
    if (signal?.aborted) throw abortError();

    const classified = classifyMove({
      color: move.color,
      san: move.san,
      uci: move.uci,
      fenBefore: move.fenBefore,
      fenAfter: move.fenAfter,
      before,
      after,
      previous,
      prevPlayerMoveClass: playerClass[move.color],
    });

    playerClass[move.color] = classified.classification;
    counts[move.color][classified.classification] += 1;
    accuracyInputs[move.color].push({
      classification: classified.classification,
      winBefore: classified.winBefore,
      winAfter: classified.winAfter,
      secondBestWinGap: classified.secondBestWinGap,
      escalated: classified.escalated,
    });
    cplTotals[move.color] += classified.centipawnLoss;

    previous = {
      ply: index + 1,
      move_number: move.moveNumber,
      color: move.color,
      san: move.san,
      uci: move.uci,
      fen_before: move.fenBefore,
      fen_after: move.fenAfter,
      eval_before: before.scoreCp,
      eval_after: after.scoreCp,
      mate_before: before.mate,
      mate_after: after.mate,
      best_move: before.bestMove ?? '',
      best_line: before.pv,
      centipawn_loss: classified.centipawnLoss,
      classification: classified.classification,
      second_best_move: before.secondBestMove ?? undefined,
      second_eval: before.secondScoreCp,
      second_mate: before.secondMate,
      shallow_score_cp: after.shallowScoreCp,
      shallow_mate: after.shallowMate,
      second_best_win_gap: classified.secondBestWinGap,
      escalated: classified.escalated,
      accuracy: classified.accuracy,
    };
    evaluations.push(previous);

    before = after;
    options.onProgress?.({ completed: index + 1, total });
  }

  const summary: ReviewSummary = {
    whiteAccuracy: calculateGameAccuracy(accuracyInputs.w),
    blackAccuracy: calculateGameAccuracy(accuracyInputs.b),
    whiteCounts: counts.w,
    blackCounts: counts.b,
    whiteAverageCpl: Math.round(cplTotals.w / Math.max(1, accuracyInputs.w.length)),
    blackAverageCpl: Math.round(cplTotals.b / Math.max(1, accuracyInputs.b.length)),
  };

  const review: SavedReview = {
    game_id: `review-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    pgn: parsed.pgn,
    white_player: parsed.white,
    black_player: parsed.black,
    white_elo: parsed.whiteElo ?? null,
    black_elo: parsed.blackElo ?? null,
    evaluations,
    created_at: Date.now(),
  };

  await db.saved_reviews.put(review);

  return { review, summary };
}

/* -------------------------------------------------------------------------- */
/*                             Summary + formatting                           */
/* -------------------------------------------------------------------------- */

/** Recomputes the dashboard summary from a stored review (no engine needed). */
export function summarizeReview(review: SavedReview): ReviewSummary {
  const counts = { w: EMPTY_COUNTS(), b: EMPTY_COUNTS() };
  const accuracyInputs: Record<'w' | 'b', AccuracyMoveInput[]> = { w: [], b: [] };
  const cplTotals: Record<'w' | 'b', number> = { w: 0, b: 0 };

  for (const evaluation of review.evaluations) {
    const color = evaluation.color;

    // Records written before the 13-tier vocabulary are skipped rather than
    // being counted under a label that no longer exists.
    if (!isMoveClassification(evaluation.classification)) continue;

    if (evaluation.classification === 'book') {
      counts[color].book += 1;
      accuracyInputs[color].push({
        classification: 'book',
        winBefore: 50,
        winAfter: 50,
        secondBestWinGap: 0,
      });
      continue;
    }

    const winBefore = winPercentForSide(
      { scoreCp: evaluation.eval_before, mate: evaluation.mate_before },
      color,
    );
    const winAfter = winPercentForSide(
      { scoreCp: evaluation.eval_after, mate: evaluation.mate_after },
      color,
    );

    const secondSnapshot: EvalSnapshot | null =
      typeof evaluation.second_eval === 'number'
        ? { scoreCp: evaluation.second_eval, mate: evaluation.second_mate ?? null }
        : null;
    const secondWin = secondSnapshot ? winPercentForSide(secondSnapshot, color) : null;
    const secondBestWinGap =
      typeof evaluation.second_best_win_gap === 'number'
        ? evaluation.second_best_win_gap
        : secondWin === null
          ? 0
          : Math.max(0, winAfter - secondWin);

    accuracyInputs[color].push({
      classification: evaluation.classification,
      winBefore,
      winAfter,
      secondBestWinGap,
      escalated: evaluation.escalated === true,
    });
    counts[color][evaluation.classification] += 1;
    cplTotals[color] += evaluation.centipawn_loss;
  }

  return {
    whiteAccuracy: calculateGameAccuracy(accuracyInputs.w),
    blackAccuracy: calculateGameAccuracy(accuracyInputs.b),
    whiteCounts: counts.w,
    blackCounts: counts.b,
    whiteAverageCpl: Math.round(cplTotals.w / Math.max(1, accuracyInputs.w.length)),
    blackAverageCpl: Math.round(cplTotals.b / Math.max(1, accuracyInputs.b.length)),
  };
}

/** `+1.4`, `-0.7`, `M3`, `-M2`, `#` (mate already delivered). */
export function formatEvaluation(scoreCp: number, mate: number | null): string {
  if (mate !== null) {
    if (mate === 0) return '#';
    return `${mate > 0 ? '' : '-'}M${Math.abs(mate)}`;
  }
  const pawns = scoreCp / 100;
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(1)}`;
}

/**
 * An engine line as move-numbered SAN (`5. e4 d4 6. Nce2`), the way an
 * analysis list reads. Stops at `maxPlies` and at the first move that does not
 * apply, so a stale principal variation can never throw or print nonsense.
 */
export function formatPvLine(fen: string, pv: readonly string[], maxPlies = 10): string {
  let game: Chess;
  try {
    game = new Chess(fen);
  } catch {
    return '';
  }

  const parts: string[] = [];
  for (const uci of pv.slice(0, maxPlies)) {
    /* FEN is `pieces turn castling en-passant halfmove fullmove`, so the side to
       move and the move number are fields 1 and 5 — not 0 and 5. Reading them
       one slot off labelled every line "1..." and dropped the numbers after
       the first move. */
    const [, turn, , , , fullmove] = game.fen().split(' ');
    try {
      const move = game.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        ...(uci.length > 4 ? { promotion: uci[4] } : {}),
      });
      if (turn === 'w') parts.push(`${fullmove}. ${move.san}`);
      else parts.push(parts.length === 0 ? `${fullmove}... ${move.san}` : move.san);
    } catch {
      break;
    }
  }
  return parts.join(' ');
}

/** Bar height (percent) occupied by White. */
export function whiteAdvantagePercent(scoreCp: number, mate: number | null): number {
  if (mate !== null) return mate > 0 ? 100 : mate < 0 ? 0 : scoreCp > 0 ? 100 : 0;
  return Math.round(winPercentForSide({ scoreCp, mate }));
}

export function uciToSan(fen: string, uci: string): string {
  if (!uci) return '';
  try {
    const game = new Chess(fen);
    const move = game.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      ...(uci.length === 5 ? { promotion: uci[4] } : {}),
    });
    return move.san;
  } catch {
    return uci;
  }
}

/* -------------------------------------------------------------------------- */
/*                          Woodpecker export helper                          */
/* -------------------------------------------------------------------------- */

/** Deck every reviewed tactic is appended to. */
export const MY_GAME_BLUNDERS_SET_ID = 'wp-my-game-blunders';
export const MY_GAME_BLUNDERS_SET_NAME = 'My Game Blunders';

export interface WoodpeckerExportResult {
  setId: string;
  setName: string;
  puzzleId: string;
  /** True when this export created the deck. */
  createdSet: boolean;
  /** True when the puzzle was newly added (false = already in the deck). */
  added: boolean;
}

/**
 * Copies a reviewed tactic into the "My Game Blunders" deck.
 *
 * The puzzle starts one ply earlier so the trainer auto-plays the opponent's
 * mistake and then asks for the continuation the player missed. The engine's
 * PV1 line (best move first) becomes the solution.
 *
 * `plyIndex` is the `ply` value stored on the evaluation — i.e. the reviewed
 * move's 1-based half-move number.
 */
export async function exportTacticToWoodpecker(
  reviewId: string,
  plyIndex: number,
): Promise<WoodpeckerExportResult> {
  const review = await db.saved_reviews.get(reviewId);
  if (!review) throw new Error('That game review is no longer saved locally.');

  const index = review.evaluations.findIndex((entry) => entry.ply === plyIndex);
  if (index < 1) throw new Error('This move has no preceding move to build a puzzle from.');

  const missed = review.evaluations[index];
  const setup = review.evaluations[index - 1];
  const line = missed.best_line.slice(0, 6);

  if (line.length === 0) throw new Error('No engine line was stored for this position.');

  const puzzleId = `review-${review.game_id}-${missed.ply}`;
  const puzzle: Puzzle = {
    puzzle_id: puzzleId,
    fen: setup.fen_before,
    moves: [setup.uci, ...line].join(' '),
    /* Same chess.com scale as the rest of the puzzle library: a quiet position
       grades easier than a sharp one, capped where the Elite band begins. */
    rating: Math.min(
      toChessComRating(2600),
      toChessComRating(1400) + Math.round(missed.centipawn_loss),
    ),
    themes: ['review', 'missed-tactic', missed.classification.toLowerCase()],
  };

  await db.puzzles.put(puzzle);

  const existing = await db.woodpecker_sets.get(MY_GAME_BLUNDERS_SET_ID);
  if (!existing) {
    const set: WoodpeckerSet = {
      set_id: MY_GAME_BLUNDERS_SET_ID,
      tier_name: MY_GAME_BLUNDERS_SET_NAME,
      puzzle_ids: [puzzleId],
      current_cycle: 1,
      history: [],
      created_at: Date.now(),
    };
    await db.woodpecker_sets.add(set);
    return {
      setId: MY_GAME_BLUNDERS_SET_ID,
      setName: MY_GAME_BLUNDERS_SET_NAME,
      puzzleId,
      createdSet: true,
      added: true,
    };
  }

  if (existing.puzzle_ids.includes(puzzleId)) {
    return {
      setId: MY_GAME_BLUNDERS_SET_ID,
      setName: MY_GAME_BLUNDERS_SET_NAME,
      puzzleId,
      createdSet: false,
      added: false,
    };
  }

  await db.woodpecker_sets.put({
    ...existing,
    puzzle_ids: [...existing.puzzle_ids, puzzleId],
  });

  return {
    setId: MY_GAME_BLUNDERS_SET_ID,
    setName: MY_GAME_BLUNDERS_SET_NAME,
    puzzleId,
    createdSet: false,
    added: true,
  };
}
