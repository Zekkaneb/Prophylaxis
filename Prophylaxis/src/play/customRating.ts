/**
 * The app's own Elo-style rating engine.
 *
 * Standard Elo decides how likely a result was; the rules around it are ours:
 * a calibration phase for the first ten games, K that narrows as a player
 * climbs, a bonus for streaks against equal-or-stronger opposition, permanent
 * floors once a milestone is reached, and a reduced weight for bot games so the
 * ladder is not farmed.
 *
 * Nothing here touches Dexie, React or the network: the store in
 * `ratingStore.ts` loads the numbers and writes the answer back, which keeps
 * this file testable in Node.
 */

export type RatingCategory = 'bullet' | 'blitz' | 'rapid' | 'classical';

export const RATING_CATEGORIES: readonly RatingCategory[] = [
  'bullet',
  'blitz',
  'rapid',
  'classical',
];

export const RATING_LABELS: Record<RatingCategory, string> = {
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
  classical: 'Classical',
};

/** Time-control span each category owns, in words, for the setup screens. */
export const RATING_CATEGORY_HINT: Record<RatingCategory, string> = {
  bullet: 'Under 3 minutes',
  blitz: '3 to 9 minutes',
  rapid: '10 to 29 minutes',
  classical: '30 minutes or more',
};

/** The bot ladder's span; no rating may leave it. */
export const RATING_MIN = 100;
export const RATING_MAX = 2800;

/** Games 1–10 are placement: a wider K and a badge on the rating. */
export const CALIBRATION_GAMES = 10;

export interface PlacementSeed {
  id: 'beginner' | 'casual' | 'intermediate' | 'advanced';
  label: string;
  rating: number;
  blurb: string;
}

export const PLACEMENT_SEEDS: readonly PlacementSeed[] = [
  { id: 'beginner', label: 'Beginner', rating: 400, blurb: 'New to tournament play' },
  { id: 'casual', label: 'Casual', rating: 800, blurb: 'Plays for fun, knows the rules' },
  { id: 'intermediate', label: 'Intermediate', rating: 1200, blurb: 'Club player, tactics included' },
  { id: 'advanced', label: 'Advanced', rating: 1600, blurb: 'Strong club or tournament player' },
];

/** Which category a game belongs to, from the clock it was played on. */
export function categoryForSeconds(initialSeconds: number, untimed = false): RatingCategory {
  if (untimed) return 'classical';
  const minutes = initialSeconds / 60;
  if (minutes < 3) return 'bullet';
  if (minutes < 10) return 'blitz';
  if (minutes < 30) return 'rapid';
  return 'classical';
}

/** Standard Elo expectation: the player's score probability against `opponent`. */
export function expectedScore(rating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400));
}

/** K by phase and height: placement is wide, the top of the ladder is narrow. */
export function kFactorFor(rating: number, gamesPlayed: number): number {
  if (gamesPlayed < CALIBRATION_GAMES) return 48;
  if (rating < 1800) return 28;
  if (rating < 2300) return 20;
  return 12;
}

/** Every even 200-point milestone that carries a floor. */
export const MILESTONES: readonly number[] = [
  600, 800, 1000, 1200, 1400, 1600, 1800, 2000,
];

/**
 * The highest floor the player has earned, given the rating they reached.
 *
 * A milestone locks its floor for good, so callers keep the *highest* value
 * they have ever seen rather than recomputing it from the current rating — a
 * player who touched 1200 and fell back to 1050 keeps the 1100 floor.
 */
export function earnedFloor(rating: number, currentFloor = 0): number {
  let floor = currentFloor;
  for (const milestone of MILESTONES) {
    if (rating >= milestone) floor = Math.max(floor, milestone - 100);
  }
  return floor;
}

export interface RatingInput {
  /** Rating before this game. */
  rating: number;
  peak?: number;
  floor?: number;
  /** Current run of wins, before this game. */
  streak: number;
  /** Rated games this player has finished, before this game. */
  gamesPlayed: number;
  opponentRating: number;
  /** 1 win, 0.5 draw, 0 loss. */
  score: 0 | 0.5 | 1;
  /** Bot games count at half weight and never pay for an easy win. */
  opponentIsBot?: boolean;
  /** `false` leaves the record untouched (unrated game). */
  rated?: boolean;
}

