import type { PersonalityRepertoire } from './types.ts';

/**
 * Sophia Kuan, 1300 — the gentle defender.
 *
 * - White: the Vienna Game, but the quiet one. 1.e4, 2.Nc3, the bishop to c4
 *   or g2, d3, Nf3, castling — no Vienna Gambit, no speculative f4 push.
 * - Black vs 1.e4: the French, 1...e6. The Steinitz line trades dark-squared
 *   bishops early, the Tarrasch line keeps a compact, solid structure, and the
 *   Advance line meets White's space with ...c5 and ...Qb6.
 * - Black vs 1.d4: 1...d5, a sound Queen's Gambit Declined set-up and a calm
 *   answer to the London.
 *
 * Nothing here is deep theory, and nothing duplicates another opponent's line.
 * Outside the book the ordinary personality selection and engine fallback play.
 */
export const SOPHIA_KUAN_REPERTOIRE: PersonalityRepertoire = {
  asWhite: [
    {
      id: 'sophia-kuan-vienna-quiet',
      name: 'Vienna Game, quiet set-up',
      tags: ['solid', 'developing', 'positional'],
      weight: 3,
      san: ['e4', 'e5', 'Nc3', 'Nf6', 'Bc4', 'Bc5', 'd3', 'd6', 'Nf3', 'Nc6', 'O-O', 'O-O'],
    },
    {
      id: 'sophia-kuan-vienna-g3',
      name: 'Vienna Game with g3',
      tags: ['solid', 'positional'],
      san: ['e4', 'e5', 'Nc3', 'Nf6', 'g3', 'Bc5', 'Bg2', 'd6', 'd3', 'Nc6', 'Nf3', 'O-O'],
    },
    {
      id: 'sophia-kuan-vienna-vs-nc6',
      name: 'Vienna Game versus ...Nc6',
      tags: ['solid', 'developing'],
      san: ['e4', 'e5', 'Nc3', 'Nc6', 'g3', 'Bc5', 'Bg2', 'd6', 'd3', 'Nf6', 'Nf3', 'O-O'],
    },
  ],
  asBlack: [
    {
      id: 'sophia-kuan-french-rubinstein',
      name: 'French, Rubinstein with an early knight trade',
      tags: ['solid', 'positional'],
      weight: 3,
      san: [
        'e4',
        'e6',
        'd4',
        'd5',
        'Nc3',
        'dxe4',
        'Nxe4',
        'Nd7',
        'Nf3',
        'Ngf6',
        'Nxf6+',
        'Nxf6',
      ],
    },
    {
      id: 'sophia-kuan-french-tarrasch',
      name: 'French, Tarrasch',
      tags: ['solid', 'developing'],
      san: ['e4', 'e6', 'd4', 'd5', 'Nd2', 'Nf6', 'e5', 'Nfd7', 'Bd3', 'c5', 'c3', 'Nc6'],
    },
    {
      id: 'sophia-kuan-french-advance',
      name: 'French, Advance',
      tags: ['solid', 'positional'],
      san: ['e4', 'e6', 'd4', 'd5', 'e5', 'c5', 'c3', 'Nc6', 'Nf3', 'Qb6'],
    },
    {
      id: 'sophia-kuan-french-exchange',
      name: 'French, Exchange',
      tags: ['solid'],
      san: ['e4', 'e6', 'd4', 'd5', 'exd5', 'exd5', 'Nf3', 'Nf6', 'Bd3', 'Bd6'],
    },
    {
      id: 'sophia-kuan-qgd',
      name: 'Queen’s Gambit Declined, quiet set-up',
      tags: ['solid', 'positional'],
      weight: 3,
      san: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Nf3', 'Be7', 'Bf4', 'O-O', 'e3', 'c6'],
    },
    {
      id: 'sophia-kuan-vs-london',
      name: '1...d5 versus the London',
      tags: ['solid', 'developing'],
      san: ['d4', 'd5', 'Bf4', 'Nf6', 'e3', 'c5', 'c3', 'Nc6', 'Nf3', 'Qb6'],
    },
  ],
};
