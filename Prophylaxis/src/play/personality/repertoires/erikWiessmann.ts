import type { PersonalityRepertoire } from './types.ts';

/**
 * Erik Wiessmann (Teacher), 1100 — the chill logician.
 *
 * Textbook principles, nothing speculative:
 *
 * - White: 1.e4, then ordinary development, central control and kingside
 *   castling. Three short, mainstream lines (Italian, Open Sicilian, French).
 * - Black vs 1.e4: 1...e5, answering the Italian, the Ruy Lopez and the Scotch
 *   with conventional development.
 * - Black vs 1.d4: 1...d5, a Queen's Gambit Declined / Slav set-up.
 *
 * No deep theory and no invented branches: the lines stop where a 1100's
 * knowledge stops, and the personality engine plus the ordinary engine fallback
 * take over from there. Nothing here is borrowed from another opponent.
 */
export const ERIK_WIESSMANN_REPERTOIRE: PersonalityRepertoire = {
  asWhite: [
    {
      id: 'erik-wiessmann-italian',
      name: 'Italian Game, principled development',
      tags: ['solid', 'developing', 'positional'],
      weight: 3,
      san: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3', 'd6', 'O-O', 'O-O'],
    },
    {
      id: 'erik-wiessmann-open-sicilian',
      name: 'Open Sicilian, natural development',
      tags: ['developing', 'positional'],
      san: ['e4', 'c5', 'Nf3', 'Nc6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'd6'],
    },
    {
      id: 'erik-wiessmann-french',
      name: 'French Defence, classical development',
      tags: ['solid', 'developing'],
      san: ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e5', 'Nfd7', 'Bxe7', 'Qxe7'],
    },
  ],
  asBlack: [
    {
      id: 'erik-wiessmann-e5-italian',
      name: '1...e5 versus the Italian',
      tags: ['solid', 'developing'],
      weight: 3,
      san: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3', 'd6', 'O-O', 'O-O'],
    },
    {
      id: 'erik-wiessmann-e5-ruy',
      name: '1...e5 versus the Ruy Lopez',
      tags: ['solid', 'developing'],
      san: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5'],
    },
    {
      id: 'erik-wiessmann-e5-scotch',
      name: '1...e5 versus the Scotch',
      tags: ['solid', 'developing'],
      san: ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4', 'Nf6', 'Nc3', 'Bb4'],
    },
    {
      id: 'erik-wiessmann-qgd-tarrasch',
      name: 'Tarrasch Defence, principled development',
      tags: ['solid', 'positional', 'developing'],
      weight: 3,
      san: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'c5', 'cxd5', 'exd5', 'Nf3', 'Nc6', 'g3', 'Nf6'],
    },
    {
      id: 'erik-wiessmann-slav',
      name: 'Slav Defence, sound development',
      tags: ['solid', 'developing'],
      san: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'dxc4', 'a4', 'Bf5'],
    },
    {
      id: 'erik-wiessmann-vs-london',
      name: '1...d5 versus the London',
      tags: ['solid', 'developing'],
      san: ['d4', 'd5', 'Bf4', 'Nf6', 'e3', 'e6', 'Nf3', 'Bd6', 'Bg3', 'O-O'],
    },
  ],
};
