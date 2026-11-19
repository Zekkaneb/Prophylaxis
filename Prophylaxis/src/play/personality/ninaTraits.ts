import type { MoveFeatures } from './engine.ts';

/**
 * Appearance-based ambition, kept separate from `nina.ts` so the engine can
 * import it without a module cycle. It describes the move, not its evaluation.
 */
export function ninaAmbition(features: MoveFeatures): number {
  return (
    (features.sacrifices ? 3 : 0) +
    (features.attacksKing ? 2 : 0) +
    (features.check ? 1 : 0) +
    (features.toEnemyHalf ? 0.5 : 0) -
    (features.castle ? 1.5 : 0) -
    (features.develops ? 0.5 : 0) -
    (features.trades ? 0.5 : 0)
  );
}

/** She will consider a calmer move only when she is not already in trouble. */
export function ninaPrefersCautious(input: {
  ambition: number;
  botPov: number;
  random: () => number;
}): boolean {
  if (input.ambition < 1.5) return false;
  if (input.botPov < -60) return false;
  return input.random() < 0.45;
}

/** The most evaluation she will trade for comfort. */
export const NINA_CAUTION_GAP = 45;

export function ninaCanTradeForComfort(features: MoveFeatures): boolean {
  /* A straight material win or promotion is not "ambition" to decline. */
  return !(features.promotion || (features.capture && features.capturedValue >= 300));
}
