/**
 * Player-vs-player time controls and flag rules.
 *
 * The bot games already share one clock (`ChessClock`) and one set of presets;
 * PvP needs more: three bonus mechanics and the two PvP modes. This module owns
 * the lobby's vocabulary — presets, the custom control's validation, the bonus
 * type catalogue — plus the flag rule, so the UI never invents a label and the
 * clock never invents an outcome.
 */

import { Chess } from 'chess.js';
import type { BonusType } from './clock.ts';
import type { PlayColor, PlayResult } from './types.ts';

export type PvpCategory = 'bullet' | 'blitz' | 'rapid' | 'classical' | 'unlimited';

export interface PvpTimeControl {
  initialSeconds: number;
  bonusSeconds: number;
  bonusType: BonusType;
  untimed: boolean;
}

export interface PvpPreset extends PvpTimeControl {
  id: string;
  category: PvpCategory;
}

export const PVP_CATEGORY_LABELS: Record<PvpCategory, string> = {
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
  classical: 'Classical / Unlimited',
  unlimited: 'Classical / Unlimited',
};

export const PVP_CATEGORY_ORDER: readonly PvpCategory[] = [
  'bullet',
  'blitz',
  'rapid',
  'classical',
];

/**
 * The lobby's quick picks.
 *
 * Every preset here is Fischer increment, which is what the labels mean when
 * they are written `5+3`; delay clocks are chosen in the custom panel because a
 * preset cannot say which of the three bonus mechanics it means.
 */
export const PVP_PRESETS: readonly PvpPreset[] = [
  { id: '1+0', category: 'bullet', initialSeconds: 60, bonusSeconds: 0, bonusType: 'fischer', untimed: false },
  { id: '1+1', category: 'bullet', initialSeconds: 60, bonusSeconds: 1, bonusType: 'fischer', untimed: false },
  { id: '2+1', category: 'bullet', initialSeconds: 120, bonusSeconds: 1, bonusType: 'fischer', untimed: false },
  { id: '3+0', category: 'blitz', initialSeconds: 180, bonusSeconds: 0, bonusType: 'fischer', untimed: false },
  { id: '3+2', category: 'blitz', initialSeconds: 180, bonusSeconds: 2, bonusType: 'fischer', untimed: false },
  { id: '5+0', category: 'blitz', initialSeconds: 300, bonusSeconds: 0, bonusType: 'fischer', untimed: false },
  { id: '5+3', category: 'blitz', initialSeconds: 300, bonusSeconds: 3, bonusType: 'fischer', untimed: false },
  { id: '10+0', category: 'rapid', initialSeconds: 600, bonusSeconds: 0, bonusType: 'fischer', untimed: false },
  { id: '10+5', category: 'rapid', initialSeconds: 600, bonusSeconds: 5, bonusType: 'fischer', untimed: false },
  { id: '15+10', category: 'rapid', initialSeconds: 900, bonusSeconds: 10, bonusType: 'fischer', untimed: false },
  { id: '30+0', category: 'classical', initialSeconds: 1800, bonusSeconds: 0, bonusType: 'fischer', untimed: false },
  { id: 'unlimited', category: 'unlimited', initialSeconds: 0, bonusSeconds: 0, bonusType: 'none', untimed: true },
];

export const BONUS_TYPES: ReadonlyArray<{
  id: BonusType;
  label: string;
  hint: string;
}> = [
  { id: 'none', label: 'None', hint: 'The clock simply runs.' },
  {
    id: 'fischer',
    label: 'Increment (Fischer)',
    hint: 'The bonus is added the moment a move is made.',
  },
  {
    id: 'simple',
    label: 'Simple delay',
    hint: 'Each turn starts with free seconds; only then does the clock move.',
  },
  {
    id: 'bronstein',
    label: 'Bronstein delay',
    hint: 'The clock runs, and up to the bonus is handed back on the move.',
  },
];

export const PVP_LIMITS = {
  minutes: { min: 1, max: 180 },
  bonus: { min: 0, max: 60 },
} as const;

