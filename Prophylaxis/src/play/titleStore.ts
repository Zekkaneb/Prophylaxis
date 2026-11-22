import { useEffect, useState } from 'react';
import { db, type UserRatingRow, type UserTitleRow } from '../db.ts';
import { recordSyncedChange } from '../sync/outbox.ts';
import { RATING_CATEGORIES, type RatingCategory } from './customRating.ts';
import {
  earnedTitles,
  highestTitle,
  newTitles,
  progressFor,
  progressSummary,
  nextTitle,
  titleSpec,
  type TitleId,
} from './titles.ts';

/**
 * Earned titles and the norm window that unlocks them.
 *
 * Titles live in one row (`user_titles`) because they belong to the person, not
 * to a time control; the norm window itself stays in `user_ratings`, where each
 * category keeps the performance ratings of its own recent games. A title is
 * checked after every rated game and, once earned, is never taken away.
 */

export const TITLES_EVENT = 'openinglab:titles-changed';
/** Fired with the detail of the titles just earned, for the congratulations card. */
export const TITLE_UNLOCK_EVENT = 'openinglab:title-unlocked';

const ROW_ID = 'titles';

export interface TitleState {
  unlocked: TitleId[];
  /** Chosen title, if the player picked one from what they have earned. */
  selected: TitleId | null;
  /** What the nameplate prints: the choice, else the strongest held. */
  worn: TitleId | null;
}

export const EMPTY_TITLES: TitleState = { unlocked: [], selected: null, worn: null };

function notify(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(TITLES_EVENT));
}

function emptyRow(): UserTitleRow {
  return { id: ROW_ID, unlocked: [], selected: null, updated_at: Date.now() };
}

export async function loadTitleRow(): Promise<UserTitleRow> {
  const row = await db.user_titles.get(ROW_ID);
  return row ?? emptyRow();
}

export async function loadTitleState(): Promise<TitleState> {
  const row = await loadTitleRow();
  const unlocked = Array.isArray(row.unlocked) ? row.unlocked : [];
  return {
    unlocked,
    selected: row.selected ?? null,
    worn: row.selected && unlocked.includes(row.selected) ? row.selected : highestTitle(unlocked),
  };
}

/** The window and peak the title checks run against. */
export interface NormContext {
  peak: number;
  window: number[];
  /** The category the window came from, for the progress line. */
  category: RatingCategory | null;
}

function newestRow(rows: UserRatingRow[]): UserRatingRow | null {
  let best: UserRatingRow | null = null;
  for (const row of rows) {
    if (!best || (row.updated_at ?? 0) > (best.updated_at ?? 0)) best = row;
  }
  return best;
}

/**
 * Peak and norm window for the title check.
 *
 * The peak is the highest any category has ever reached — a 2400 rapid player
 * has earned the rating half of the IM title however their blitz is going — and
 * the window is the most recently played category, because a norm is about the
 * run of games in front of you.
 */
export async function normContext(): Promise<NormContext> {
  const rows = await db.user_ratings.toArray();
  const usable = rows.filter((row) => RATING_CATEGORIES.includes(row.category));
  const peak = usable.reduce((best, row) => Math.max(best, row.peak ?? row.rating ?? 0), 0);
  const latest = newestRow(usable);
  const window = Array.isArray(latest?.norm_games) ? [...(latest?.norm_games ?? [])] : [];
  return { peak, window, category: latest?.category ?? null };
}

export interface TitleUnlockDetail {
  titles: TitleId[];
  peak: number;
  /** The average the norm ran at, when a norm title was part of the unlock. */
  average: number | null;
  window: number[];
}

function announce(detail: TitleUnlockDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<TitleUnlockDetail>(TITLE_UNLOCK_EVENT, { detail }));
  notify();
}

/**
 * Checks the ladder and records anything newly earned.
 *
 * Called after every rated game. Returns the titles unlocked by *this* check;
 * the caller uses them for the congratulations card. Passing `announce: false`
 * is for a background refresh that must not pop a modal for old progress.
 */
export async function evaluateTitles(
  options: { announce?: boolean } = {},
): Promise<TitleId[]> {
  const context = await normContext();
  const row = await loadTitleRow();
  const fresh = newTitles(row.unlocked, context.peak, context.window);
  if (fresh.length === 0) return [];

  const unlocked = [...row.unlocked, ...fresh];
  const next: UserTitleRow = { ...row, unlocked, updated_at: Date.now() };
  await db.user_titles.put(next);
  await recordSyncedChange('user_titles', ROW_ID, false);

  if (options.announce !== false) {
    const normed = fresh.map(titleSpec).find((spec) => spec.norm);
    announce({
      titles: fresh,
      peak: context.peak,
      average: normed ? (progressFor(normed, context.peak, context.window).average ?? null) : null,
      window: context.window,
    });
  } else {
    notify();
  }
  return fresh;
}

/** Picks the title to wear; `null` means "the strongest one I hold". */
export async function setSelectedTitle(id: TitleId | null): Promise<void> {
  const row = await loadTitleRow();
  const unlocked = Array.isArray(row.unlocked) ? row.unlocked : [];
  const selected = id && unlocked.includes(id) ? id : null;
  await db.user_titles.put({ ...row, selected, updated_at: Date.now() });
  await recordSyncedChange('user_titles', ROW_ID, false);
  notify();
}

/* ------------------------------- react bindings ---------------------------- */

export function useTitleState(): TitleState {
  const [state, setState] = useState<TitleState>(EMPTY_TITLES);

  useEffect(() => {
    let cancelled = false;
    const read = () => {
      void loadTitleState().then((next) => {
        if (!cancelled) setState(next);
      });
    };
    read();
    window.addEventListener(TITLES_EVENT, read);
    return () => {
      cancelled = true;
      window.removeEventListener(TITLES_EVENT, read);
    };
  }, []);

  return state;
}

/** The one-line norm progress shown in the profile. */
export function useTitleProgress(): { summary: string | null; next: string | null } {
  const [value, setValue] = useState<{ summary: string | null; next: string | null }>({
    summary: null,
    next: null,
  });

  useEffect(() => {
    let cancelled = false;
    const read = () => {
      void (async () => {
        const context = await normContext();
        const state = await loadTitleState();
        const target = nextTitle(state.unlocked);
        if (cancelled) return;
        setValue({
          summary: target ? progressSummary(target, context.peak, context.window) : null,
          next: target ? target.id : null,
        });
      })();
    };
    read();
    window.addEventListener(TITLES_EVENT, read);
    window.addEventListener('openinglab:ratings-changed', read);
    return () => {
      cancelled = true;
      window.removeEventListener(TITLES_EVENT, read);
      window.removeEventListener('openinglab:ratings-changed', read);
    };
  }, []);

  return value;
}

/** Titles a set of numbers would earn, for previews and tests. */
export function previewTitles(peak: number, window: number[]): TitleId[] {
  return earnedTitles(peak, window);
}
