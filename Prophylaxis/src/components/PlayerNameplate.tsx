import { titleForRating, titleSpec, type TitleId } from '../play/titles.ts';

/**
 * A player's name, with the title they earned in front of it.
 *
 * `[GM] First Last (2510)` when titled, `First Last (1720)` when not. The badge
 * carries the title's own colour: yellow for the club badge, red for the master
 * ladder. Used on the board, in the PvP lobby, in reviews and in the account
 * panel, so a name reads the same everywhere.
 */
export function PlayerNameplate({
  name,
  rating,
  title,
  size = 'md',
  className,
  showRating = true,
}: {
  name: string;
  /** Current rating, or a bot's rating. Omitted when unknown. */
  rating?: number | null;
  /** The earned title; bots are titled from their rating instead. */
  title?: TitleId | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  showRating?: boolean;
}) {
  const spec = title ? titleSpec(title) : null;
  const showScore = showRating && typeof rating === 'number' && rating > 0;

  return (
    <span className={`nameplate nameplate--${size}${className ? ` ${className}` : ''}`}>
      {spec ? (
        <span
          className={`nameplate__badge nameplate__badge--${spec.tone}`}
          title={spec.name}
          aria-label={`${spec.name} title`}
        >
          {spec.id}
        </span>
      ) : null}
      <span className="nameplate__name">{name}</span>
      {showScore ? <span className="nameplate__rating">({rating})</span> : null}
    </span>
  );
}

/** The badge alone, for lists and chips that already show the name. */
export function TitleBadge({ title, size = 'md' }: { title: TitleId; size?: 'sm' | 'md' }) {
  const spec = titleSpec(title);
  return (
    <span
      className={`nameplate__badge nameplate__badge--${spec.tone} nameplate__badge--${size}`}
      title={spec.name}
      aria-label={`${spec.name} title`}
    >
      {spec.id}
    </span>
  );
}

/** The title a bot of this rating would hold. */
export function botTitle(rating: number): TitleId | null {
  return titleForRating(rating);
}

export default PlayerNameplate;
