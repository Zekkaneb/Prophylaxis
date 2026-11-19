import type { PersonalityRepertoire } from './types.ts';

/**
 * Faadi Granillo Garcia's openings.
 *
 * Short, principle-based lines rather than memorised theory: the English as
 * White, the Caro-Kann against 1.e4 and the Slav against 1.d4. Main lines carry
 * weight 3 so his own recall (see `../faadi.ts`) holds on to them better than
 * the offshoots, which exist only so his play does not look scripted.
 *
 * Nothing here is copied from another personality: no line id and no SAN stem
 * is shared with Nina's compiled Caro-Kann study, the Johnfer repertoires or
 * Brandon's course book.
 */
export const FAADI_REPERTOIRE: PersonalityRepertoire = {
  asWhite: [
    {
      id: 'faadi-english-symmetrical',
      name: 'English, Symmetrical',
      san: ['c4', 'c5', 'Nf3', 'Nf6', 'Nc3', 'Nc6', 'g3', 'g6', 'Bg2', 'Bg7', 'O-O', 'O-O'],
      weight: 3,
      tags: ['positional', 'developing'],
    },
    {
      id: 'faadi-english-symmetrical-b3',
      name: 'English, Symmetrical with b3',
      san: ['c4', 'c5', 'Nf3', 'Nf6', 'Nc3', 'Nc6', 'b3'],
      tags: ['positional'],
    },
    {
      id: 'faadi-english-reversed-sicilian',
      name: 'English, Reversed Sicilian',
      san: ['c4', 'e5', 'Nc3', 'Nf6', 'g3', 'd5', 'cxd5', 'Nxd5', 'Bg2', 'Nb6', 'Nf3', 'Nc6'],
      weight: 3,
      tags: ['initiative', 'developing'],
    },
    {
      id: 'faadi-english-four-knights',
      name: 'English, Four Knights',
      san: ['c4', 'e5', 'Nc3', 'Nf6', 'Nf3', 'Nc6', 'g3', 'Bc5', 'Bg2', 'd6', 'O-O', 'O-O'],
      tags: ['developing'],
    },
    {
      id: 'faadi-english-vs-king-indian',
      name: 'English versus King’s Indian',
      san: ['c4', 'Nf6', 'Nc3', 'g6', 'g3', 'Bg7', 'Bg2', 'O-O', 'Nf3', 'd6', 'O-O', 'e5'],
      weight: 3,
      tags: ['positional', 'developing'],
    },
    {
      id: 'faadi-english-vs-e6',
      name: 'English versus ...e6',
      san: ['c4', 'e6', 'Nc3', 'd5', 'd4', 'Nf6', 'Nf3', 'Be7'],
      tags: ['developing'],
    },
  ],
  asBlack: [
    {
      id: 'faadi-caro-classical',
      name: 'Caro-Kann, Classical',
      san: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'h4', 'h6'],
      weight: 3,
      tags: ['solid', 'developing'],
    },
    {
      id: 'faadi-caro-classical-nd7',
      name: 'Caro-Kann, Classical with ...Nd7',
      san: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Nd7', 'Nf3', 'Ngf6'],
      tags: ['solid'],
    },
    {
      id: 'faadi-caro-advance',
      name: 'Caro-Kann, Advance',
      san: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Nf3', 'e6', 'Be2', 'c5'],
      weight: 3,
      tags: ['solid', 'positional'],
    },
    {
      id: 'faadi-caro-exchange',
      name: 'Caro-Kann, Exchange',
      san: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'Bd3', 'Nc6', 'c3', 'Nf6'],
      tags: ['developing'],
    },
    {
      id: 'faadi-caro-two-knights',
      name: 'Caro-Kann, Two Knights',
      san: ['e4', 'c6', 'Nc3', 'd5', 'Nf3', 'Bg4', 'h3', 'Bxf3', 'Qxf3', 'e6'],
      tags: ['developing'],
    },
    {
      id: 'faadi-slav-main',
      name: 'Slav, Main Line',
      san: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'dxc4', 'a4', 'Bf5', 'e3', 'e6'],
      weight: 3,
      tags: ['solid', 'positional'],
    },
    {
      id: 'faadi-slav-main-bg4',
      name: 'Slav, Main Line with ...Bg4',
      san: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'dxc4', 'a4', 'Bg4'],
      tags: ['solid'],
    },
    {
      id: 'faadi-slav-three-knights',
      name: 'Slav, Three Knights',
      san: ['d4', 'd5', 'c4', 'c6', 'Nc3', 'Nf6', 'e3', 'Bf5', 'Nf3', 'e6'],
      weight: 3,
      tags: ['solid', 'developing'],
    },
    {
      id: 'faadi-slav-exchange',
      name: 'Slav, Exchange',
      san: ['d4', 'd5', 'c4', 'c6', 'cxd5', 'cxd5'],
      tags: ['positional'],
    },
    {
      id: 'faadi-slav-via-nf3',
      name: 'Slav via 2.Nf3',
      san: ['d4', 'd5', 'Nf3', 'Nf6', 'c4', 'c6'],
      tags: ['developing'],
    },
  ],
};
