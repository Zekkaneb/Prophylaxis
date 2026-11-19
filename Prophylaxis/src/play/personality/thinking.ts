import { Chess } from 'chess.js';
import { materialBalance } from './engine.ts';
import type { PersonalityStyle } from './styles.ts';

/**
 * How long a personality opponent should think.
 *
 * This is a planner, not a timer: it returns the budget the engine is *allowed*
 * to use for this one move. The search itself runs with `go depth N movetime M`,
 * so a quiet position stops at its depth early and a sharp one uses the whole
 * budget. Nothing here sleeps after the move is chosen — presentation pause is a
 * separate, tiny field.
 *
 * Inputs:
 * - the position (branching, checks, captures, material, king exposure),
 * - the bot's clock and increment,
 * - the character's tendency profile.
 *
 * The clock clamp is the important safety property: the budget is always less
 * than the remaining clock minus a reserve, and below 3 seconds it shrinks
 * sharply so the bot can never flag itself in one search.
 */

export type GamePhase = 'opening' | 'middlegame' | 'endgame';

export interface PositionProfile {
  phase: GamePhase;
  /** 0 (quiet, obvious) … 1 (sharp, many reasonable moves). */
  complexity: number;
  /** True when checks or heavy captures are available. */
  tactical: boolean;
  checks: number;
  captures: number;
  legalMoves: number;
  /** White minus Black material, in centipawns. */
  balance: number;
  /** 0–1, share of the king's ring attacked by the opponent. */
  kingExposure: number;
}

export interface ThinkingInput {
  fen: string;
  style: PersonalityStyle;
  /** The bot's remaining clock, or null for an untimed game. */
  clockMs: number | null;
  incrementMs: number;
  initialMs: number;
  /** Plies played so far. */
  ply: number;
  /** A repertoire move needs no search at all. */
  bookMove: boolean;
}

