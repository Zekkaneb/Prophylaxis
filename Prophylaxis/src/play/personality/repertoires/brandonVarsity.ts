import type { PersonalityRepertoire } from './types.ts';

/**
 * Brandon Tran (Sophomore), 1850 — the funky attacker, between Freshman and Prime.
 *
 * - White: the Vienna Game, but the sharp one — the Vienna Gambit with 3.f4,
 *   and a Bc4/Ng5 line that keeps the initiative without gambling a pawn.
 * - Black vs 1.e4: the French, 1...e6, played as a counterattacking system: the
 *   Winawer with the bishop trade on c3, and the open Tarrasch with ...c5.
 * - Black vs 1.d4: 1...d5 only. A Queen's Gambit Accepted line and a calm
 *   answer to the London — deliberately no Grünfeld, which belongs to Prime.
 *
 * The lines are short and principled; outside them the ordinary engine choice
 * and his tendencies play. Nothing here duplicates another opponent's line.
 */
export const BRANDON_VARSITY_REPERTOIRE: PersonalityRepertoire = {
  asWhite: [
    {
      id: 'brandon-varsity-vienna-gambit',
      name: 'Vienna Gambit, main line',
      tags: ['sharp', 'initiative', 'developing'],
      weight: 3,
      san: ['e4', 'e5', 'Nc3', 'Nf6', 'f4', 'd5', 'fxe5', 'Nxe4', 'Qf3'],
    },
    {
      id: 'brandon-varsity-vienna-gambit-f4',
      name: 'Vienna Gambit, ...exf4',
      tags: ['sharp', 'initiative'],
      san: ['e4', 'e5', 'Nc3', 'Nf6', 'f4', 'exf4', 'Nf3', 'd5', 'd4'],
    },
    {
      id: 'brandon-varsity-vienna-bc4',
      name: 'Vienna with Bc4 and Ng5',
      tags: ['initiative', 'developing', 'sharp'],
      san: ['e4', 'e5', 'Nc3', 'Nf6', 'Bc4', 'Bc5', 'Nf3', 'Nc6', 'Ng5'],
    },
  ],
  asBlack: [
    {
      id: 'brandon-varsity-french-winawer',
      name: 'French, Winawer counterattack',
      tags: ['sharp', 'initiative'],
      weight: 3,
      san: ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Bb4', 'e5', 'c5', 'a3', 'Bxc3+', 'bxc3'],
    },
    {
      id: 'brandon-varsity-french-tarrasch-open',
      name: 'French, open Tarrasch',
      tags: ['sharp', 'initiative'],
      san: ['e4', 'e6', 'd4', 'd5', 'Nd2', 'c5', 'exd5', 'exd5', 'Ngf3', 'Nc6'],
    },
    {
      id: 'brandon-varsity-french-advance-active',
      name: 'French, Advance with active pieces',
      tags: ['positional', 'initiative'],
      san: ['e4', 'e6', 'd4', 'd5', 'e5', 'c5', 'c3', 'Nc6', 'Nf3', 'Nge7'],
    },
    {
      id: 'brandon-varsity-qga',
      name: 'Queen’s Gambit Accepted, active development',
      tags: ['sharp', 'developing'],
      weight: 3,
      san: ['d4', 'd5', 'c4', 'dxc4', 'Nf3', 'Nf6', 'e3', 'e6', 'Bxc4', 'c5', 'O-O', 'a6', 'Qe2'],
    },
    {
      id: 'brandon-varsity-vs-london',
      name: '1...d5 versus the London',
      tags: ['solid', 'developing'],
      san: ['d4', 'd5', 'Bf4', 'Nf6', 'e3', 'c5', 'c3', 'Nc6', 'Nd2', 'e6'],
    },
  ],
};
