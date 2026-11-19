import type { PersonalityRepertoire } from './types.ts';

/**
 * Freshman — the defender.
 *
 * A 1250's repertoire: the Ruy Lopez because it develops naturally and keeps a
 * familiar pawn centre, 1...e5 because it is the open game he learned first, and
 * the Slav against 1.d4 because ...c6 defends the centre without requiring
 * concrete theory. Scope is deliberately short: main moves only, no sharp
 * offshoots, every line ending in a normal middlegame.
 */
export const FRESHMAN_REPERTOIRE: PersonalityRepertoire = {
  asWhite: [
    {
      id: 'freshman-ruy-morphy',
      name: 'Ruy Lopez, Morphy Defence',
      tags: ['solid', 'developing', 'positional'],
      weight: 2,
      san: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'd6', 'c3', 'O-O'],
    },
    {
      id: 'freshman-ruy-berlin',
      name: 'Ruy Lopez, Berlin Defence',
      tags: ['solid', 'developing'],
      san: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6', 'O-O', 'Nxe4', 'd4', 'Nd6', 'Bxc6', 'dxc6', 'dxe5', 'Nf5'],
    },
    {
      id: 'freshman-ruy-exchange',
      name: 'Ruy Lopez, Exchange Variation',
      tags: ['solid', 'positional'],
      san: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6', 'dxc6', 'O-O', 'f6', 'd4', 'exd4', 'Nxd4', 'c5', 'Nb3', 'Qxd1', 'Rxd1'],
    },
  ],
  asBlack: [
    {
      id: 'freshman-open-morphy',
      name: 'Open Game, Morphy Defence',
      tags: ['solid', 'developing'],
      weight: 2,
      san: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'd6', 'c3', 'O-O'],
    },
    {
      id: 'freshman-italian',
      name: 'Italian Game, Giuoco Piano',
      tags: ['solid', 'developing'],
      san: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3', 'd6', 'O-O', 'O-O', 'Re1', 'a6'],
    },
    {
      id: 'freshman-scotch',
      name: 'Scotch Game',
      tags: ['solid', 'developing'],
      san: ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4', 'Bc5', 'Be3', 'Qf6', 'c3', 'Nge7'],
    },
    {
      id: 'freshman-petrov',
      name: 'Petrov Defence',
      tags: ['solid', 'positional'],
      san: ['e4', 'e5', 'Nf3', 'Nf6', 'Nxe5', 'd6', 'Nf3', 'Nxe4', 'd4', 'd5', 'Bd3', 'Nc6', 'O-O', 'Be7'],
    },
    {
      id: 'freshman-slav-main',
      name: 'Slav Defence, main line',
      tags: ['solid', 'positional'],
      weight: 2,
      san: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'dxc4', 'a4', 'Bf5', 'e3', 'e6', 'Bxc4', 'Bb4'],
    },
    {
      id: 'freshman-slav-exchange',
      name: 'Slav Defence, exchange',
      tags: ['solid'],
      san: ['d4', 'd5', 'c4', 'c6', 'Nc3', 'Nf6', 'Bg5', 'h6', 'Bh4', 'dxc4', 'e4', 'g5', 'Bg3', 'b5'],
    },
    {
      id: 'freshman-slav-quiet',
      name: 'Slav Defence, quiet development',
      tags: ['solid', 'developing'],
      san: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'e3', 'Bf5', 'Bd3', 'Bxd3', 'Qxd3', 'e6'],
    },
    {
      id: 'freshman-english-slav',
      name: 'English, Slav set-up',
      tags: ['solid', 'positional'],
      san: ['c4', 'c6', 'Nf3', 'd5', 'd4', 'Nf6', 'Nc3', 'e6', 'e3', 'Nbd7'],
    },
    {
      id: 'freshman-reti-slav',
      name: 'Réti, Slav set-up',
      tags: ['solid', 'developing'],
      san: ['Nf3', 'd5', 'd4', 'Nf6', 'c4', 'c6', 'Nc3', 'e6', 'e3', 'Nbd7'],
    },
  ],
};
