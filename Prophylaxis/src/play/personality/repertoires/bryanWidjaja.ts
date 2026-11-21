import type { PersonalityRepertoire } from './types.ts';

/**
 * Bryan Widjaja (Prime), 1400 — the Wall.
 *
 * Three ordinary openings and nothing more:
 *
 * - White: the Queen's Gambit, always 1.d4 and 2.c4. Central control, sound
 *   development, no gambit accepted at the cost of a structural mess.
 * - Black vs 1.e4: the Caro-Kann, 1...c6. A solid pawn chain and the light
 *   bishop outside it.
 * - Black vs 1.d4: a King's Indian setup, ...Nf6, ...g6, ...Bg7, ...d6,
 *   ...O-O. It is a preference, not a script: `repertoires/kid.ts` owns the
 *   principle-based layer that decides between ...e5 and ...c5 (and declines
 *   the whole structure when White's play makes it inappropriate), so these
 *   lines only supply his first few moves.
 *
 * The lines are hand-written main lines from opening literature, not deep
 * theory and not imported from anywhere. Nothing here is borrowed from another
 * character: no line id and no line object is shared with the Johnfer
 * repertoires, Brandon's or Nina's compiled books, Faadi's Caro-Kann or the
 * Bryans' Vienna/Pirc views.
 */
export const BRYAN_WIDJAJA_REPERTOIRE: PersonalityRepertoire = {
  asWhite: [
    {
      id: 'bryan-widjaja-qg-main',
      name: 'Queen’s Gambit Declined, main line',
      tags: ['solid', 'positional', 'developing'],
      weight: 3,
      san: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3', 'O-O', 'Nf3', 'Nbd7'],
    },
    {
      id: 'bryan-widjaja-qg-exchange',
      name: 'Queen’s Gambit, Exchange Variation',
      tags: ['solid', 'positional'],
      san: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'cxd5', 'exd5', 'Bg5', 'Be7', 'e3', 'c6'],
    },
    {
      id: 'bryan-widjaja-qg-slav',
      name: 'Queen’s Gambit versus the Slav',
      tags: ['solid', 'positional'],
      san: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'cxd5', 'cxd5', 'Bf4', 'Nc6', 'e3', 'Bf5'],
    },
  ],
  asBlack: [
    {
      id: 'bryan-widjaja-caro-classical',
      name: 'Caro-Kann, Classical',
      tags: ['solid', 'developing'],
      weight: 3,
      san: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'Nf3', 'Nd7'],
    },
    {
      id: 'bryan-widjaja-caro-advance',
      name: 'Caro-Kann, Advance',
      tags: ['solid', 'positional'],
      weight: 3,
      san: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Nf3', 'e6', 'Be2', 'c5', 'O-O', 'Nc6'],
    },
    {
      id: 'bryan-widjaja-caro-exchange',
      name: 'Caro-Kann, Exchange',
      tags: ['solid', 'developing'],
      san: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'Bd3', 'Nc6', 'c3', 'Nf6', 'Bf4', 'Bg4'],
    },
    {
      id: 'bryan-widjaja-kid-classical',
      name: 'King’s Indian, classical ...e5',
      tags: ['solid', 'positional', 'developing'],
      weight: 3,
      san: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3', 'O-O', 'Be2', 'e5'],
    },
    {
      id: 'bryan-widjaja-kid-nf3',
      name: 'King’s Indian versus 2.Nf3',
      tags: ['solid', 'developing'],
      san: ['d4', 'Nf6', 'Nf3', 'g6', 'g3', 'Bg7', 'Bg2', 'O-O', 'O-O', 'd6'],
    },
    {
      id: 'bryan-widjaja-kid-c5',
      name: 'King’s Indian with ...c5',
      tags: ['positional', 'developing'],
      san: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3', 'O-O', 'Be2', 'c5'],
    },
  ],
};
