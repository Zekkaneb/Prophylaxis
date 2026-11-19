/**
 * The 13 active move classifications, in one place.
 *
 * Everything that renders or reasons about a move reads from here: the review
 * service, the coach card, the board badge and the move list. Symbols are plain
 * text/Unicode (never emoji) so they stay sharp at any board scale and can be
 * set in a monospace face.
 *
 * `badgeClass` is the soft-contrast Tailwind recipe for the badge. This project
 * styles with its own CSS tokens (`.gr-tone--*`), so the same values are
 * mirrored there; the strings are kept here as the single source of truth for
 * colour and contrast.
 */

export type MoveClassification =
  | 'brilliant'
  | 'clutch'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'forced'
  | 'book'
  | 'inaccuracy'
  | 'mistake'
  | 'miss'
  | 'blunder'
  | 'throw';

export interface MoveClassificationMeta {
  key: MoveClassification;
  /** Human label for tooltips and the coach card. */
  label: string;
  /** Badge glyph: `!!`, `○`, `⦿`, `??`, … */
  symbol: string;
  /** CSS tone suffix: `brilliant` → `.gr-tone--brilliant`. */
  tone: string;
  /** Soft-contrast Tailwind badge recipe (design source of truth). */
  badgeClass: string;
  /** One-sentence coach line. */
  headline: string;
}

export const MOVE_CLASSIFICATION_META: Record<MoveClassification, MoveClassificationMeta> = {
  brilliant: {
    key: 'brilliant',
    label: 'Brilliant',
    symbol: '!!',
    tone: 'brilliant',
    badgeClass: 'text-cyan-400 bg-cyan-500/15 border-cyan-500/30',
    headline: 'A sound sacrifice the engine also wants — material went, the position did not.',
  },
  clutch: {
    key: 'clutch',
    label: 'Clutch',
    symbol: '○',
    tone: 'clutch',
    badgeClass: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30',
    headline: 'Dead lost, and the only move that saves the game.',
  },
  great: {
    key: 'great',
    label: 'Great',
    symbol: '!',
    tone: 'great',
    badgeClass: 'text-blue-400 bg-blue-500/15 border-blue-500/30',
    headline: 'The only move that holds the position together.',
  },
  best: {
    key: 'best',
    label: 'Best',
    symbol: '*',
    tone: 'best',
    badgeClass: 'text-green-400 bg-green-500/15 border-green-500/30',
    headline: 'Exactly what the engine wanted.',
  },
  excellent: {
    key: 'excellent',
    label: 'Excellent',
    symbol: '⦿',
    tone: 'excellent',
    badgeClass: 'text-lime-400 bg-lime-500/15 border-lime-500/30',
    headline: 'Practically as good as the top move.',
  },
  good: {
    key: 'good',
    label: 'Good',
    symbol: '✓',
    tone: 'good',
    badgeClass: 'text-teal-300 bg-teal-500/10 border-teal-500/25',
    headline: 'A solid move, if not the most precise.',
  },
  forced: {
    key: 'forced',
    label: 'Forced',
    symbol: '⇒',
    tone: 'forced',
    badgeClass: 'text-zinc-400 bg-zinc-500/15 border-zinc-500/30',
    headline: 'The only legal move — no decision to judge.',
  },
  book: {
    key: 'book',
    label: 'Book',
    symbol: '▣',
    tone: 'book',
    badgeClass: 'text-amber-200/80 bg-amber-500/10 border-amber-500/25',
    headline: 'Known theory; no engine time was spent here.',
  },
  inaccuracy: {
    key: 'inaccuracy',
    label: 'Inaccuracy',
    symbol: '?!',
    tone: 'inaccuracy',
    badgeClass: 'text-yellow-400 bg-yellow-500/15 border-yellow-500/30',
    headline: 'A better move was available here.',
  },
  mistake: {
    key: 'mistake',
    label: 'Mistake',
    symbol: '?',
    tone: 'mistake',
    badgeClass: 'text-orange-400 bg-orange-500/15 border-orange-500/30',
    headline: 'This hands the opponent a real advantage.',
  },
  miss: {
    key: 'miss',
    label: 'Miss',
    symbol: '✕',
    tone: 'miss',
    badgeClass: 'text-rose-400 bg-rose-500/15 border-rose-500/30',
    headline: 'A chance to punish the opponent was missed.',
  },
  blunder: {
    key: 'blunder',
    label: 'Blunder',
    symbol: '??',
    tone: 'blunder',
    badgeClass: 'text-red-500 bg-red-500/20 border-red-500/35',
    headline: 'This changes the result of the game.',
  },
  throw: {
    key: 'throw',
    label: 'Throw',
    symbol: '???',
    tone: 'throw',
    badgeClass: 'text-red-600 bg-red-600/20 border-red-600/40',
    headline: 'A winning game turned into a loss in one move.',
  },
};

/** Every classification, ordered best → worst (legends, summaries). */
export const MOVE_CLASSIFICATION_ORDER: MoveClassification[] = [
  'brilliant',
  'clutch',
  'great',
  'best',
  'excellent',
  'good',
  'forced',
  'book',
  'inaccuracy',
  'mistake',
  'miss',
  'blunder',
  'throw',
];

/** Rows of the review summary card: every classification, always listed. */
export const SUMMARY_CLASSIFICATIONS: MoveClassification[] = [
  'clutch',
  'brilliant',
  'great',
  'best',
  'excellent',
  'good',
  'forced',
  'book',
  'inaccuracy',
  'mistake',
  'miss',
  'blunder',
  'throw',
];

const CLASSIFICATION_KEYS = new Set<string>(MOVE_CLASSIFICATION_ORDER);

export function isMoveClassification(value: string): value is MoveClassification {
  return CLASSIFICATION_KEYS.has(value);
}

/** Never throws: an unknown/stale stored value degrades to a neutral badge. */
export function classificationMeta(value: MoveClassification | string): MoveClassificationMeta {
  if (isMoveClassification(value)) return MOVE_CLASSIFICATION_META[value];
  return {
    key: 'good',
    label: String(value),
    symbol: '•',
    tone: 'good',
    badgeClass: 'text-teal-300 bg-teal-500/10 border-teal-500/25',
    headline: '',
  };
}

/** Moves the "key moments" filter treats as worth a look. */
export const KEY_MOMENT_CLASSIFICATIONS: MoveClassification[] = [
  'brilliant',
  'clutch',
  'great',
  'inaccuracy',
  'mistake',
  'miss',
  'blunder',
  'throw',
];

/** Moves worth retrying from the position before them. */
export const RETRY_CLASSIFICATIONS: MoveClassification[] = [
  'inaccuracy',
  'mistake',
  'miss',
  'blunder',
  'throw',
];

/** Moves that draw the engine's better move as an arrow. */
export const BAD_MOVE_CLASSIFICATIONS: MoveClassification[] = [
  'inaccuracy',
  'mistake',
  'miss',
  'blunder',
  'throw',
];

export function isKeyMoment(value: MoveClassification): boolean {
  return KEY_MOMENT_CLASSIFICATIONS.includes(value);
}

export function canRetry(value: MoveClassification): boolean {
  return RETRY_CLASSIFICATIONS.includes(value);
}

export function isBadMove(value: MoveClassification): boolean {
  return BAD_MOVE_CLASSIFICATIONS.includes(value);
}
