import type { PersonalityRepertoire } from './types.ts';

/**
 * Jonah Pachikara, 1400 — the silent threat.
 *
 * - White: the Jobava London. 1.d4, the dark-squared bishop outside the chain
 *   on f4, the queenside knight to c3, a solid centre, then quiet pressure.
 * - Black vs 1.e4: the Scandinavian, 1...d5, with the main ...Qxd5 lines
 *   (3...Qa5 and 3...Qd8) and the ...Nf6 recapture, written from the supplied
 *   theory rather than invented.
 * - Black vs 1.d4: 1...d5, principled Queen's Gambit Declined structure, plus a
 *   calm answer to the London.
 *
 * The lines stop well short of deep theory; outside them the ordinary
 * personality selection and engine fallback take over. Nothing here duplicates
 * another opponent's line.
 */
export const JONAH_PACHIKARA_REPERTOIRE: PersonalityRepertoire = {
  asWhite: [
    {
      id: 'jonah-pachikara-jobava-main',
      name: 'Jobava London, main set-up',
      tags: ['positional', 'developing', 'solid'],
      weight: 3,
      san: ['d4', 'd5', 'Nc3', 'Nf6', 'Bf4', 'e6', 'e3', 'c5', 'Nf3', 'Nc6', 'Be2', 'Bd6', 'Bg3', 'O-O'],
    },
    {
      id: 'jonah-pachikara-jobava-kid',
      name: 'Jobava London versus ...g6',
      tags: ['positional', 'developing'],
      san: ['d4', 'Nf6', 'Nc3', 'd5', 'Bf4', 'g6', 'e3', 'Bg7', 'Nf3', 'O-O', 'Be2', 'c5', 'O-O', 'Nc6'],
    },
    {
      id: 'jonah-pachikara-jobava-c5',
      name: 'Jobava London with ...c5',
      tags: ['positional', 'solid'],
      san: ['d4', 'd5', 'Bf4', 'Nf6', 'Nc3', 'c5', 'e3', 'Nc6', 'Nf3', 'e6', 'Be2', 'Bd6'],
    },
  ],
  asBlack: [
    {
      id: 'jonah-pachikara-scandi-qa5',
      name: 'Scandinavian, ...Qa5 main line',
      tags: ['positional', 'developing'],
      weight: 3,
      san: [
        'e4',
        'd5',
        'exd5',
        'Qxd5',
        'Nc3',
        'Qa5',
        'd4',
        'Nf6',
        'Nf3',
        'Bg4',
        'h3',
        'Bh5',
        'Be2',
        'Nc6',
        'O-O',
        'O-O-O',
        'Be3',
        'e5',
      ],
    },
    {
      id: 'jonah-pachikara-scandi-qd8',
      name: 'Scandinavian, ...Qd8',
      tags: ['positional', 'developing'],
      san: [
        'e4',
        'd5',
        'exd5',
        'Qxd5',
        'Nc3',
        'Qd8',
        'd4',
        'Nf6',
        'Nf3',
        'Bg4',
        'Be2',
        'e6',
        'O-O',
        'Nc6',
      ],
    },
    {
      id: 'jonah-pachikara-scandi-nf6',
      name: 'Scandinavian with ...Nf6',
      tags: ['solid', 'developing'],
      san: ['e4', 'd5', 'exd5', 'Nf6', 'd4', 'Nxd5', 'Nf3', 'Bf5', 'Be2', 'e6', 'O-O', 'Be7'],
    },
    {
      id: 'jonah-pachikara-qgd',
      name: 'Queen’s Gambit Declined, quiet pressure',
      tags: ['positional', 'solid'],
      weight: 3,
      san: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bf4', 'c5', 'e3', 'Nc6', 'Nf3', 'Bd6', 'Bg3', 'O-O'],
    },
    {
      id: 'jonah-pachikara-vs-london',
      name: '1...d5 versus the London',
      tags: ['positional', 'developing'],
      san: ['d4', 'd5', 'Bf4', 'Nf6', 'e3', 'c5', 'c3', 'Nc6', 'Nf3', 'e6', 'Nbd2', 'Bd6'],
    },
  ],
};
