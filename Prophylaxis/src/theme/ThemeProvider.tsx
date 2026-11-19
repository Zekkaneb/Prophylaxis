import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getVolume, isMuted, setMuted, setVolume } from '../services/soundService';
import type { PieceSetId } from './pieceSets';

export type BoardPaletteId =
  | 'walnut'
  | 'green'
  | 'midnight'
  | 'marble'
  | 'sage'
  | 'ice'
  | 'charcoal'
  | 'brown';
/*
 * Board size is one global multiplier, not a per-layout width.
 *
 * The board always resolves to `BOARD_BASE_PX * boardScale` in layout, so it is
 * identical on every tab: no column, panel or paragraph can stretch it. Sizing
 * it in layout pixels (rather than scaling a fixed box with a transform) keeps
 * the pointer sensors aligned with the pieces while dragging.
 */
export const BOARD_BASE_PX = 640;
export const BOARD_SCALE_MIN = 0.5;
/* 100% is exactly the fit (the largest square the window holds with its bars)
   and the default. Below that the board shrinks inside its stage; above it the
   board grows past the stage and pans, up to a deliberate 200%. */
export const BOARD_SCALE_MAX = 2;
export const DEFAULT_BOARD_SCALE = 1;

/** Keeps a slider or preset value inside the range, snapped to 1% steps. */
export function clampBoardScale(scale: number): number {
  if (!Number.isFinite(scale)) return DEFAULT_BOARD_SCALE;
  return Math.min(
    BOARD_SCALE_MAX,
    Math.max(BOARD_SCALE_MIN, Math.round(scale * 100) / 100),
  );
}

/* -------------------------------------------------------------------------- */
/*                                  Themes                                    */
/* -------------------------------------------------------------------------- */

/** Paper for daylight, slate for night, or the system's own choice. */
export type ColorMode = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';
export type AccentId =
  | 'gold'
  | 'sage'
  | 'azure'
  | 'rose'
  | 'emerald'
  | 'sapphire'
  | 'amber'
  | 'violet'
  | 'slate';

export interface AccentOption {
  label: string;
  hint: string;
  /** Swatch on the night ground. */
  dark: string;
  /** Swatch on the paper ground — deeper so it stays visible. */
  light: string;
}

export const ACCENTS: Record<AccentId, AccentOption> = {
  gold: { label: 'Antique gold', hint: 'Warm metal', dark: '#c8a56a', light: '#9c7a37' },
  sage: { label: 'Sage', hint: 'Quiet green', dark: '#a9c3a4', light: '#4f6d4b' },
  azure: { label: 'Azure', hint: 'Cool blue', dark: '#9bb8d9', light: '#33597f' },
  rose: { label: 'Rosewood', hint: 'Muted clay', dark: '#d5a3a0', light: '#8c4a48' },
  emerald: {
    label: 'Emerald Forest',
    hint: 'Deep green',
    dark: '#4fbf94',
    light: '#1f7256',
  },
  sapphire: {
    label: 'Sapphire Blue',
    hint: 'Royal blue',
    dark: '#6a9bf0',
    light: '#2f5bb5',
  },
  amber: { label: 'Warm Amber', hint: 'Golden orange', dark: '#e0a445', light: '#8c5a0d' },
  violet: {
    label: 'Midnight Purple',
    hint: 'Deep violet',
    dark: '#a78bfa',
    light: '#6242b8',
  },
  slate: { label: 'Classic Slate', hint: 'Neutral steel', dark: '#a3aebd', light: '#4a5666' },
};

export const COLOR_MODE_LABEL: Record<ColorMode, string> = {
  dark: 'Slate',
  light: 'Paper',
  system: 'Auto',
};

export interface BoardPalette {
  label: string;
  hint: string;
  light: string;
  dark: string;
  /** Frame around the board, shown as the bezel edge. */
  frame: string;
}

