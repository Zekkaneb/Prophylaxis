import type { PersonalityRepertoire } from './types.ts';

/**
 * Alex Tang (Sophomore), 1100 — the energetic goofball.
 *
 * Two openings, both of them the simple version:
 *
 * - White: the London System. 1.d4, the light-squared bishop outside the pawn
 *   chain on f4, knights on f3 and d2, e3 and c3 supporting the centre, and
 *   kingside castling. No gambits, no sharp theory.
 * - Black vs 1.d4: a King's Indian setup, ...Nf6, ...g6, ...Bg7, ...d6 and
 *   ...O-O. `repertoires/kid.ts` owns the principle-based layer that decides
 *   when (and whether) to play ...e5 or ...c5, so these lines only supply the
 *   first few moves of the structure.
 *
 * There is deliberately no Black answer to 1.e4: that matchup has no assigned
 * repertoire, so his book is empty and the ordinary principled selection plays
 * a legal, sensible move instead. Every line is hand-written and short, so the
 * book runs out where a 1100's knowledge does.
 */
export const ALEX_TANG_REPERTOIRE: PersonalityRepertoire = {
  asWhite: [
    {
      id: 'alex-tang-london-main',
      name: 'London System, main setup',
      tags: ['solid', 'developing'],
      weight: 3,
      san: ['d4', 'd5', 'Bf4', 'Nf6', 'e3', 'e6', 'Nf3', 'c5', 'c3', 'Nc6', 'Nbd2', 'Bd6', 'Bg3', 'O-O'],
    },
    {
      id: 'alex-tang-london-kid',
      name: 'London System versus ...g6',
      tags: ['solid', 'developing'],
      san: ['d4', 'Nf6', 'Bf4', 'g6', 'e3', 'Bg7', 'Nf3', 'O-O', 'Be2', 'd6', 'O-O', 'Nbd7', 'h3', 'c5'],
    },
    {
      id: 'alex-tang-london-c5',
      name: 'London System with an early Nf3',
      tags: ['solid', 'positional'],
      san: ['d4', 'd5', 'Nf3', 'Nf6', 'Bf4', 'c5', 'e3', 'Nc6', 'c3', 'e6', 'Nbd2', 'Bd6'],
    },
  ],
  asBlack: [
    {
      id: 'alex-tang-kid-london',
      name: 'King’s Indian versus the London',
      tags: ['solid', 'developing'],
      weight: 3,
      san: ['d4', 'Nf6', 'Bf4', 'g6', 'e3', 'Bg7', 'Nf3', 'O-O', 'Be2', 'd6', 'O-O', 'Nbd7'],
    },
    {
      id: 'alex-tang-kid-classical',
      name: 'King’s Indian with ...Nc6',
      tags: ['solid', 'developing'],
      san: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3', 'O-O', 'Be2', 'Nc6'],
    },
  ],
};
