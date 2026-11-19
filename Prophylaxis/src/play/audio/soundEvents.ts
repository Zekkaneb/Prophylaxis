/**
 * Which bundled sound a chess event should play.
 *
 * Pure data and one classifier: no DOM, no audio objects, no React. The sound
 * manager turns these names into files, and the tests pin the priority rules
 * here instead of trying to listen to a browser.
 */

export type SoundEvent =
  | 'move-self'
  | 'move-opponent'
  | 'capture'
  | 'move-check'
  | 'castle'
  | 'promote'
  | 'illegal'
  | 'premove'
  | 'game-end';

/** File names exactly as supplied, resolved under `public/sounds/`. */
export const SOUND_FILES: Record<SoundEvent, string> = {
  'move-self': 'move-self.mp3',
  'move-opponent': 'move-opponent.mp3',
  capture: 'capture.mp3',
  'move-check': 'move-check.mp3',
  castle: 'castle.mp3',
  promote: 'promote.mp3',
  illegal: 'illegal.mp3',
  premove: 'premove.mp3',
  'game-end': 'game-end.mp3',
};

/**
 * Deterministic priority for a move, most specific first. A move that is both
 * a promotion and check only plays the promotion cue; a move that ends the
 * game only plays the completion cue.
 */
export const MOVE_SOUND_PRIORITY = [
  'game-end',
  'promote',
  'castle',
  'move-check',
  'capture',
] as const;

export type MoveSide = 'self' | 'opponent';

export interface MoveSoundFacts {
  side: MoveSide;
  capture: boolean;
  castle: boolean;
  promotion: boolean;
  check: boolean;
  /** The move itself finished the game (mate, stalemate, draw by move). */
  gameEnd: boolean;
}

/** Two identical cues closer than this are one event seen twice, not two moves. */
export const SOUND_DEDUPE_MS = 90;

export function shouldPlaySound(lastPlayedAt: number, now: number): boolean {
  return now - lastPlayedAt >= SOUND_DEDUPE_MS;
}

/**
 * Where audio is allowed. A live game and a reviewed game speak: bootstrapping
 * the board, loading a saved game, importing a PGN and engine analysis are all
 * silent by policy.
 */
export type SoundContext = 'live-play' | 'review' | 'restore' | 'pgn-import' | 'analysis';

export function shouldPlaySoundIn(context: SoundContext): boolean {
  return context === 'live-play' || context === 'review';
}

/** The single sound for one completed move. Never returns two events. */
export function classifyMoveSound(facts: MoveSoundFacts): SoundEvent {
  if (facts.gameEnd) return 'game-end';
  if (facts.promotion) return 'promote';
  if (facts.castle) return 'castle';
  if (facts.check) return 'move-check';
  if (facts.capture) return 'capture';
  return facts.side === 'self' ? 'move-self' : 'move-opponent';
}

export interface MoveLike {
  captured?: string;
  promotion?: string;
  flags: string;
}

/**
 * Turns a chess.js move into the facts the classifier needs. En passant counts
 * as a capture (chess.js leaves `captured` empty for it), castling is in the
 * `k`/`q` flags and promotion in `p` or the promotion field.
 */
export function moveSoundFacts(
  move: MoveLike,
  options: { side: MoveSide; check: boolean; gameEnd: boolean },
): MoveSoundFacts {
  return {
    side: options.side,
    capture: Boolean(move.captured) || move.flags.includes('e'),
    castle: move.flags.includes('k') || move.flags.includes('q'),
    promotion: Boolean(move.promotion) || move.flags.includes('p'),
    check: options.check,
    gameEnd: options.gameEnd,
  };
}