/** "5+3" for a bonus clock, "5|3" for a delay clock, "Unlimited" for none. */
export function pvpTimeControlLabel(control: PvpTimeControl): string {
  if (control.untimed) return 'Unlimited';
  const minutes = Math.round((control.initialSeconds / 60) * 10) / 10;
  const separator =
    control.bonusType === 'simple' || control.bonusType === 'bronstein' ? '|' : '+';
  return `${minutes}${separator}${control.bonusSeconds}`;
}

export function bonusTypeLabel(type: BonusType): string {
  return BONUS_TYPES.find((entry) => entry.id === type)?.label ?? 'Increment';
}

export interface CustomPvpResult {
  ok: boolean;
  error?: string;
  control: PvpTimeControl;
}

/**
 * The custom panel's one validation point: whole minutes in range, whole bonus
 * seconds in range, and a bonus type that actually exists.
 */
export function validateCustomPvp(
  minutesInput: string,
  bonusInput: string,
  bonusType: BonusType,
): CustomPvpResult {
  const minutes = Number(minutesInput);
  const bonus = Number(bonusInput);
  const fallback: PvpTimeControl = {
    initialSeconds: 0,
    bonusSeconds: 0,
    bonusType,
    untimed: false,
  };

  if (!Number.isFinite(minutes) || !Number.isInteger(minutes)) {
    return { ok: false, error: 'Enter whole minutes.', control: fallback };
  }
  if (minutes < PVP_LIMITS.minutes.min || minutes > PVP_LIMITS.minutes.max) {
    return {
      ok: false,
      error: `Base time must be ${PVP_LIMITS.minutes.min}–${PVP_LIMITS.minutes.max} minutes.`,
      control: fallback,
    };
  }
  if (!Number.isFinite(bonus) || !Number.isInteger(bonus)) {
    return { ok: false, error: 'Enter whole bonus seconds.', control: fallback };
  }
  if (bonus < PVP_LIMITS.bonus.min || bonus > PVP_LIMITS.bonus.max) {
    return {
      ok: false,
      error: `Bonus must be ${PVP_LIMITS.bonus.min}–${PVP_LIMITS.bonus.max} seconds.`,
      control: fallback,
    };
  }

  return {
    ok: true,
    control: {
      initialSeconds: minutes * 60,
      bonusSeconds: bonus,
      bonusType,
      untimed: false,
    },
  };
}

/* ---------------------------------- flags --------------------------------- */

/**
 * True when `color` has no possible mate left.
 *
 * Only the bare cases are covered — a lone king, or a king with one minor
 * piece. That is what "insufficient material" means for a flag: a player who
 * cannot force mate on an empty board cannot win on time either, so the game is
 * drawn instead of lost.
 */
export function lacksMatingMaterial(fen: string, color: PlayColor): boolean {
  let board: Chess;
  try {
    board = new Chess(fen);
  } catch {
    return false;
  }

  const pieces = board.board().flat().filter((piece) => piece && piece.color === color);
  if (pieces.length === 0) return true;
  if (pieces.length === 1) return true; // lone king
  if (pieces.length === 2) {
    const minor = pieces.find((piece) => piece && piece.type !== 'k');
    return minor?.type === 'n' || minor?.type === 'b';
  }
  return false;
}

export interface FlagOutcome {
  result: PlayResult;
  reason: 'timeout' | 'insufficient-material';
}

/**
 * What a flag decides.
 *
 * The side that ran out loses, unless its opponent could no longer mate — then
 * the game is drawn, which is the same rule the app already applies to a bot
 * that flags with nothing left.
 */
export function flagOutcome(flagged: PlayColor, fen: string): FlagOutcome {
  const opponent: PlayColor = flagged === 'w' ? 'b' : 'w';
  if (lacksMatingMaterial(fen, opponent)) {
    return { result: '1/2-1/2', reason: 'insufficient-material' };
  }
  return { result: flagged === 'w' ? '0-1' : '1-0', reason: 'timeout' };
}
