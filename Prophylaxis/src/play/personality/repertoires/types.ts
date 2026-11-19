import type { OpeningTag } from '../styles.ts';

/**
 * One prepared opening line, written in SAN from the standard start position.
 *
 * A repertoire is a list of these per colour. Every ply the character plays is
 * registered under the position it was played in, so lines can share a stem,
 * branch into variations, and transpose into each other without extra work.
 */
export interface OpeningLine {
  /** Stable id, used in tests and dialogue. */
  id: string;
  /** Readable name for documentation and debugging. */
  name: string;
  san: string[];
  /** Relative preference within the repertoire (default 1). */
  weight?: number;
  tags?: OpeningTag[];
}

export interface PersonalityRepertoire {
  asWhite: OpeningLine[];
  asBlack: OpeningLine[];
}
