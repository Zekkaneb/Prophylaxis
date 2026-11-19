import type { PersonalityRepertoire } from './types.ts';

/**
 * Senior — the tactician.
 *
 * The open Catalan (where the c4 pawn is taken and the a-file opens), the Pirc
 * with the Austrian Attack and ...Na6/...b5 ideas, and the Grünfeld exchange —
 * the sharpest of the four repertoires. Every line aims at piece activity and
 * an unbalanced middlegame rather than a symmetrical one.
 */
export const SENIOR_REPERTOIRE: PersonalityRepertoire = {
  asWhite: [
    {
      id: 'senior-catalan-open-sharp',
      name: 'Catalan, open with ...b5',
      tags: ['sharp', 'initiative'],
      weight: 2,
      san: ['d4', 'Nf6', 'c4', 'e6', 'g3', 'd5', 'Bg2', 'dxc4', 'Nf3', 'Be7', 'O-O', 'O-O', 'Qc2', 'a6', 'Qxc4', 'b5', 'Qc2', 'Bb7'],
    },
    {
      id: 'senior-catalan-central',
      name: 'Catalan, central e4 break',
      tags: ['initiative', 'positional'],
      weight: 2,
      san: ['d4', 'Nf6', 'c4', 'e6', 'g3', 'd5', 'Bg2', 'Be7', 'Nf3', 'O-O', 'O-O', 'Nbd7', 'Nc3', 'c6', 'e4', 'dxe4', 'Nxe4', 'Nxe4', 'Qc2', 'Nef6'],
    },
    {
      id: 'senior-catalan-bb4',
      name: 'Catalan, ...Bb4 check line',
      tags: ['sharp'],
      san: ['d4', 'Nf6', 'c4', 'e6', 'g3', 'Bb4', 'Bd2', 'Be7', 'Bg2', 'd5', 'Nf3', 'O-O'],
    },
  ],
  asBlack: [
    {
      id: 'senior-pirc-austrian',
      name: 'Pirc, Austrian Attack',
      tags: ['sharp', 'initiative'],
      weight: 2,
      san: ['e4', 'd6', 'd4', 'Nf6', 'Nc3', 'g6', 'f4', 'Bg7', 'Nf3', 'O-O', 'Bd3', 'Na6'],
    },
    {
      id: 'senior-pirc-150',
      name: 'Pirc, 150 Attack with ...b5',
      tags: ['sharp'],
      san: ['e4', 'd6', 'd4', 'Nf6', 'Nc3', 'g6', 'Be3', 'Bg7', 'Qd2', 'c6', 'f3', 'b5'],
    },
    {
      id: 'senior-pirc-e5',
      name: 'Pirc, early ...e5',
      tags: ['initiative'],
      san: ['e4', 'd6', 'd4', 'Nf6', 'Nc3', 'g6', 'Nf3', 'Bg7', 'Be2', 'O-O', 'O-O', 'e5'],
    },
    {
      id: 'senior-gruenfeld-exchange',
      name: 'Grünfeld, exchange',
      tags: ['sharp', 'initiative'],
      weight: 2,
      san: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'd5', 'cxd5', 'Nxd5', 'e4', 'Nb6', 'Nf3', 'Bg7', 'Be2', 'O-O'],
    },
    {
      id: 'senior-gruenfeld-be3',
      name: 'Grünfeld, ...Be3 set-up',
      tags: ['sharp'],
      san: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'd5', 'cxd5', 'Nxd5', 'e4', 'Nb6', 'Be3', 'Bg7', 'Rc1', 'O-O'],
    },
    {
      id: 'senior-gruenfeld-fianchetto',
      name: 'Grünfeld, fianchetto variation',
      tags: ['positional', 'initiative'],
      san: ['d4', 'Nf6', 'c4', 'g6', 'Nf3', 'Bg7', 'g3', 'd5', 'Bg2', 'dxc4', 'O-O', 'O-O'],
    },
    {
      id: 'senior-gruenfeld-e5',
      name: 'Grünfeld, ...e5 centre',
      tags: ['sharp'],
      san: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3', 'O-O', 'Be2', 'e5'],
    },
    {
      id: 'senior-english-gruenfeld',
      name: 'English, Grünfeld set-up',
      tags: ['sharp', 'initiative'],
      san: ['c4', 'Nf6', 'Nc3', 'd5', 'd4', 'g6', 'cxd5', 'Nxd5', 'e4', 'Nxc3', 'bxc3', 'Bg7'],
    },
    {
      id: 'senior-reti-gruenfeld',
      name: 'Réti, Grünfeld set-up',
      tags: ['initiative'],
      san: ['Nf3', 'Nf6', 'c4', 'g6', 'Nc3', 'd5', 'd4', 'Bg7'],
    },
  ],
};