export const BOARD_PALETTES: Record<BoardPaletteId, BoardPalette> = {
  walnut: {
    label: 'Classic Walnut',
    hint: 'Warm timber',
    light: '#efe0c8',
    dark: '#8a5f42',
    frame: '#3a2a1f',
  },
  green: {
    label: 'Tournament Green',
    hint: 'Club standard',
    light: '#e8dfcb',
    dark: '#789078',
    frame: '#29352e',
  },
  midnight: {
    label: 'Midnight Slate',
    hint: 'Cool and quiet',
    light: '#b6bfcc',
    dark: '#4c596e',
    frame: '#1b2130',
  },
  marble: {
    label: 'Alabaster Marble',
    hint: 'Soft stone',
    light: '#f3f0e9',
    dark: '#b8b1a4',
    frame: '#3a3733',
  },
  sage: {
    label: 'Minimal Sage',
    hint: 'Muted, low contrast',
    light: '#e6e7e1',
    dark: '#9aa998',
    frame: '#2c332c',
  },
  ice: {
    label: 'Ice Blue',
    hint: 'Cool contrast',
    light: '#dfe9f3',
    dark: '#6f8ba6',
    frame: '#1f2b36',
  },
  charcoal: {
    label: 'Charcoal',
    hint: 'Graphite contrast',
    light: '#c9cdd2',
    dark: '#4a4f57',
    frame: '#14161a',
  },
  brown: {
    label: 'Classic Brown',
    hint: 'Deep mahogany',
    light: '#e7cfa9',
    dark: '#7a4a2b',
    frame: '#2a1a10',
  },
};

/** Saved values from the old fixed-step settings, migrated to the scale. */
const LEGACY_BOARD_SCALES: Record<string, number> = {
  compact: 0.85,
  standard: 1.25,
  immersive: 2.5,
};

export interface Appearance {
  palette: BoardPaletteId;
  pieceSet: PieceSetId;
  /** Multiplier on the fitted board, 0.5–2 (1 = fit). */
  boardScale: number;
  /** Ground: slate, paper, or whatever the system is set to. */
  mode: ColorMode;
  accent: AccentId;
}

export const DEFAULT_APPEARANCE: Appearance = {
  palette: 'walnut',
  pieceSet: 'staunton',
  boardScale: DEFAULT_BOARD_SCALE,
  mode: 'dark',
  accent: 'gold',
};

const STORAGE_KEY = 'chess-trainer.appearance.v1';
const ACCENT_IDS = Object.keys(ACCENTS) as AccentId[];

function readAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_APPEARANCE;
    const parsed = JSON.parse(raw) as Partial<Appearance> & {
      boardSize?: string;
      boardWidth?: number;
    };
    const storedScale =
      typeof parsed.boardScale === 'number'
        ? parsed.boardScale
        : typeof parsed.boardWidth === 'number'
          ? parsed.boardWidth / BOARD_BASE_PX
          : LEGACY_BOARD_SCALES[parsed.boardSize ?? ''];
    return {
      palette: parsed.palette && parsed.palette in BOARD_PALETTES
        ? parsed.palette
        : DEFAULT_APPEARANCE.palette,
      pieceSet: ['staunton', 'merida', 'alpha', 'neo'].includes(parsed.pieceSet ?? '')
        ? (parsed.pieceSet as PieceSetId)
        : DEFAULT_APPEARANCE.pieceSet,
      boardScale: clampBoardScale(storedScale ?? DEFAULT_BOARD_SCALE),
      mode: parsed.mode === 'light' || parsed.mode === 'system' || parsed.mode === 'dark'
        ? parsed.mode
        : DEFAULT_APPEARANCE.mode,
      accent: ACCENT_IDS.includes(parsed.accent as AccentId)
        ? (parsed.accent as AccentId)
        : DEFAULT_APPEARANCE.accent,
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

interface AppearanceContextValue {
  appearance: Appearance;
  palette: BoardPalette;
  /** The user's own scale, 0.5–2: a multiplier on the fitted board. */
  boardScale: number;
  /** What is on screen: the fit-to-window size times `boardScale`. */
  effectiveBoardScale: number;
  /** What the user picked: slate, paper, or auto. */
  colorMode: ColorMode;
  /** What is actually on screen once `auto` has been resolved. */
  theme: ResolvedTheme;
  accent: AccentId;
  soundOn: boolean;
  /** Master volume, 0–1. Persisted beside the mute flag. */
  soundVolume: number;
  setPalette: (id: BoardPaletteId) => void;
  setPieceSet: (id: PieceSetId) => void;
  setBoardScale: (scale: number) => void;
  setColorMode: (mode: ColorMode) => void;
  setAccent: (id: AccentId) => void;
  /** Scales the board until it fills the viewport. */
  fitBoard: () => void;
  setSoundOn: (on: boolean) => void;
  setSoundVolume: (volume: number) => void;
  reset: () => void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

/** Live `prefers-color-scheme` flag, so auto mode follows the OS immediately. */
function useSystemTheme(): ResolvedTheme {
  const [theme, setTheme] = useState<ResolvedTheme>(() =>
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark',
  );

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => setTheme(media.matches ? 'light' : 'dark');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  return theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<Appearance>(readAppearance);
  const [soundOn, setSoundOnState] = useState(() => !isMuted());
  const [soundVolume, setSoundVolumeState] = useState(() => getVolume());
  const systemTheme = useSystemTheme();

  /* The CSS below fits the board to the window; the user's scale is a
     multiplier on that fit, so 100% is exactly the room available and anything
     above is a deliberate oversize. The window factor no longer changes it. */
  const effectiveBoardScale = appearance.boardScale;
  const theme: ResolvedTheme =
    appearance.mode === 'system' ? systemTheme : appearance.mode;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance));
    } catch {
      /* private mode — settings stay in memory */
    }
  }, [appearance]);

  /* The whole theme is two attributes on <html>: every token resolves from them. */
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.accent = appearance.accent;
    root.style.colorScheme = theme;
    document
      .getElementById('theme-color')
      ?.setAttribute('content', theme === 'light' ? '#f5f2ea' : '#121214');
  }, [theme, appearance.accent]);

  const setPalette = useCallback((palette: BoardPaletteId) => {
    setAppearance((current) => ({ ...current, palette }));
  }, []);

  const setPieceSet = useCallback((pieceSet: PieceSetId) => {
    setAppearance((current) => ({ ...current, pieceSet }));
  }, []);

  const setBoardScale = useCallback((scale: number) => {
    setAppearance((current) => ({ ...current, boardScale: clampBoardScale(scale) }));
  }, []);

  const setColorMode = useCallback((mode: ColorMode) => {
    setAppearance((current) => ({ ...current, mode }));
  }, []);

  const setAccent = useCallback((accent: AccentId) => {
    setAppearance((current) => ({ ...current, accent }));
  }, []);

  /**
   * Fit: back to the size the window can hold. The board now fits by default,
   * so this is the reset — one click back from an intentional oversize or an
   * older, smaller preference.
   */
  const fitBoard = useCallback(() => {
    setBoardScale(DEFAULT_BOARD_SCALE);
  }, [setBoardScale]);

  /* Nothing resizes the board behind the user's back any more: it is laid out
     from the window in CSS, so a resize simply re-fits it. */

  /* One size pair for the whole app: every board reads these two variables. */
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--board-base', `${BOARD_BASE_PX}px`);
    root.style.setProperty('--board-scale', String(effectiveBoardScale));
  }, [effectiveBoardScale]);

  const setSoundOn = useCallback((on: boolean) => {
    setMuted(!on);
    setSoundOnState(on);
  }, []);

  const setSoundVolume = useCallback((volume: number) => {
    setVolume(volume);
    setSoundVolumeState(getVolume());
  }, []);

  const reset = useCallback(() => {
    setAppearance(DEFAULT_APPEARANCE);
    setMuted(false);
    setVolume(DEFAULT_SOUND_VOLUME);
    setSoundOnState(true);
    setSoundVolumeState(DEFAULT_SOUND_VOLUME);
  }, []);

  const value = useMemo<AppearanceContextValue>(
    () => ({
      appearance,
      palette: BOARD_PALETTES[appearance.palette],
      boardScale: appearance.boardScale,
      effectiveBoardScale,
      colorMode: appearance.mode,
      theme,
      accent: appearance.accent,
      soundOn,
      soundVolume,
      setPalette,
      setPieceSet,
      setBoardScale,
      setColorMode,
      setAccent,
      fitBoard,
      setSoundOn,
      setSoundVolume,
      reset,
    }),
    [
      appearance,
      soundOn,
      soundVolume,
      effectiveBoardScale,
      theme,
      setPalette,
      setPieceSet,
      setBoardScale,
      setColorMode,
      setAccent,
      fitBoard,
      setSoundOn,
      setSoundVolume,
      reset,
    ],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

/** Matches `DEFAULT_SOUND_SETTINGS.volume`; kept here for the reset button. */
export const DEFAULT_SOUND_VOLUME = 0.7;

export function useAppearance(): AppearanceContextValue {
  const context = useContext(AppearanceContext);
  if (!context) throw new Error('useAppearance must be used inside <ThemeProvider>.');
  return context;
}
