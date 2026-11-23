import type { PersonalityRepertoire } from './types.ts';

/**
 * Monkey's opening: the Hippopotamus System.
 *
 * Transcribed from "The Hippopotamus System A Opening for White AND Black"
 * (chapters 1 and 2, lichess study pcDfeicN). One line per colour, exactly as
 * the study plays it: the full White setup with the b2 sniper bishop, and the
 * Black setup with ...h5 meeting h4 and ...b5 gaining queenside space.
 *
 * The system is deliberately slow: every pawn stays on the third rank, both
 * bishops fianchetto, and the knights sit on d2/e2 (White) or d7/e7 (Black).
 * That is why the line is worth remembering rather than searching — the plan is
 * the same in almost every game, so Monkey's book window is wider than a normal
 * Expert's (`bookPlies` on its style).
 */
export const MONKEY_REPERTOIRE: PersonalityRepertoire = {
  asWhite: [
    {
      id: 'monkey-hippo-white',
      name: 'Hippopotamus, basic setup (White)',
      weight: 3,
      tags: ['positional', 'solid', 'developing'],
      san: [
        'g3', 'c5',
        'Bg2', 'Nc6',
        'd3', 'd5',
        'Nd2', 'e5',
        'b3', 'Be6',
        'Bb2', 'Nf6',
        'a3', 'Qc7',
        'e3', 'Rd8',
        'Ne2',
      ],
    },
  ],
  asBlack: [
    {
      id: 'monkey-hippo-black',
      name: 'Hippopotamus, basic setup (Black)',
      weight: 3,
      tags: ['positional', 'solid', 'developing'],
      san: [
        'e4', 'g6',
        'd4', 'Bg7',
        'Nc3', 'd6',
        'Be3', 'Nd7',
        'Qd2', 'e6',
        'h4', 'h5',
        'Nf3', 'a6',
        'Bd3', 'b5',
        'Bg5', 'Ne7',
        'e5', 'Bb7',
      ],
    },
  ],
};
