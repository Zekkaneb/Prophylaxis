/**
 * Brandon Tran (Freshman), 1600 — the mainline half of his repertoire.
 *
 * His Vienna (White) and French (Black against 1.e4) chapters are *not* written
 * here: they are the immutable compiled entries of `brandonBook.ts`, filtered by
 * chapter prefix in `repertoires/index.ts` and shared with Prime Brandon. This
 * file adds only what the earlier Brandon does differently:
 *
 * 1. Against the Sicilian he plays ordinary Open Sicilian mainlines. There is no
 *    Keres 2.Ne2 here — that study is Prime Brandon's, and it stays his.
 * 2. Against 1.d4 he answers in the centre with ...d5 and a Nimzo-Indian, the
 *    classical replies a 1600 who has studied the Queen's Gambit knows. There is
 *    no Grünfeld chapter here either.
 *
 * Deliberately short, hand-written main lines rather than deep theory: the book
 * ends after the moves below and the engine takes over, which is exactly how a
 * 1600 leaves the opening.
 */

import type { PersonalityRepertoire } from './types.ts';

/** Chapter prefixes of Prime Brandon's compiled book that Freshman shares. */
export const BRANDON_FRESHMAN_SHARED_WHITE_PREFIX = 'brandon-vienna-';
export const BRANDON_FRESHMAN_SHARED_BLACK_PREFIX = 'brandon-french-';

/** Line-id prefixes that must never reach Freshman's book. */
export const BRANDON_FRESHMAN_EXCLUDED_PREFIXES = [
  'brandon-sicilian-',
  'brandon-gruenfeld-',
  'brandon-austrian-',
] as const;

export const BRANDON_FRESHMAN_MAINLINES: PersonalityRepertoire = {
  asWhite: [
    {
      id: 'brandon-freshman-sicilian-najdorf',
      name: 'Open Sicilian, Najdorf',
      san: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Be3', 'e5', 'Nb3', 'Be7', 'f3', 'O-O', 'Qd2'],
      weight: 2,
      tags: ['sharp', 'developing'],
    },
    {
      id: 'brandon-freshman-sicilian-scheveningen',
      name: 'Open Sicilian, Scheveningen',
      san: ['e4', 'c5', 'Nf3', 'e6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'd6', 'Be2', 'Be7', 'O-O', 'O-O', 'f4'],
      weight: 2,
      tags: ['sharp', 'developing'],
    },
    {
      id: 'brandon-freshman-sicilian-classical',
      name: 'Open Sicilian, Classical',
      san: ['e4', 'c5', 'Nf3', 'Nc6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'd6', 'Bg5', 'e6', 'Qd2', 'Be7', 'O-O-O'],
      weight: 1,
      tags: ['sharp', 'initiative'],
    },
    {
      id: 'brandon-freshman-sicilian-dragon',
      name: 'Open Sicilian, Dragon',
      san: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'g6', 'Be3', 'Bg7', 'f3', 'O-O', 'Qd2'],
      weight: 1,
      tags: ['sharp', 'initiative'],
    },
    {
      id: 'brandon-freshman-sicilian-taimanov',
      name: 'Open Sicilian, Taimanov',
      san: ['e4', 'c5', 'Nf3', 'e6', 'd4', 'cxd4', 'Nxd4', 'Nc6', 'Nc3', 'Qc7', 'Be3', 'a6', 'Be2', 'Nf6'],
      weight: 1,
      tags: ['developing', 'solid'],
    },
  ],
  asBlack: [
    {
      id: 'brandon-freshman-qgd',
      name: "Queen's Gambit Declined",
      san: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3', 'O-O', 'Nf3', 'h6', 'Bh4', 'b6'],
      weight: 2,
      tags: ['solid', 'developing'],
    },
    {
      id: 'brandon-freshman-qgd-exchange',
      name: 'QGD, Exchange Variation',
      san: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'cxd5', 'exd5', 'Bg5', 'c6', 'e3', 'Be7'],
      weight: 1,
      tags: ['solid', 'positional'],
    },
    {
      id: 'brandon-freshman-nimzo',
      name: 'Nimzo-Indian Defence',
      san: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4', 'e3', 'O-O', 'Bd3', 'd5', 'Nf3', 'c5', 'O-O'],
      weight: 2,
      tags: ['solid', 'developing'],
    },
    {
      id: 'brandon-freshman-catalan',
      name: 'Closed Catalan',
      san: ['d4', 'Nf6', 'c4', 'e6', 'Nf3', 'd5', 'g3', 'Be7', 'Bg2', 'O-O', 'O-O', 'dxc4'],
      weight: 1,
      tags: ['positional', 'solid'],
    },
    {
      id: 'brandon-freshman-london',
      name: 'Queen’s-pawn set-up vs the London',
      san: ['d4', 'd5', 'Nf3', 'Nf6', 'Bf4', 'e6', 'e3', 'Bd6', 'Bg3', 'O-O'],
      weight: 1,
      tags: ['solid', 'developing'],
    },
  ],
};
