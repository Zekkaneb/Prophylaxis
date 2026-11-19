import type { ReactElement } from 'react';
import type { PieceRenderObject } from 'react-chessboard';
import { assetUrl } from '../assets/assetUrl';

/**
 * Piece artwork is bundled locally (no network at runtime).
 *
 * SVG sets come from the Lichess piece library (open source, GPL/CC):
 * cburnett → "Staunton", merida → "Merida", alpha → "Alpha",
 * staunty (the modern flat 2D set) → "Neo 2D".
 */

export type PieceSetId = 'staunton' | 'merida' | 'alpha' | 'neo';

export const PIECE_SETS: Record<PieceSetId, { label: string; hint: string }> = {
  staunton: { label: 'Staunton', hint: 'Classic tournament' },
  merida: { label: 'Merida', hint: 'Old-master engraving' },
  alpha: { label: 'Alpha', hint: 'Geometric outline' },
  neo: { label: 'Neo 2D', hint: 'Flat and modern' },
};

/** react-chessboard keys pieces as `<colour><piece>` (`wK`, `bP`, …). */
const PIECE_KEYS = [
  'wK', 'wQ', 'wR', 'wB', 'wN', 'wP',
  'bK', 'bQ', 'bR', 'bB', 'bN', 'bP',
] as const;

const cache = new Map<PieceSetId, PieceRenderObject>();

function renderPiece(src: string): () => ReactElement {
  return () => (
    <img
      src={src}
      alt=""
      width={45}
      height={45}
      draggable={false}
      style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
    />
  );
}

/** Memoised react-chessboard piece map for one set. */
export function buildPieceSet(set: PieceSetId): PieceRenderObject {
  const cached = cache.get(set);
  if (cached) return cached;

  const pieces: PieceRenderObject = {};
  for (const key of PIECE_KEYS) {
    pieces[key] = renderPiece(assetUrl(`pieces/${set}/${key}.svg`));
  }

  cache.set(set, pieces);
  return pieces;
}
