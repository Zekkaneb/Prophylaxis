import type { PersonalityRepertoire } from './types.ts';

/**
 * Mabinti Mansaray (Junior) — the enthusiast, 1550.
 *
 * A principled Queen's Gambit player: 1.d4, 2.c4, normal development, central
 * control, the king castled early. Nothing here is a memorised variation; every
 * line is an ordinary main move of a well-known Queen's Gambit or open-game
 * structure, short enough that the book runs out where a 1550's knowledge runs
 * out. When it does, `chooseBotMove` hands the position to Stockfish and her own
 * tendencies.
 *
 * As Black she answers 1.e4 with 1...e5 (classical development) and 1.d4 with
 * 1...d5 (a sound Queen's Gambit Declined / Semi-Slav set-up), plus quiet
 * queen's pawn answers to 1.Nf3 and 1.c4. Every line is her own entry: nothing
 * is imported from, or shared with, another character's repertoire.
 */
export const MABINTI_REPERTOIRE: PersonalityRepertoire = {
  asWhite: [
    {
      id: 'mabinti-qgd-main',
      name: "Queen's Gambit Declined, classical development",
      tags: ['solid', 'positional', 'developing'],
      weight: 3,
      san: [
        'd4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7',
        'e3', 'O-O', 'Nf3', 'Nbd7',
      ],
    },
    {
      id: 'mabinti-qga',
      name: "Queen's Gambit Accepted, normal variation",
      tags: ['solid', 'developing'],
      weight: 2,
      san: [
        'd4', 'd5', 'c4', 'dxc4', 'Nf3', 'Nf6', 'e3', 'e6',
        'Bxc4', 'c5', 'O-O', 'a6',
      ],
    },
    {
      id: 'mabinti-slav',
      name: 'Slav Defence, main line',
      tags: ['solid', 'positional'],
      san: [
        'd4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'dxc4',
        'a4', 'Bf5', 'e3', 'e6', 'Bxc4', 'Nbd7',
      ],
    },
  ],
  asBlack: [
    {
      id: 'mabinti-e5-ruy',
      name: 'Open Game, Ruy Lopez main line',
      tags: ['solid', 'developing', 'positional'],
      weight: 3,
      san: [
        'e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6',
        'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'd6', 'c3', 'Na5',
      ],
    },
    {
      id: 'mabinti-e5-italian',
      name: 'Italian Game, Giuoco Pianissimo',
      tags: ['solid', 'developing'],
      weight: 2,
      san: [
        'e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6',
        'd3', 'd6', 'O-O', 'h6',
      ],
    },
    {
      id: 'mabinti-e5-scotch',
      name: 'Scotch Game, classical',
      tags: ['developing', 'initiative'],
      san: ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4', 'Bc5', 'Nb3', 'Bb6'],
    },
    {
      id: 'mabinti-qgd-declined',
      name: "Queen's Gambit Declined, 1...d5",
      tags: ['solid', 'positional'],
      weight: 3,
      san: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3', 'O-O', 'Nf3', 'b6'],
    },
    {
      id: 'mabinti-qgd-exchange',
      name: "Queen's Gambit Declined, exchange",
      tags: ['solid', 'positional'],
      weight: 2,
      san: [
        'd4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'cxd5', 'exd5',
        'Bg5', 'Be7', 'e3', 'c6', 'Bd3', 'Nbd7',
      ],
    },
    {
      id: 'mabinti-semi-slav',
      name: 'Semi-Slav set-up, 1...d5 with ...c6',
      tags: ['solid', 'positional'],
      san: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'e6', 'a4', 'Bb4'],
    },
    {
      id: 'mabinti-vs-reti',
      name: 'Queen’s pawn set-up against 1.Nf3',
      tags: ['solid', 'developing'],
      san: ['Nf3', 'd5', 'd4', 'Nf6', 'c4', 'e6', 'Nc3', 'c6'],
    },
    {
      id: 'mabinti-vs-english',
      name: 'Queen’s pawn set-up against 1.c4',
      tags: ['solid', 'positional'],
      san: ['c4', 'e6', 'Nc3', 'd5', 'd4', 'Nf6', 'Bg5', 'Be7', 'e3', 'O-O'],
    },
  ],
};
