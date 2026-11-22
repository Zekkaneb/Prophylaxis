import { db, type UserRatingRow } from '../db.ts';
import { recordSyncedChange } from '../sync/outbox.ts';
import {
  applyResult,
  RATING_CATEGORIES,
  RATING_MIN,
  type RatingCategory,
  type RatingOutcome,
} from './customRating.ts';

/**
 * The four ratings, stored in Dexie and pushed through the sync outbox like any
 * other row.
 *
 * Reads are cheap and local: every screen that shows a rating reads the rows it
 * needs, and a single `RATING_EVENT` tells mounted screens to re-read after a
 * game. Nothing here keeps a second copy of the numbers, so a sync pull and a
 * finished game can never disagree about what is stored.
 */

export const RATING_EVENT = 'openinglab:ratings-changed';

/** What a player who has not chosen a seed yet starts from. */
export const DEFAULT_SEED_RATING = 800;

export type RatingMap = Partial<Record<RatingCategory, UserRatingRow>>;

function notify(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(RATING_EVENT));
}

export async function loadRatings(): Promise<RatingMap> {
  const rows = await db.user_ratings.toArray();
  const map: RatingMap = {};
  for (const row of rows) {
    if (RATING_CATEGORIES.includes(row.category)) map[row.category] = row;
  }
  return map;
}

/** True once the player has picked a placement seed. */
export function isSeeded(ratings: RatingMap): boolean {
  return RATING_CATEGORIES.some((category) => Boolean(ratings[category]));
}

/**
 * Starts every category at the chosen seed.
 *
 * All four, not just the one they happen to play first: a rating table with
 * three empty rows would print blanks in the history and on the lobby, and the
 * placement choice is exactly as good a guess for the category they have not
 * tried yet.
 */
export async function seedRatings(rating: number): Promise<RatingMap> {
  const value = Math.round(Math.max(RATING_MIN, rating));
  const now = Date.now();
  for (const category of RATING_CATEGORIES) {
    const row: UserRatingRow = {
      category,
      rating: value,
      peak: value,
      floor: 0,
      streak: 0,
      games_played: 0,
      updated_at: now,
    };
    await db.user_ratings.put(row);
    await recordSyncedChange('user_ratings', category, false);
  }
  notify();
  return loadRatings();
}

async function writeRow(row: UserRatingRow): Promise<void> {
  await db.user_ratings.put(row);
  await recordSyncedChange('user_ratings', row.category, false);
}

export interface RatedGameInput {
  category: RatingCategory;
  opponentRating: number;
  /** 1 win, 0.5 draw, 0 loss, from the player's side. */
  score: 0 | 0.5 | 1;
  opponentIsBot?: boolean;
  /** False for games that must not move the rating (hints, takebacks, practice). */
  rated?: boolean;
}

export interface RatedGameResult {
  before: UserRatingRow;
  after: UserRatingRow;
  outcome: RatingOutcome;
}

/**
 * Applies one finished game to its category.
 *
 * Serialised per category through a promise chain: two games ending at once
 * (a resign and a flag) must not both read the same "before" row and write
 * twice from it.
 */
const queues = new Map<RatingCategory, Promise<unknown>>();

export function applyRatedGame(input: RatedGameInput): Promise<RatedGameResult> {
  const previous = queues.get(input.category) ?? Promise.resolve();
  const run = previous.then(
    () => applyNow(input),
    () => applyNow(input),
  );
  queues.set(
    input.category,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

async function applyNow(input: RatedGameInput): Promise<RatedGameResult> {
  const existing = await db.user_ratings.get(input.category);
  const before: UserRatingRow =
    existing ??
    {
      category: input.category,
      rating: DEFAULT_SEED_RATING,
      peak: DEFAULT_SEED_RATING,
      floor: 0,
      streak: 0,
      games_played: 0,
      updated_at: Date.now(),
    };

  const outcome = applyResult({
    rating: before.rating,
    peak: before.peak,
    floor: before.floor,
    streak: before.streak,
    gamesPlayed: before.games_played,
    opponentRating: input.opponentRating,
    score: input.score,
    opponentIsBot: input.opponentIsBot ?? false,
    rated: input.rated ?? true,
  });

  const after: UserRatingRow = {
    category: input.category,
    rating: outcome.rating,
    peak: outcome.peak,
    floor: outcome.floor,
    streak: outcome.streak,
    games_played: outcome.gamesPlayed,
    updated_at: Date.now(),
  };

  await writeRow(after);
  notify();
  return { before, after, outcome };
}
