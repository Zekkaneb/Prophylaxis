import type { PersonalityRepertoire } from './types.ts';

/**
 * Edward Chen — the principled beginner, 800.
 *
 * A deliberately small, principle-based repertoire: the Ruy Lopez as White,
 * 1...e5 against 1.e4 and 1...d5 against 1.d4 as Black. Every line is a normal
 * developing sequence that ends in an ordinary middlegame — no sharp offshoots,
 * no memorised theory. The point of the short scope is that a beginner's
 * knowledge runs out after a handful of moves; `personality/edward.ts` adds the
 * low-familiarity recall that makes him improvise before that.
 *
 * Kept separate from the other characters' books: nothing here is borrowed
 * from, or added to, another opponent's repertoire.
 */
export const EDWARD_REPERTOIRE: PersonalityRepertoire = {
  asWhite: [
    {
      id: 'edward-ruy-morphy',
      name: 'Ruy Lopez, Morphy Defence',
      tags: ['solid', 'developing', 'positional'],
      weight: 2,
      san: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'd6', 'c3', 'O-O', 'd3'],
    },
    {
      id: 'edward-ruy-quiet',
      name: 'Ruy Lopez, quiet development',
      tags: ['solid', 'developing'],
      san: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6', 'd3', 'Bc5', 'c3', 'd6', 'O-O', 'O-O', 'Re1', 'a6'],
    },
    {
      id: 'edward-ruy-exchange',
      name: 'Ruy Lopez, Exchange Variation',
      tags: ['solid'],
      san: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6', 'dxc6', 'O-O', 'f6', 'd4', 'exd4', 'Nxd4', 'c5', 'Nb3'],
    },
  ],
  asBlack: [
    {
      id: 'edward-e5-closed',
      name: 'Open Game, 1...e5',
      tags: ['solid', 'developing'],
      weight: 2,
      san: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'd3', 'b5', 'Bb3', 'd6', 'c3', 'O-O'],
    },
    {
      id: 'edward-italian',
      name: 'Italian Game, Giuoco Piano',
      tags: ['solid', 'developing'],
      san: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'd3', 'Nf6', 'c3', 'd6', 'O-O', 'O-O', 'Re1', 'a6'],
    },
    {
      id: 'edward-scotch',
      name: 'Scotch Game',
      tags: ['developing'],
      san: ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4', 'Nf6', 'Nxc6', 'bxc6', 'e5', 'Qe7', 'Qe2', 'Nd5'],
    },
    {
      id: 'edward-qgd',
      name: 'Queen’s Gambit Declined, 1...d5',
      tags: ['solid', 'positional'],
      weight: 2,
      san: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3', 'O-O', 'Nf3', 'h6'],
    },
    {
      id: 'edward-slav-exchange',
      name: 'Slav Defence, exchange',
      tags: ['solid', 'developing'],
      san: ['d4', 'd5', 'c4', 'c6', 'cxd5', 'cxd5', 'Nc3', 'Nf6', 'Nf3', 'Nc6', 'Bf4', 'Bf5', 'e3', 'e6'],
    },
    {
      id: 'edward-vs-reti',
      name: 'Queen’s pawn set-up against 1.Nf3',
      tags: ['solid', 'developing'],
      san: ['Nf3', 'd5', 'd4', 'Nf6', 'c4', 'e6', 'Nc3', 'Be7', 'Bg5', 'O-O'],
    },
    {
      id: 'edward-vs-english',
      name: 'Queen’s pawn set-up against 1.c4',
      tags: ['solid', 'developing'],
      san: ['c4', 'e6', 'Nc3', 'd5', 'd4', 'Nf6', 'Nf3', 'Be7', 'Bg5', 'O-O'],
    },
  ],
};
