import { Chess } from 'chess.js';
import { assetUrl } from '../assets/assetUrl';

/**
 * A compact, offline ECO opening book.
 *
 * Each line is stored as SAN moves from the initial position. On module load we
 * replay every line once with chess.js and index every resulting position by a
 * normalised FEN (board, side to move, castling rights, en-passant target), so
 * transpositions resolve to the same entry. Lookups are O(1) and never touch
 * the engine or the network.
 */

export interface OpeningLine {
  /** ECO code, e.g. `C50`. */
  eco: string;
  /** Human readable variation name. */
  name: string;
  /** SAN moves from the starting position. */
  moves: string[];
}

/** Book moves are only accepted inside the opening (plies from the start). */
export const BOOK_PLY_LIMIT = 24;

export const OPENING_BOOK: OpeningLine[] = [
  /* ------------------------------ 1.e4 e5 ------------------------------- */
  { eco: 'C50', name: "Italian Game", moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'] },
  { eco: 'C50', name: "Giuoco Piano", moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd4', 'exd4'] },
  { eco: 'C50', name: "Giuoco Pianissimo", moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'd3', 'Nf6', 'c3', 'd6'] },
  { eco: 'C51', name: "Evans Gambit", moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'b4'] },
  { eco: 'C51', name: "Evans Gambit Accepted", moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'b4', 'Bxb4', 'c3', 'Ba5', 'd4'] },
  { eco: 'C55', name: "Two Knights Defence", moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6'] },
  { eco: 'C57', name: "Two Knights: Fried Liver Attack", moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5', 'd5', 'exd5', 'Nxd5', 'Nxf7'] },
  { eco: 'C58', name: "Two Knights: Polerio", moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5', 'd5', 'exd5', 'Na5'] },
  { eco: 'C60', name: "Ruy Lopez", moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'] },
  { eco: 'C65', name: "Ruy Lopez: Morphy Defence", moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4'] },
  { eco: 'C65', name: "Ruy Lopez: Berlin Defence", moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6'] },
  { eco: 'C67', name: "Ruy Lopez: Berlin, Rio Gambit", moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6', 'O-O', 'Nxe4'] },
  { eco: 'C84', name: "Ruy Lopez: Closed", moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7'] },
  { eco: 'C89', name: "Ruy Lopez: Marshall Attack", moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'O-O', 'c3', 'd5'] },
  { eco: 'C45', name: "Scotch Game", moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4'] },
  { eco: 'C45', name: "Scotch: Mieses Variation", moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4', 'Nf6', 'Nxc6', 'bxc6', 'e5', 'Qe7'] },
  { eco: 'C47', name: "Four Knights Game", moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Nc3', 'Nf6'] },
  { eco: 'C49', name: "Four Knights: Double Spanish", moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Nc3', 'Nf6', 'Bb5', 'Bb4'] },
  { eco: 'C46', name: "Three Knights Game", moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Nc3'] },
  { eco: 'C42', name: "Petrov Defence", moves: ['e4', 'e5', 'Nf3', 'Nf6', 'Nxe5'] },
  { eco: 'C43', name: "Petrov: Steinitz Attack", moves: ['e4', 'e5', 'Nf3', 'Nf6', 'Nxe5', 'd6', 'Nf3', 'Nxe4', 'd4', 'd5'] },
  { eco: 'C30', name: "King's Gambit", moves: ['e4', 'e5', 'f4'] },
  { eco: 'C33', name: "King's Gambit Accepted", moves: ['e4', 'e5', 'f4', 'exf4'] },
  { eco: 'C33', name: "King's Gambit: Bishop's Gambit", moves: ['e4', 'e5', 'f4', 'exf4', 'Bc4'] },
  { eco: 'C34', name: "King's Gambit: Kieseritzky", moves: ['e4', 'e5', 'f4', 'exf4', 'Nf3', 'g5', 'h4', 'g4'] },
  { eco: 'C25', name: "Vienna Game", moves: ['e4', 'e5', 'Nc3'] },
  { eco: 'C29', name: "Vienna Gambit", moves: ['e4', 'e5', 'Nc3', 'Nf6', 'f4'] },
  { eco: 'C23', name: "Bishop's Opening", moves: ['e4', 'e5', 'Bc4'] },
  { eco: 'C21', name: "Danish Gambit", moves: ['e4', 'e5', 'd4', 'exd4', 'c3'] },
  { eco: 'C21', name: "Centre Game", moves: ['e4', 'e5', 'd4', 'exd4', 'Qxd4'] },
  { eco: 'C44', name: "Ponziani Opening", moves: ['e4', 'e5', 'Nf3', 'Nc6', 'c3'] },
  { eco: 'C41', name: "Philidor Defence", moves: ['e4', 'e5', 'Nf3', 'd6'] },
  { eco: 'C41', name: "Philidor: Hanham Variation", moves: ['e4', 'e5', 'Nf3', 'd6', 'd4', 'Nf6', 'Nc3', 'Nbd7'] },

  /* -------------------------- 1.d4 d5 / Queen's ------------------------- */
  { eco: 'D00', name: "Queen's Pawn Game", moves: ['d4', 'd5'] },
  { eco: 'D02', name: "London System", moves: ['d4', 'd5', 'Bf4'] },
  { eco: 'D02', name: "London System vs 1...Nf6", moves: ['d4', 'Nf6', 'Bf4'] },
  { eco: 'D04', name: "Colle System", moves: ['d4', 'd5', 'Nf3', 'Nf6', 'e3'] },
  { eco: 'D06', name: "Queen's Gambit", moves: ['d4', 'd5', 'c4'] },
  { eco: 'D20', name: "Queen's Gambit Accepted", moves: ['d4', 'd5', 'c4', 'dxc4'] },
  { eco: 'D30', name: "Queen's Gambit Declined", moves: ['d4', 'd5', 'c4', 'e6'] },
  { eco: 'D35', name: "QGD: Exchange Variation", moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'cxd5', 'exd5'] },
  { eco: 'D37', name: "QGD: Three Knights", moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Nf3'] },
  { eco: 'D53', name: "QGD: Orthodox Defence", moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Nf3', 'Be7', 'Bg5'] },
  { eco: 'D58', name: "QGD: Tartakower Defence", moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3', 'O-O', 'Nf3', 'h6', 'Bh4', 'b6'] },
  { eco: 'D10', name: "Slav Defence", moves: ['d4', 'd5', 'c4', 'c6'] },
  { eco: 'D15', name: "Slav: Three Knights", moves: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3'] },
  { eco: 'D17', name: "Slav: Czech Variation", moves: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'dxc4', 'a4', 'Bf5'] },
  { eco: 'D43', name: "Semi-Slav Defence", moves: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'e6'] },
  { eco: 'D44', name: "Semi-Slav: Botvinnik Variation", moves: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'e6', 'Bg5', 'dxc4', 'e4', 'b5', 'e5', 'h6'] },
  { eco: 'D32', name: "Tarrasch Defence", moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'c5'] },
  { eco: 'D07', name: "Chigorin Defence", moves: ['d4', 'd5', 'c4', 'Nc6'] },
  { eco: 'D08', name: "Albin Counter-Gambit", moves: ['d4', 'd5', 'c4', 'e5'] },
  { eco: 'A45', name: "Trompowsky Attack", moves: ['d4', 'Nf6', 'Bg5'] },
  { eco: 'A46', name: "Torre Attack", moves: ['d4', 'Nf6', 'Nf3', 'e6', 'Bg5'] },

  /* ------------------------- Indian / fianchetto ------------------------ */
  { eco: 'E00', name: "Catalan Opening", moves: ['d4', 'Nf6', 'c4', 'e6', 'g3'] },
  { eco: 'E06', name: "Catalan: Closed", moves: ['d4', 'Nf6', 'c4', 'e6', 'g3', 'd5', 'Bg2'] },
  { eco: 'E20', name: "Nimzo-Indian Defence", moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'] },
  { eco: 'E40', name: "Nimzo-Indian: Rubinstein", moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4', 'e3'] },
  { eco: 'E12', name: "Queen's Indian Defence", moves: ['d4', 'Nf6', 'c4', 'e6', 'Nf3', 'b6'] },
  { eco: 'E15', name: "Queen's Indian: 4.g3", moves: ['d4', 'Nf6', 'c4', 'e6', 'Nf3', 'b6', 'g3'] },
  { eco: 'E60', name: "King's Indian Defence", moves: ['d4', 'Nf6', 'c4', 'g6'] },
  { eco: 'E70', name: "King's Indian: 4.e4", moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6'] },
  { eco: 'E80', name: "King's Indian: Sämisch", moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'f3'] },
  { eco: 'E90', name: "King's Indian: Classical", moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3'] },
  { eco: 'E97', name: "King's Indian: Mar del Plata", moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3', 'O-O', 'Be2', 'e5', 'O-O', 'Nc6', 'd5'] },
  { eco: 'D80', name: "Grünfeld Defence", moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'd5'] },
  { eco: 'D85', name: "Grünfeld: Exchange", moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'd5', 'cxd5', 'Nxd5'] },
  { eco: 'D86', name: "Grünfeld: Exchange, Classical", moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'd5', 'cxd5', 'Nxd5', 'e4', 'Nxc3', 'bxc3', 'Bg7', 'Bc4'] },
  { eco: 'A57', name: "Benko Gambit", moves: ['d4', 'Nf6', 'c4', 'c5', 'd5', 'b5'] },
  { eco: 'A58', name: "Benko Gambit Accepted", moves: ['d4', 'Nf6', 'c4', 'c5', 'd5', 'b5', 'cxb5', 'a6'] },
  { eco: 'A60', name: "Benoni Defence", moves: ['d4', 'Nf6', 'c4', 'c5', 'd5', 'e6'] },
  { eco: 'A70', name: "Benoni: Classical", moves: ['d4', 'Nf6', 'c4', 'c5', 'd5', 'e6', 'Nc3', 'exd5', 'cxd5', 'd6', 'e4', 'g6', 'Nf3', 'Bg7'] },
  { eco: 'A51', name: "Budapest Gambit", moves: ['d4', 'Nf6', 'c4', 'e5'] },
  { eco: 'A53', name: "Old Indian Defence", moves: ['d4', 'Nf6', 'c4', 'd6'] },
  { eco: 'A80', name: "Dutch Defence", moves: ['d4', 'f5'] },
  { eco: 'A87', name: "Dutch: Leningrad", moves: ['d4', 'f5', 'c4', 'Nf6', 'Nc3', 'g6', 'Nf3', 'Bg7'] },
  { eco: 'A90', name: "Dutch: Stonewall", moves: ['d4', 'f5', 'g3', 'Nf6', 'Bg2', 'e6', 'Nf3', 'd5'] },

  /* ------------------------------- Sicilian ----------------------------- */
  { eco: 'B20', name: "Sicilian Defence", moves: ['e4', 'c5'] },
  { eco: 'B20', name: "Sicilian: Bowdler Attack", moves: ['e4', 'c5', 'Bc4'] },
  { eco: 'B90', name: "Sicilian: Najdorf", moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'] },
  { eco: 'B70', name: "Sicilian: Dragon", moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'g6'] },
  { eco: 'B76', name: "Sicilian: Dragon, Yugoslav Attack", moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'g6', 'Be3', 'Bg7', 'f3', 'O-O', 'Qd2'] },
  { eco: 'B56', name: "Sicilian: Classical", moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'Nc6'] },
  { eco: 'B33', name: "Sicilian: Sveshnikov", moves: ['e4', 'c5', 'Nf3', 'Nc6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'e5'] },
  { eco: 'B80', name: "Sicilian: Scheveningen", moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'e6'] },
  { eco: 'B47', name: "Sicilian: Taimanov", moves: ['e4', 'c5', 'Nf3', 'e6', 'd4', 'cxd4', 'Nxd4', 'Nc6'] },
  { eco: 'B22', name: "Sicilian: Alapin", moves: ['e4', 'c5', 'c3'] },
  { eco: 'B22', name: "Sicilian: Alapin, 2...Nf6", moves: ['e4', 'c5', 'c3', 'Nf6', 'e5', 'Nd5'] },
  { eco: 'B31', name: "Sicilian: Rossolimo", moves: ['e4', 'c5', 'Nf3', 'Nc6', 'Bb5'] },
  { eco: 'B23', name: "Sicilian: Closed", moves: ['e4', 'c5', 'Nc3'] },
  { eco: 'B24', name: "Sicilian: Closed, Fianchetto", moves: ['e4', 'c5', 'Nc3', 'Nc6', 'g3'] },
  { eco: 'B21', name: "Sicilian: Smith-Morra Gambit", moves: ['e4', 'c5', 'd4', 'cxd4', 'c3'] },
  { eco: 'B51', name: "Sicilian: Moscow Variation", moves: ['e4', 'c5', 'Nf3', 'd6', 'Bb5+'] },
  { eco: 'B40', name: "Sicilian: Four Knights", moves: ['e4', 'c5', 'Nf3', 'e6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3'] },

  /* -------------------------------- French ------------------------------ */
  { eco: 'C00', name: "French Defence", moves: ['e4', 'e6'] },
  { eco: 'C02', name: "French: Advance", moves: ['e4', 'e6', 'd4', 'd5', 'e5'] },
  { eco: 'C03', name: "French: Tarrasch", moves: ['e4', 'e6', 'd4', 'd5', 'Nd2'] },
  { eco: 'C10', name: "French: Rubinstein", moves: ['e4', 'e6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4'] },
  { eco: 'C11', name: "French: Classical", moves: ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Nf6'] },
  { eco: 'C15', name: "French: Winawer", moves: ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Bb4'] },
  { eco: 'C18', name: "French: Winawer, 4.e5", moves: ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Bb4', 'e5', 'c5', 'a3', 'Bxc3+', 'bxc3'] },
  { eco: 'C01', name: "French: Exchange", moves: ['e4', 'e6', 'd4', 'd5', 'exd5', 'exd5'] },

  /* ------------------------------ Caro-Kann ----------------------------- */
  { eco: 'B10', name: "Caro-Kann Defence", moves: ['e4', 'c6'] },
  { eco: 'B12', name: "Caro-Kann: Advance", moves: ['e4', 'c6', 'd4', 'd5', 'e5'] },
  { eco: 'B13', name: "Caro-Kann: Exchange", moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5'] },
  { eco: 'B13', name: "Caro-Kann: Panov-Botvinnik", moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'c4'] },
  { eco: 'B18', name: "Caro-Kann: Classical", moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6'] },
  { eco: 'B17', name: "Caro-Kann: Steinitz", moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Nd7'] },
  { eco: 'B10', name: "Caro-Kann: Two Knights", moves: ['e4', 'c6', 'Nc3', 'd5', 'Nf3'] },

  /* --------------------------- Other 1.e4 ------------------------------- */
  { eco: 'B01', name: "Scandinavian Defence", moves: ['e4', 'd5'] },
  { eco: 'B01', name: "Scandinavian: 2...Qxd5", moves: ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5'] },
  { eco: 'B02', name: "Alekhine Defence", moves: ['e4', 'Nf6'] },
  { eco: 'B04', name: "Alekhine: Modern", moves: ['e4', 'Nf6', 'e5', 'Nd5', 'd4', 'd6'] },
  { eco: 'B03', name: "Alekhine: Four Pawns Attack", moves: ['e4', 'Nf6', 'e5', 'Nd5', 'd4', 'd6', 'c4', 'Nb6', 'f4'] },
  { eco: 'B07', name: "Pirc Defence", moves: ['e4', 'd6', 'd4', 'Nf6', 'Nc3'] },
  { eco: 'B08', name: "Pirc: Classical", moves: ['e4', 'd6', 'd4', 'Nf6', 'Nc3', 'g6', 'Nf3', 'Bg7'] },
  { eco: 'B06', name: "Modern Defence", moves: ['e4', 'g6'] },

  /* ------------------------- Flank / closed opens ----------------------- */
  { eco: 'A10', name: "English Opening", moves: ['c4'] },
  { eco: 'A20', name: "English: Reversed Sicilian", moves: ['c4', 'e5'] },
  { eco: 'A28', name: "English: Four Knights", moves: ['c4', 'e5', 'Nc3', 'Nf6', 'Nf3', 'Nc6'] },
  { eco: 'A30', name: "English: Symmetrical", moves: ['c4', 'c5'] },
  { eco: 'A16', name: "English: 1...Nf6", moves: ['c4', 'Nf6', 'Nf3', 'g6'] },
  { eco: 'A04', name: "Réti Opening", moves: ['Nf3'] },
  { eco: 'A07', name: "King's Indian Attack", moves: ['Nf3', 'd5', 'g3'] },
  { eco: 'A09', name: "Réti: Advance", moves: ['Nf3', 'd5', 'c4'] },
  { eco: 'A02', name: "Bird's Opening", moves: ['f4'] },
  { eco: 'A01', name: "Nimzo-Larsen Attack", moves: ['b3'] },
];

/* -------------------------------------------------------------------------- */
/*                                  Lookup                                    */
/* -------------------------------------------------------------------------- */

/**
 * Book key: `[board] [turn] [castling]`.
 *
 * Half-move counters and the en-passant square are dropped so move-order
transpositions resolve to the same entry (and so the keys match
`/public/openings.json`, which is generated with the same shape).
 */
export function normalizeBookFen(fen: string): string {
  return fen.split(' ').slice(0, 3).join(' ');
}

export interface BookMatch {
  eco: string;
  name: string;
  /** Plies from the initial position to this position. */
  plies: number;
  /** SAN moves that keep play inside this book. */
  nextMoves: string[];
}

interface IndexedPosition {
  eco: string;
  name: string;
  plies: number;
  nextMoves: Set<string>;
}

const bookByFen = new Map<string, IndexedPosition>();

for (const line of OPENING_BOOK) {
  const game = new Chess();
  let previousKey: string | null = null;

  line.moves.forEach((san, index) => {
    let played;
    try {
      played = game.move(san);
    } catch {
      // A malformed line should never break the app; skip the rest of it.
      return;
    }

    if (previousKey) {
      bookByFen.get(previousKey)?.nextMoves.add(played.san);
    }

    const key = normalizeBookFen(game.fen());
    const existing = bookByFen.get(key);
    if (existing) {
      if (index + 1 > existing.plies) {
        existing.eco = line.eco;
        existing.name = line.name;
        existing.plies = index + 1;
      }
    } else {
      bookByFen.set(key, {
        eco: line.eco,
        name: line.name,
        plies: index + 1,
        nextMoves: new Set<string>(),
      });
    }

    previousKey = key;
  });
}

/**
 * Returns the opening entry for a position, or null when the position is not in
 * the book. The position is matched by board + side to move + castling + ep.
 */
export function lookupBookMove(fen: string): BookMatch | null {
  const entry = bookByFen.get(normalizeBookFen(fen));
  if (!entry) return null;
  return {
    eco: entry.eco,
    name: entry.name,
    plies: entry.plies,
    nextMoves: [...entry.nextMoves],
  };
}

export interface DetectedOpening {
  eco: string;
  name: string;
  plies: number;
}

/**
 * Scans a game's positions and returns the deepest book position, i.e. the most
 * specific opening name reached. Stored reviews can be labelled without the
 * engine or the original PGN.
 */
export function detectOpening(fens: string[]): DetectedOpening | null {
  let best: DetectedOpening | null = null;
  let bestDepth = -1;

  fens.forEach((fen, index) => {
    const match = lookupBookMove(fen);
    if (!match) return;
    // Generated entries have no ply metadata, so position in the scan stands in
    // for depth; later positions are more specific than earlier ones.
    const depth = match.plies > 0 ? match.plies : index + 1;
    if (depth >= bestDepth) {
      bestDepth = depth;
      best = { eco: match.eco, name: match.name, plies: depth };
    }
  });

  return best;
}

/* -------------------------------------------------------------------------- */
/*                         Lichess file loader                                */
/* -------------------------------------------------------------------------- */

export type OpeningBookSource = 'fallback' | 'file';

export interface OpeningBookStats {
  source: OpeningBookSource;
  positions: number;
}

let bookSource: OpeningBookSource = 'fallback';
let loadPromise: Promise<void> | null = null;

/**
 * Fetches `/openings.json` — generated by `scripts/build-openings.mjs` from the
 * Lichess `chess-openings` TSVs — and merges it into the index.
 *
 * The curated fallback above always stays available, so reviews keep working
 * before the file exists, offline, or when the request fails.
 */
export function loadOpeningBook(): Promise<void> {
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const response = await fetch(assetUrl('openings.json'));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as Record<
        string,
        { eco?: string; name?: string } | undefined
      >;
      let merged = 0;

      for (const [fen, value] of Object.entries(data)) {
        if (!value || typeof value.eco !== 'string' || typeof value.name !== 'string') continue;
        const key = normalizeBookFen(fen);
        if (bookByFen.has(key)) continue;
        bookByFen.set(key, {
          eco: value.eco,
          name: value.name,
          // Depth is unknown for generated entries; detectOpening uses scan order.
          plies: 0,
          nextMoves: new Set<string>(),
        });
        merged += 1;
      }

      bookSource = 'file';
      console.info(`Opening book: merged ${merged} Lichess positions (${bookByFen.size} total).`);
    } catch (cause) {
      console.info('Opening book: keeping the built-in fallback.', cause);
    }
  })();

  return loadPromise;
}

export function getOpeningBookStats(): OpeningBookStats {
  return { source: bookSource, positions: bookByFen.size };
}
