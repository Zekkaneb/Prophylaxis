/** Pure bot-vs-bot helpers, kept React-free for Node tests. */

export type MatchSpeed = 'slow' | 'normal' | 'fast';

/**
 * Presentation delay between completed moves. It is deliberately separate from
 * the engine's thinking budget: the selectable pace must never change strength.
 */
export function matchDelayMs(speed: MatchSpeed): number {
  if (speed === 'slow') return 1200;
  if (speed === 'fast') return 80;
  return 320;
}
