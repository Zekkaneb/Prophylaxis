import type { PersonalityRepertoire } from './types.ts';

/**
 * Junior — the strategist.
 *
 * The most prepared of the four: the closed Catalan and the solid Pirc with
 * ...Nbd7. Against 1.d4 he plays a King's Indian built from principles, not
 * from a supplied PGN: the same ...Nf6/...g6/...Bg7/...d6/...O-O skeleton as
 * his Pirc, but interpreted with more patience — the setup is completed and
 * castled before the ...e5/...c5 break, and the break is only played when the
 * engine agrees closely. He never speculates with ...f5.
 */
export const JUNIOR_REPERTOIRE: PersonalityRepertoire = {
  asWhite: [
    {
      id: 'junior-catalan-closed',
      name: 'Catalan, closed with e4',
      tags: ['positional', 'solid'],
      weight: 2,
      san: ['d4', 'Nf6', 'c4', 'e6', 'g3', 'd5', 'Bg2', 'Be7', 'Nf3', 'O-O', 'O-O', 'Nbd7', 'Qc2', 'c6', 'Nbd2', 'b6', 'e4', 'Bb7'],
    },
    {
      id: 'junior-catalan-open',
      name: 'Catalan, open and restrained',
      tags: ['positional'],
      san: ['d4', 'Nf6', 'c4', 'e6', 'g3', 'd5', 'Bg2', 'Be7', 'Nf3', 'O-O', 'O-O', 'dxc4', 'Qc2', 'a6', 'Qxc4', 'b5', 'Qc2', 'Bb7'],
    },
    {
      id: 'junior-qgd-white',
      name: "Queen's Gambit, Tartakower set-up",
      tags: ['positional', 'solid'],
      san: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'd5', 'Bg5', 'Be7', 'e3', 'O-O', 'Nf3', 'h6', 'Bh4', 'b6'],
    },
  ],
  asBlack: [
    {
      id: 'junior-pirc-solid',
      name: 'Pirc, solid ...Nbd7',
      tags: ['positional', 'solid'],
      weight: 2,
      san: ['e4', 'd6', 'd4', 'Nf6', 'Nc3', 'g6', 'Nf3', 'Bg7', 'Be2', 'O-O', 'O-O', 'c6', 'a4', 'Nbd7'],
    },
    {
      id: 'junior-pirc-long-castle',
      name: 'Pirc, opposite-side castling',
      tags: ['positional'],
      san: ['e4', 'd6', 'd4', 'Nf6', 'Nc3', 'g6', 'Be3', 'Bg7', 'Qd2', 'O-O', 'O-O-O', 'Nc6'],
    },
    {
      id: 'junior-pirc-nbd7',
      name: 'Pirc, solid ...Nbd7 set-up',
      tags: ['positional', 'solid'],
      san: ['e4', 'd6', 'd4', 'Nf6', 'Nc3', 'g6', 'Nf3', 'Bg7', 'Be2', 'O-O', 'O-O', 'Nbd7'],
    },
    {
      id: 'junior-pirc-austrian',
      name: 'Pirc, Austrian with ...c5',
      tags: ['positional', 'solid'],
      san: ['e4', 'd6', 'd4', 'Nf6', 'Nc3', 'g6', 'f4', 'Bg7', 'Nf3', 'O-O', 'Bd3', 'Na6', 'O-O', 'c5'],
    },
  ],
};
