import { assetUrl } from '../../assets/assetUrl';
import { useAppearance } from '../../theme/ThemeProvider';

const PIECE_NAME: Record<string, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
};

export interface CapturedPiecesProps {
  /** Pieces this side has captured, pawns first. */
  pieces: readonly string[];
  /** Colour of those pieces: the side that lost them. */
  color: 'w' | 'b';
  /** Material this side is ahead by, in pawns. Zero or less shows no badge. */
  advantage: number;
}

/**
 * The captured-material row beside a nameplate: the opponent's pieces in the
 * order they went, then the lead as a `+3`, the way a live game board reads.
 *
 * The icons use the player's own piece set, so this never restyles the board.
 * A side that is behind still shows what it has taken; only the leader carries
 * the number, which is what keeps the row from saying the same thing twice.
 */
export function CapturedPieces({ pieces, color, advantage }: CapturedPiecesProps) {
  const { appearance } = useAppearance();
  /* Empty, but still there: the row's height is reserved from the first render,
     so the first capture fills it instead of pushing the board down. */
  if (pieces.length === 0 && advantage <= 0) {
    return <span className="captured" aria-hidden="true" />;
  }

  const label = [
    pieces.length > 0
      ? `Captured ${pieces.map((piece) => PIECE_NAME[piece] ?? 'piece').join(', ')}`
      : null,
    advantage > 0 ? `+${advantage} material` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <span className="captured" role="img" aria-label={label}>
      <span className="captured__pieces" aria-hidden="true">
        {pieces.map((piece, index) => (
          <img
            /* The same piece can be taken more than once; the index keeps the
               key stable across renders as the list grows. */
            key={`${piece}-${index}`}
            className="captured__piece"
            src={assetUrl(`pieces/${appearance.pieceSet}/${color}${piece.toUpperCase()}.svg`)}
            alt=""
            width={16}
            height={16}
            draggable={false}
          />
        ))}
      </span>
      {advantage > 0 ? (
        <span className="captured__score" aria-hidden="true">
          +{advantage}
        </span>
      ) : null}
    </span>
  );
}
