/**
 * Performance-norm titles.
 *
 * A title is earned twice over: by reaching a rating, and — for the master
 * titles — by *playing* at that level across a run of consecutive rated games.
 * The rating threshold proves where you got to; the norm proves you belonged
 * there for more than one afternoon.
 *
 * Two ratings are in play, and they mean different things:
 *   - **Elo** is the player's ladder rating (`user_ratings`), and the threshold
 *     is checked against its *peak*, because a title is never lost.
 *   - **Performance** is this game's result seen through the opponent's
 *     strength: beating a 2100 scores 2500, drawing one scores 2100, losing to
 *     one scores 1700. That is the number Game Analysis reports, and the norm
 *     average is the mean of the most recent run of them.
 *
 * Nothing here touches storage: `titleStore.ts` loads the numbers and hands
 * them in.
 */

export type TitleId = 'CLB' | 'CM' | 'NM' | 'FM' | 'IM' | 'GM';

export type TitleTone = 'yellow' | 'red';

export interface TitleSpec {
  id: TitleId;
  name: string;
  /** Peak Elo that must have been reached at some point. */
  rating: number;
  /** Performance norm, when the title requires one. */
  norm?: { average: number; games: number };
  tone: TitleTone;
}

export const TITLES: readonly TitleSpec[] = [
  { id: 'CLB', name: 'Club Player', rating: 1700, tone: 'yellow' },
  { id: 'CM', name: 'Candidate Master', rating: 2200, tone: 'red' },
  {
    id: 'NM',
    name: 'National Master',
    rating: 2200,
    norm: { average: 2250, games: 5 },
    tone: 'red',
  },
  {
    id: 'FM',
    name: 'FIDE Master',
    rating: 2300,
    norm: { average: 2350, games: 5 },
    tone: 'red',
  },
  {
    id: 'IM',
    name: 'International Master',
    rating: 2400,
    norm: { average: 2450, games: 5 },
    tone: 'red',
  },
  {
    id: 'GM',
    name: 'Grandmaster',
    rating: 2500,
    norm: { average: 2550, games: 10 },
    tone: 'red',
  },
];

/** Weakest first: the order titles are shown and compared in. */
export const TITLE_ORDER: readonly TitleId[] = TITLES.map((title) => title.id);

/** How many recent performances a norm window has to hold. */
export const NORM_WINDOW = 10;

export function titleSpec(id: TitleId): TitleSpec {
  return TITLES.find((title) => title.id === id) ?? TITLES[0];
}

/** The title a rating alone would suggest, for bots that cannot hold a norm. */
export function titleForRating(rating: number): TitleId | null {
  if (rating >= 2500) return 'GM';
  if (rating >= 2400) return 'IM';
  if (rating >= 2300) return 'FM';
  if (rating >= 2200) return 'CM';
  if (rating >= 1700) return 'CLB';
  return null;
}

/**
 * One game's performance rating.
 *
 * The standard Elo swing of ±400: a win is worth a 400-point stronger opponent,
 * a draw is worth exactly the opponent, a loss is worth 400 less. Capped at the
 * ends of the ladder so a game against a 100 cannot produce a negative number.
 */
export function performanceRating(opponentRating: number, score: 0 | 0.5 | 1): number {
  const raw = opponentRating + 400 * (2 * score - 1);
  return Math.round(Math.min(3000, Math.max(100, raw)));
}

/** The mean of the most recent `games` performances, or null if short. */
export function normAverage(window: readonly number[], games: number): number | null {
  if (games <= 0 || window.length < games) return null;
  const recent = window.slice(0, games);
  const total = recent.reduce((sum, value) => sum + value, 0);
  return Math.round(total / games);
}

export interface TitleProgress {
  spec: TitleSpec;
  /** False until the peak rating requirement is met. */
  ratingMet: boolean;
  /** Null while the window is too short for the norm. */
  average: number | null;
  /** Games counted toward the norm (never more than the window). */
  games: number;
  /** True when both halves of the requirement are met. */
  met: boolean;
}

export function progressFor(spec: TitleSpec, peak: number, window: readonly number[]): TitleProgress {
  const ratingMet = peak >= spec.rating;
  if (!spec.norm) {
    return { spec, ratingMet, average: null, games: 0, met: ratingMet };
  }
  const games = Math.min(window.length, spec.norm.games);
  const average = normAverage(window, spec.norm.games);
  const met = ratingMet && average !== null && average >= spec.norm.average;
  return { spec, ratingMet, average, games, met };
}

/** Every title the player qualifies for right now. */
export function earnedTitles(peak: number, window: readonly number[]): TitleId[] {
  return TITLES.filter((spec) => progressFor(spec, peak, window).met).map((spec) => spec.id);
}

/** Titles qualified for now that were not already unlocked. */
export function newTitles(
  unlocked: readonly TitleId[],
  peak: number,
  window: readonly number[],
): TitleId[] {
  const have = new Set(unlocked);
  return earnedTitles(peak, window).filter((id) => !have.has(id));
}

/** The strongest title in a set, for the nameplate. */
export function highestTitle(unlocked: readonly TitleId[]): TitleId | null {
  let best: TitleId | null = null;
  for (const id of TITLE_ORDER) {
    if (unlocked.includes(id)) best = id;
  }
  return best;
}

/** The next title worth working toward, skipping ones already held. */
export function nextTitle(unlocked: readonly TitleId[]): TitleSpec | null {
  return TITLES.find((title) => !unlocked.includes(title.id)) ?? null;
}

/**
 * The one-line progress shown in the profile.
 *
 * Names the requirement still outstanding, so a rating-only title reads
 * differently from one waiting on a norm.
 */
export function progressSummary(
  spec: TitleSpec,
  peak: number,
  window: readonly number[],
): string {
  const progress = progressFor(spec, peak, window);
  if (progress.met) return `${spec.id} earned`;
  if (!spec.norm) return `${spec.id}: ${peak} / ${spec.rating} peak Elo`;
  if (!progress.ratingMet) {
    return `${spec.id}: ${peak} / ${spec.rating} peak Elo`;
  }
  const played = progress.games;
  /* The running average of the games in hand, not the qualifying average:
     a player four games into a ten-game norm still wants to see the number. */
  const counted = window.slice(0, spec.norm.games);
  if (counted.length === 0) {
    return `${spec.id} norm progress: 0/${spec.norm.games} games, average to come`;
  }
  const average = Math.round(counted.reduce((sum, value) => sum + value, 0) / counted.length);
  return `${spec.id} norm progress: ${played}/${spec.norm.games} games at ${average} avg performance (needs ${spec.norm.average})`;
}
