import { useEffect, useState, type CSSProperties } from 'react';
import { assetUrl } from '../../assets/assetUrl';
import type { OpponentProfile } from '../../play/opponents.ts';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/**
 * Portrait with a monogram fallback.
 *
 * `portraitPath` comes from the opponent catalogue, so every screen shares one
 * mapping. The frame has a fixed size before the image loads, which keeps the
 * cards and player strips from shifting; a missing or broken file falls back to
 * the opponent's initials on the same surface.
 */
export function OpponentAvatar({
  opponent,
  size = 'md',
  loading = 'lazy',
  className,
}: {
  opponent: OpponentProfile;
  size?: AvatarSize;
  loading?: 'eager' | 'lazy';
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [opponent.portraitPath]);

  const src = opponent.portraitPath && !failed ? assetUrl(opponent.portraitPath) : null;
  /* The sleeve reads the zoom off the catalogue, so framing stays data, not a
     per-screen CSS special case. */
  const framing =
    opponent.portraitScale === undefined
      ? undefined
      : ({ '--portrait-scale': String(opponent.portraitScale) } as CSSProperties);

  return (
    <span
      className={[
        'play-avatar',
        `play-avatar--${size}`,
        opponent.kind === 'general' ? 'play-avatar--bot' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-opponent-id={opponent.id}
      style={framing}
      aria-hidden="true"
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading={loading}
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="play-avatar__initial">{opponent.initials}</span>
      )}
    </span>
  );
}
