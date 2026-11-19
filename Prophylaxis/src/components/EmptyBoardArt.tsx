/**
 * A small, quiet board motif for empty states. It is decorative only: the
 * heading and copy beside it carry the meaning for assistive technology.
 */
export default function EmptyBoardArt({ glyph = '♞' }: { glyph?: string }) {
  return (
    <div className="empty-art" aria-hidden="true">
      <span className="empty-art__grid" />
      <span className="empty-art__piece">{glyph}</span>
    </div>
  );
}