export interface ThinkingPlan {
  /** What the bot may spend on the move, search plus pause. */
  budgetMs: number;
  /** Hard cap handed to Stockfish; 0 when the move is already known. */
  searchMs: number;
  /** Cosmetic pause after deciding, so a book move is not instant. */
  pauseMs: number;
  /**
   * Minimum wall-clock time before the move is committed, measured from the
   * start of the bot's turn. Applies to every move, including a book move or a
   * position with one obvious best move: a human does not reply in 200ms.
   * Never larger than `budgetMs`, so it cannot make the bot flag.
   */
  deliberationMs: number;
  profile: PositionProfile;
  reason: 'book' | 'opening' | 'middlegame' | 'endgame' | 'low-clock' | 'critical';
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function kingExposure(game: Chess): number {
  const turn = game.turn();
  const opponent = turn === 'w' ? 'b' : 'w';
  let king: string | null = null;
  for (const row of game.board()) {
    for (const piece of row) {
      if (piece && piece.color === turn && piece.type === 'k') king = piece.square;
    }
  }
  if (!king) return 0;

  const file = king.charCodeAt(0) - 97;
  const rank = Number(king[1]) - 1;
  let attacked = 0;
  let squares = 0;
  for (let df = -1; df <= 1; df += 1) {
    for (let dr = -1; dr <= 1; dr += 1) {
      const f = file + df;
      const r = rank + dr;
      if (f < 0 || f > 7 || r < 0 || r > 7) continue;
      if (df === 0 && dr === 0) continue;
      const square = `${String.fromCharCode(97 + f)}${r + 1}`;
      squares += 1;
      if (game.attackers(square as never, opponent).length > 0) attacked += 1;
    }
  }
  return squares === 0 ? 0 : attacked / squares;
}

/** Reads the position from the side to move's point of view. */
export function profilePosition(fen: string): PositionProfile {
  const game = new Chess(fen);
  const moves = game.moves({ verbose: true });
  const checks = moves.filter((move) => move.san.includes('+') || move.san.includes('#')).length;
  const captures = moves.filter((move) => Boolean(move.captured)).length;
  const heavyCaptures = moves.filter(
    (move) => move.captured === 'n' || move.captured === 'b' || move.captured === 'r' || move.captured === 'q',
  ).length;

  let queens = 0;
  let nonPawn = 0;
  for (const row of game.board()) {
    for (const piece of row) {
      if (!piece) continue;
      if (piece.type === 'q') queens += 1;
      if (piece.type === 'n' || piece.type === 'b' || piece.type === 'r' || piece.type === 'q') nonPawn += 1;
    }
  }

  const fullmove = Number(fen.split(' ')[5] ?? 1);
  const endgame = queens === 0 && nonPawn <= 8;
  const phase: GamePhase =
    endgame || nonPawn <= 4 ? 'endgame' : fullmove <= 10 ? 'opening' : 'middlegame';

  const balance = materialBalance(fen);
  const exposure = kingExposure(game);
  const complexity = clamp01(
    0.4 * clamp01(moves.length / 42) +
      0.3 * clamp01((checks * 1.6 + heavyCaptures * 1.2) / 6) +
      0.15 * clamp01(Math.abs(balance) / 700) +
      0.15 * exposure,
  );

  return {
    phase,
    complexity,
    tactical: checks >= 2 || heavyCaptures >= 2,
    checks,
    captures,
    legalMoves: moves.length,
    balance,
    kingExposure: exposure,
  };
}

/** Character intake: who thinks longer, and about what. */
function characterFactor(style: PersonalityStyle, profile: PositionProfile): number {
  switch (style.id) {
    case 'freshman':
      /* Deliberate, but straightforward positions do not hold him long. */
      return 0.82 - 0.12 * profile.complexity;
    case 'sophomore':
      /* A beat longer when there is something to look for. */
      return 0.95 + 0.18 * profile.complexity;
    case 'junior':
      /* Patient and methodical, especially in quiet strategic positions. */
      return 1.12 + 0.18 * (1 - profile.complexity);
    case 'senior':
      /* Extra calculation where tactics are on the board. */
      return 0.95 + (profile.tactical ? 0.45 : 0.15) * profile.complexity;
    case 'brandon':
      /* A faster decision-maker, not a shallower one: quiet positions get a
         short look, sharp ones (especially with sacrifices available) earn
         the same deep calculation as anyone else. */
      return profile.tactical ? 0.9 + 0.4 * profile.complexity : 0.7 + 0.1 * profile.complexity;
    case 'brandon-freshman':
      /* Prime's instincts without Prime's calculation: a quick look at ordinary
         moves, a longer one only when there is an attack to calculate. */
      return profile.tactical ? 0.82 + 0.3 * profile.complexity : 0.68 + 0.1 * profile.complexity;
    case 'nina-freshman':
      /* The younger Nina looks at less: the same shape as her Sophomore look,
         shallower on both counts. */
      return 0.9 + (profile.tactical ? 0.16 : 0.06) * profile.complexity;
    case 'nina':
      /* Initiative-minded, but not a burn-the-house-down calculator: a normal
         look, a little longer when the position actually offers tactics. */
      return 0.95 + (profile.tactical ? 0.28 : 0.12) * profile.complexity;
    case 'faadi':
      /* Plays on feel: a quick look, a touch more when the board is sharp. */
      return 0.86 + (profile.tactical ? 0.3 : 0.08) * profile.complexity;
    case 'bryan':
      /* Ordinary intake: a normal look, and a little more once the board gets
         busy. Never rushed, never the deepest calculator at the table. */
      return 0.95 + 0.15 * profile.complexity;
    case 'bryan-sophomore':
      /* His look goes to the defensive question first, so a busy board earns a
         little more time — never the deepest calculation at the table. */
      return 0.94 + 0.12 * profile.complexity;
    case 'bryan-prime':
      /* Same eye for the position, but he takes the harder look: a little more
         time when the board is busy, without becoming the slowest at the table. */
      return 1.0 + 0.2 * profile.complexity;
    case 'edward':
      /* Straightforward decisions, and only a genuinely complicated position
         earns a longer look. A beginner does not sit and calculate. */
      return 0.8 + (profile.tactical ? 0.18 : 0.05) * profile.complexity;
  }
}

/** How unhurried each character is, independent of position. */
function deliberationFactor(style: PersonalityStyle): number {
  switch (style.id) {
    case 'freshman':
      return 0.85;
    case 'sophomore':
      return 1.0;
    case 'junior':
      return 1.2;
    case 'senior':
      return 1.3;
    case 'brandon':
      return 0.65;
    case 'brandon-freshman':
      /* The quickest at the table: he wants to see what happens next. */
      return 0.62;
    case 'nina-freshman':
      /* A little quicker, a little less sure of the position. */
      return 0.9;
    case 'nina':
      return 0.95;
    case 'faadi':
      /* Impatient: he wants to see what happens. */
      return 0.8;
    case 'bryan':
      /* Unhurried, but not slow: the middle of the range. */
      return 1.0;
    case 'bryan-sophomore':
      /* Unhurried, like Junior: defence is not a rush. */
      return 0.98;
    case 'bryan-prime':
      /* Slightly more considered than his Junior profile, still ordinary. */
      return 1.05;
    case 'edward':
      /* An ordinary beat: he is not slow, he is simply not sure. */
      return 0.9;
  }
}

/**
 * The human beat before a move lands: 1.5–5s by phase, tension and character.
 * This is deliberately much longer than the old cosmetic pause; it is what makes
 * the opponent feel like it is thinking rather than refilling the board.
 */
function deliberationWish(profile: PositionProfile, style: PersonalityStyle): number {
  const base = profile.phase === 'opening' ? 2100 : profile.phase === 'endgame' ? 2100 : 2400;
  const wish = (base + 2000 * profile.complexity) * deliberationFactor(style);
  return Math.min(6000, Math.max(1000, wish));
}

function baseBudget(profile: PositionProfile): number {
  switch (profile.phase) {
    case 'opening':
      return lerp(1200, 3200, profile.complexity);
    case 'endgame':
      return lerp(1800, 11000, profile.complexity);
    case 'middlegame':
      return lerp(3000, 15000, profile.complexity);
  }
}

/**
 * Clamps a wish to the clock. Returns the largest amount the bot can spend
 * without gambling its flag.
 */
function clampToClock(
  wishMs: number,
  input: ThinkingInput,
): { ms: number; low: boolean } {
  if (input.clockMs === null) return { ms: Math.min(wishMs, 20_000), low: false };

  const remaining = Math.max(0, input.clockMs);
  const movesToGo = Math.max(6, 40 - Math.floor(input.ply / 2));
  const incrementCredit = input.incrementMs * 0.6;
  const fairShare = remaining / movesToGo + incrementCredit;

  /* Reserve: enough for a few more moves. Never spend it on one search. */
  const reserve = Math.max(900, Math.min(input.initialMs * 0.12, 8000));
  const spendable = Math.max(0, remaining - reserve);

  let budget = Math.min(wishMs, fairShare, spendable);

  let low = false;
  if (remaining < 3000) {
    budget = Math.min(budget, remaining * 0.3);
    low = true;
  }
  if (remaining < 1200) {
    budget = Math.min(budget, Math.max(120, remaining * 0.15));
    low = true;
  }

  return { ms: Math.max(80, Math.round(budget)), low };
}

export function computeThinkingPlan(input: ThinkingInput): ThinkingPlan {
  const profile = profilePosition(input.fen);

  if (input.bookMove) {
    /* No search: the line is known. It still gets the full human deliberation
       beat — knowing the move is not the same as having played it instantly. */
    const wish = deliberationWish(profile, input.style);
    const { ms } = clampToClock(wish, input);
    return {
      budgetMs: ms,
      searchMs: 0,
      pauseMs: ms,
      deliberationMs: ms,
      profile,
      reason: 'book',
    };
  }

  const base = baseBudget(profile) * characterFactor(input.style, profile);
  const searchWish = Math.min(22_000, Math.max(400, base));
  const thinkWish = deliberationWish(profile, input.style);
  /* The budget must be large enough to hold the deliberation floor; otherwise
     the clock clamp would force a snap move even with a full clock. */
  const wish = Math.max(searchWish, thinkWish);
  const { ms, low } = clampToClock(wish, input);

  /* Search gets almost all of it; the pause only lets the move land legibly,
     and both must fit inside the budget — including on a nearly empty clock. */
  const pauseWant = low ? 60 : Math.round(Math.min(200, Math.max(70, ms * 0.06)));
  const pauseMs = Math.max(0, Math.min(pauseWant, ms - 80));
  const searchMs = Math.max(0, ms - pauseMs);

  const reason: ThinkingPlan['reason'] = low
    ? 'low-clock'
    : profile.tactical && profile.complexity > 0.55
      ? 'critical'
      : profile.phase;

  /* The move waits until this much of the turn has passed. The budget already
     respects the clock, so capping at it keeps the bot safe when nearly flagged. */
  const deliberationMs = Math.min(ms, Math.round(thinkWish));

  return { budgetMs: ms, searchMs, pauseMs, deliberationMs, profile, reason };
}

/** For tests and diagnostics: a one-line summary of a plan. */
export function describePlan(plan: ThinkingPlan): string {
  return `${plan.reason} · ${Math.round(plan.budgetMs / 100) / 10}s (search ${Math.round(
    plan.searchMs / 100,
  ) / 10}s, pause ${plan.pauseMs}ms, think ${plan.deliberationMs}ms, complexity ${plan.profile.complexity.toFixed(2)})`;
}
