import { isBlatantMaterialBlunder } from '../blunders.ts';
import { allowsMateInOne } from '../humanStrength.ts';
import type { PersonalityStyle } from './styles.ts';

/**
 * Bryan Widjaja (Prime)'s defensive guard.
 *
 * His defining trait — defence 98, king safety 98, material 90 — is a taste
 * dial: it reorders near-equal candidates inside `choosePersonalityMove`, and
 * it deliberately does not touch the strength dials. Accuracy still comes from
 * 1400, the candidate gap is still a 1400's, and his tactical misses are still
 * the rating's own slip curve.
 *
 * This module adds the one thing a great defender would never do: spend a
 * deliberate slip on a move that loses material in plain sight or walks into
 * mate in one. He overlooks forks, pins, intermediate moves and complicated
 * exchanges — that is his weakness and it is untouched — but a threat that is
 * simply sitting there is answered, because that is what he is at the board
 * for. The guard is per-character, so no other opponent's errors change.
 */
export function bryanWidjajaAllowsMistake(
  fen: string,
  uci: string,
  style: PersonalityStyle | null | undefined,
): boolean {
  if (style?.id !== 'bryan-widjaja') return true;
  /* A piece left hanging where anyone can take it is not a defensive miss. */
  if (isBlatantMaterialBlunder(fen, uci)) return false;
  /* Nor is ignoring a direct mating threat. */
  return !allowsMateInOne(fen, uci);
}
