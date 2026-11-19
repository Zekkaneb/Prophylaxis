/**
 * Opening lesson data model + two ready-to-use sample repertoires.
 *
 * Each entry in `moves` is one ply (a half-move), stored as UCI plus the SAN
 * used for display. The lesson player slices these plies into chunks of 3 for
 * a White repertoire and 2 for a Black repertoire.
 */

export type RepertoireColor = 'white' | 'black';

export interface LessonMove {
  /** UCI notation, e.g. `e2e4` or `e7e8q`. Authoritative for validation. */
  uci: string;
  /** SAN for display, e.g. `Nf3`. */
  san: string;
  /** Coaching note shown only while this move's chunk is active. */
  explanation: string;
}

export interface Lesson {
  id: string;
  title: string;
  repertoireColor: RepertoireColor;
  /** Defaults to the standard starting position. */
  startingFen?: string;
  moves: LessonMove[];
}

/** 1. e4 e5 Italian Game (Giuoco Piano), White repertoire. */
export const italianGameLesson: Lesson = {
  id: 'italian-game-main',
  title: 'Italian Game — Giuoco Piano',
  repertoireColor: 'white',
  moves: [
    {
      uci: 'e2e4',
      san: 'e4',
      explanation:
        'Claim the centre and open lines for the bishop and queen. The Italian repertoire is built on this classical e4 pawn.',
    },
    {
      uci: 'e7e5',
      san: 'e5',
      explanation:
        'Black mirrors in the centre. We meet 1...e5 with the Italian: fast development, a big centre and pressure on f7.',
    },
    {
      uci: 'g1f3',
      san: 'Nf3',
      explanation:
        'Develop with tempo. The knight attacks e5 and clears g1 for castling; it is the most flexible second move.',
    },
    {
      uci: 'b8c6',
      san: 'Nc6',
      explanation:
        'Black defends e5 and develops. Note that 2...Nf6 would allow 3.Nxe5, so ...Nc6 is the accurate order.',
    },
    {
      uci: 'f1c4',
      san: 'Bc4',
      explanation:
        'The Italian bishop takes aim at f7, the weakest square in Black\'s camp, and opens the path to castling.',
    },
    {
      uci: 'f8c5',
      san: 'Bc5',
      explanation:
        'Black copies the plan. This is the Giuoco Piano ("quiet game"), but White\'s c3 and d4 ideas give the position real bite.',
    },
    {
      uci: 'c2c3',
      san: 'c3',
      explanation:
        'The main-line Italian: prepare d4 to build the big centre. The pawn on c3 also gives the bishop a retreat on c2 later.',
    },
    {
      uci: 'g8f6',
      san: 'Nf6',
      explanation:
        'Black develops and hits e4. The e4 pawn needs support before White can push d4, so the next move is forced in spirit.',
    },
    {
      uci: 'd2d3',
      san: 'd3',
      explanation:
        'Solid and flexible. d3 protects e4, opens the c1-bishop, and keeps d4 in reserve for the right moment.',
    },
    {
      uci: 'd7d6',
      san: 'd6',
      explanation:
        'Black solidifies e5 and prepares ...Be6 or ...Bg4. The structure is symmetric, but White\'s extra space is a lasting plus.',
    },
    {
      uci: 'e1g1',
      san: 'O-O',
      explanation:
        'King safety first. The rook will come to e1 and the c1-bishop joins via g5 or e3 before White breaks with d4.',
    },
    {
      uci: 'e8g8',
      san: 'O-O',
      explanation:
        'Black castles too. Now White plays Re1, Nbd2 and prepares the central break d4 — the standard Italian plan.',
    },
  ],
};

/** 1. e4 c6 Caro-Kann, Black repertoire. */
export const caroKannLesson: Lesson = {
  id: 'caro-kann-main',
  title: 'Caro-Kann Defence — Main Line',
  repertoireColor: 'black',
  moves: [
    {
      uci: 'e2e4',
      san: 'e4',
      explanation:
        'White takes the centre. Against 1.e4 the Caro-Kann is a rock-solid answer with far less theory than 1...e5.',
    },
    {
      uci: 'c7c6',
      san: 'c6',
      explanation:
        'The Caro-Kann: prepare ...d5 to challenge e4 with pawn support while keeping the c8-bishop\'s diagonal open, unlike the French.',
    },
    {
      uci: 'd2d4',
      san: 'd4',
      explanation:
        'White builds the big centre. Black must hit it immediately, before White consolidates.',
    },
    {
      uci: 'd7d5',
      san: 'd5',
      explanation:
        'Strike at once. Trading on e4 gives Black a comfortable, space-free position — the whole point of the opening.',
    },
    {
      uci: 'b1c3',
      san: 'Nc3',
      explanation:
        'The main line: White defends e4 and eyes d5. (3.e5 and 3.f3 are sidelines you can meet with ...c5 and ...dxe4.)',
    },
    {
      uci: 'd5e4',
      san: 'dxe4',
      explanation:
        'Take while the tension favours you. Black opens the position before White can complete development.',
    },
    {
      uci: 'c3e4',
      san: 'Nxe4',
      explanation:
        'White recaptures. The knight is active on e4 but becomes a target for ...Bf5, ...Nd7 and ...Ngf6.',
    },
    {
      uci: 'c8f5',
      san: 'Bf5',
      explanation:
        'The point of the Caro-Kann: develop the "problem bishop" outside the pawn chain before ...e6. Next ...e6, ...Nf6, ...Be7 and ...O-O.',
    },
  ],
};

export const sampleLessons: Lesson[] = [italianGameLesson, caroKannLesson];
