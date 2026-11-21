import type { PersonalityRepertoire } from './types.ts';

/**
 * Christian Hernandez (Senior), 950 — the Natural.
 *
 * One prepared idea, and only with the White pieces: the London System. 1.d4,
 * `Bf4` before `e3` so the bishop sits outside the pawn chain, knights on f3 and
 * d2, a small pawn centre and kingside castling. The lines are short on purpose:
 * he knows the shape of the setup rather than a wall of theory, so the book runs
 * out early and ordinary principled selection takes over from there.
 *
 * There is no Black repertoire at all — not against 1.e4 and not against 1.d4.
 * `asBlack` is empty on purpose, no line is invented for him and
 * `repertoires/kid.ts` does not run for his id, so a Black game starts from the
 * same natural move selection as move forty. That is not randomness: the shared
 * scorer still prefers development, the centre, king safety and reasonable
 * exchanges, at the accuracy a 950 gets.
 */
export const CHRISTIAN_HERNANDEZ_REPERTOIRE: PersonalityRepertoire = {
  asWhite: [
    {
      id: 'christian-hernandez-london-main',
      name: 'London System, main setup',
      tags: ['solid', 'developing'],
      weight: 3,
      san: ['d4', 'd5', 'Bf4', 'Nf6', 'e3', 'c5', 'c3', 'Nc6', 'Nf3', 'e6', 'Nbd2', 'Bd6', 'Bg3', 'O-O'],
    },
    {
      id: 'christian-hernandez-london-kid',
      name: 'London System versus ...g6',
      tags: ['solid', 'developing'],
      san: ['d4', 'Nf6', 'Bf4', 'g6', 'Nf3', 'Bg7', 'e3', 'O-O', 'Be2', 'd6', 'O-O', 'Nbd7'],
    },
    {
      id: 'christian-hernandez-london-nf3',
      name: 'London System with an early Nf3',
      tags: ['solid', 'positional'],
      san: ['d4', 'd5', 'Nf3', 'Nf6', 'Bf4', 'e6', 'e3', 'c5', 'c3', 'Nc6', 'Nbd2', 'Bd6'],
    },
  ],
  /* Nothing here: his Black games are improvised by the shared selection. */
  asBlack: [],
};