export interface RatingOutcome {
  rating: number;
  delta: number;
  peak: number;
  floor: number;
  streak: number;
  gamesPlayed: number;
  /** Games left in placement after this one. */
  calibrationLeft: number;
  /** True while the badge should still be printed. */
  calibrating: boolean;
  /** Set when a milestone was reached by this game. */
  milestoneReached: number | null;
  /** Set when a drop was stopped by the locked floor. */
  heldByFloor: boolean;
  /** The K actually used, after placement and bot scaling. */
  k: number;
}

/** Beating a bot this far below you teaches the rating nothing. */
export const BOT_WIN_FLOOR = 250;
/** Three wins in a row against equals earns a quarter more. */
export const STREAK_BONUS_FROM = 3;
export const STREAK_MULTIPLIER = 1.25;

export function applyResult(input: RatingInput): RatingOutcome {
  const {
    rating,
    peak = rating,
    floor = 0,
    streak,
    gamesPlayed,
    opponentRating,
    score,
    opponentIsBot = false,
    rated = true,
  } = input;

  const baseK = kFactorFor(rating, gamesPlayed);
  const k = opponentIsBot ? baseK / 2 : baseK;

  const nextStreak = score === 1 ? streak + 1 : 0;

  let delta = 0;
  if (rated) {
    const expected = expectedScore(rating, opponentRating);
    delta = k * (score - expected);

    /* A quarter more for a run of wins, but only when the win was earned
       against someone at least as strong. */
    if (
      score === 1 &&
      nextStreak >= STREAK_BONUS_FROM &&
      opponentRating >= rating &&
      delta > 0
    ) {
      delta *= STREAK_MULTIPLIER;
    }

    /* Beating a much weaker bot is practice, not proof. */
    if (opponentIsBot && score === 1 && opponentRating < rating - BOT_WIN_FLOOR) {
      delta = 0;
    }
  }

  const before = rating;
  const earned = earnedFloor(Math.max(before, before + delta), floor);
  let next = Math.round(before + delta);
  next = Math.min(RATING_MAX, Math.max(RATING_MIN, next));

  /* The floor is a promise: once it is earned, a rating cannot be spent below
     it, whatever the maths said. */
  const heldByFloor = next < earned;
  if (heldByFloor) next = earned;

  /* A milestone counts when the rating *reaches* it, including through the
     clamp, so the floor it locks is never missed. */
  let milestoneReached: number | null = null;
  for (const milestone of MILESTONES) {
    if (next >= milestone && before < milestone) milestoneReached = milestone;
  }

  const nextFloor = earnedFloor(next, Math.max(floor, earned));

  return {
    rating: next,
    delta: next - before,
    peak: Math.max(peak, next),
    floor: nextFloor,
    streak: nextStreak,
    gamesPlayed: gamesPlayed + 1,
    calibrationLeft: Math.max(0, CALIBRATION_GAMES - (gamesPlayed + 1)),
    calibrating: gamesPlayed + 1 < CALIBRATION_GAMES,
    milestoneReached,
    heldByFloor,
    k,
  };
}

/** The one-line explanation shown under the rating card. */
export const RATING_CALIBRATION_HINT =
  'A “?” marks a rating still in placement: ten games settle it. Reaching a 200-point milestone locks a floor 100 below it, and beating a much weaker bot does not count.';

/** `1200?` while placing, `1200` when the rating is real. */
export function ratingLabel(rating: number, calibrating: boolean): string {
  return calibrating ? `${rating}?` : String(rating);
}

/** The seed a fresh player should start from, by id. */
export function seedById(id: PlacementSeed['id']): PlacementSeed {
  return PLACEMENT_SEEDS.find((seed) => seed.id === id) ?? PLACEMENT_SEEDS[1];
}
