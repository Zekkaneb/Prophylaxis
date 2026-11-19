import type { PersonalityRepertoire } from './types.ts';

/**
 * Sophomore — the opportunist.
 *
 * The Catalan is the positional backbone he is learning to trust, and the Pirc
 * is the supplied answer to 1.e4. Against 1.d4 he plays a King's Indian — not
 * from a PGN (none was supplied), but from the principle-based preference layer
 * in `kid.ts`: ...Nf6, ...g6, ...Bg7, ...d6, ...O-O, then ...e5 or ...c5 as the
 * centre allows. His interpretation is the opportunistic one: he will break
 * before castling and occasionally pushes ...f5 when the kingside is his.
 */
export const SOPHOMORE_REPERTOIRE: PersonalityRepertoire = {
  asWhite: [
    {
      id: 'sophomore-catalan-closed',
      name: 'Catalan, closed',
      tags: ['positional', 'initiative'],
      weight: 2,
      san: ['d4', 'Nf6', 'c4', 'e6', 'g3', 'd5', 'Bg2', 'Be7', 'Nf3', 'O-O', 'O-O', 'Nbd7', 'Qc2', 'c6', 'Nbd2', 'b6'],
    },
    {
      id: 'sophomore-catalan-open',
      name: 'Catalan, open',
      tags: ['positional', 'initiative'],
      weight: 2,
      san: ['d4', 'Nf6', 'c4', 'e6', 'g3', 'd5', 'Bg2', 'dxc4', 'Nf3', 'Be7', 'O-O', 'O-O', 'Qc2', 'a6'],
    },
    {
      id: 'sophomore-catalan-open-b5',
      name: 'Catalan, open with ...b5',
      tags: ['positional'],
      san: ['d4', 'Nf6', 'c4', 'e6', 'g3', 'd5', 'Bg2', 'Be7', 'Nf3', 'O-O', 'O-O', 'dxc4', 'Qc2', 'a6', 'Qxc4', 'b5'],
    },
  ],
  asBlack: [
    {
      id: 'sophomore-pirc-classical',
      name: 'Pirc, classical',
      tags: ['positional', 'initiative'],
      weight: 2,
      san: ['e4', 'd6', 'd4', 'Nf6', 'Nc3', 'g6', 'Nf3', 'Bg7', 'Be2', 'O-O', 'O-O', 'c6'],
    },
    {
      id: 'sophomore-pirc-austrian',
      name: 'Pirc, Austrian Attack',
      tags: ['initiative'],
      san: ['e4', 'd6', 'd4', 'Nf6', 'Nc3', 'g6', 'f4', 'Bg7', 'Nf3', 'O-O', 'Bd3', 'Nc6'],
    },
    {
      id: 'sophomore-pirc-150',
      name: 'Pirc, 150 Attack',
      tags: ['initiative'],
      san: ['e4', 'd6', 'd4', 'Nf6', 'Nc3', 'g6', 'Be3', 'Bg7', 'Qd2', 'c6', 'f3', 'b5'],
    },
    {
      id: 'sophomore-pirc-c5',
      name: 'Pirc, ...c5 counterplay',
      tags: ['initiative'],
      san: ['e4', 'd6', 'd4', 'Nf6', 'Nc3', 'g6', 'f4', 'Bg7', 'Nf3', 'c5'],
    },
  ],
};
