import { useCallback, useEffect, useState } from 'react';
import { deletePlayedGame, downloadPgn, listPlayedGames } from '../../play/gameStore';
import { getOpponent, opponentFullName, opponentMeta, profileFromRecord } from '../../play/opponents.ts';
import {
  formatDateTime,
  formatDuration,
  timeControlLabel,
} from '../../play/timeControls.ts';
import {
  gameOutcome,
  resultReasonLabel,
  type PlayedGameRecord,
} from '../../play/types.ts';
import { OpponentAvatar } from './OpponentAvatar';

export interface HistoryViewProps {
  onStartGame: () => void;
  onOpenGame: (gameId: string) => void;
}

/**
 * Finished games, stored in Dexie by the playing hook. Selecting a row opens
 * the review screen; export and delete stay one click away without competing
 * with the result.
 */
export function HistoryView({ onStartGame, onOpenGame }: HistoryViewProps) {
  const [games, setGames] = useState<PlayedGameRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setGames(await listPlayedGames());
    } catch {
      setError('Game history could not be read from local storage.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(gameId: string) {
    try {
      /* Only the archive row: an unfinished game lives in `active_game`. */
      await deletePlayedGame(gameId);
      setGames((current) => current.filter((game) => game.game_id !== gameId));
      setConfirmId(null);
    } catch {
      setError('That game could not be deleted.');
    }
  }

  return (
    <section className="play-history" aria-labelledby="play-history-title">
      <div className="play-history__head">
        <div>
          <p className="play-eyebrow">Archive</p>
          <h2 id="play-history-title">Game History</h2>
        </div>
        <div className="play-history__head-actions">
          <span className="play-history__count">
            {games.length} {games.length === 1 ? 'game' : 'games'}
          </span>
          <button type="button" className="secondary-btn" onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="play-error" role="alert">
          {error}
          <button type="button" onClick={() => void load()}>
            Try again
          </button>
        </div>
      ) : null}

      {loading ? (
        <ul className="play-history__list" aria-label="Loading saved games">
          {[0, 1, 2].map((row) => (
            <li key={row} className="play-history__row play-history__row--loading">
              <span className="play-skeleton play-skeleton--avatar" />
              <span className="play-skeleton play-skeleton--line" />
              <span className="play-skeleton play-skeleton--pill" />
            </li>
          ))}
        </ul>
      ) : games.length === 0 ? (
        <div className="play-history__empty">
          <span className="play-history__empty-mark" aria-hidden="true">
            ♟
          </span>
          <p className="play-eyebrow">Nothing here yet</p>
          <h3>Your finished games will appear here</h3>
          <p>Every result is stored locally, with its clocks, moves and PGN.</p>
          <button type="button" className="primary-btn" onClick={onStartGame}>
            Play your first game
          </button>
        </div>
      ) : (
        <ul className="play-history__list">
          {games.map((game) => {
            const outcome = gameOutcome(game);
            const botMatch = game.mode === 'bot-vs-bot';
            const opponent =
              (botMatch && game.black_opponent_id
                ? getOpponent(game.black_opponent_id)
                : undefined) ?? profileFromRecord(game);
            const whiteBot = botMatch && game.white_opponent_id
              ? getOpponent(game.white_opponent_id)
              : undefined;
            const blackBot = botMatch && game.black_opponent_id
              ? getOpponent(game.black_opponent_id)
              : undefined;
            const confirming = confirmId === game.game_id;
            const title = botMatch
              ? `${whiteBot ? opponentFullName(whiteBot) : (game.white_name ?? 'White')} vs ${blackBot ? opponentFullName(blackBot) : (game.black_name ?? 'Black')}`
              : opponent.name;
            const reviewLabel = botMatch ? title : opponentFullName(opponent);
            return (
              <li key={game.game_id} className="play-history__row">
                <button
                  type="button"
                  className="play-history__open"
                  onClick={() => onOpenGame(game.game_id)}
                  aria-label={botMatch ? `Review ${reviewLabel}` : `Review your game against ${reviewLabel}`}
                >
                  <OpponentAvatar opponent={opponent} size="sm" />
                  <span className="play-history__who">
                    <span className="play-history__name">{title}</span>
                    <span className="play-history__meta">
                      {botMatch
                        ? `${whiteBot?.title ?? 'White'} vs ${blackBot?.title ?? 'Black'} · Bot vs. Bot`
                        : opponentMeta(opponent)}{' '}
                      · {timeControlLabel(game.initial_seconds, game.increment_seconds)} ·{' '}
                      {formatDuration(game.duration_seconds)}
                    </span>
                  </span>
                  <span className="play-history__when">{formatDateTime(game.ended_at)}</span>
                  <span
                    className={`play-history__result is-${botMatch ? 'draw' : outcome.tone}`}
                    title={resultReasonLabel(game.reason)}
                  >
                    <span className="play-history__result-label">
                      {botMatch ? 'Bot match' : outcome.label}
                    </span>
                    <span className="play-history__score">
                      {botMatch ? game.result : outcome.score}
                    </span>
                  </span>
                  <span className="play-history__chevron" aria-hidden="true">
                    ›
                  </span>
                </button>

                <div className="play-history__actions">
                  {confirming ? (
                    <>
                      <button
                        type="button"
                        className="play-history__action is-danger"
                        onClick={() => void remove(game.game_id)}
                      >
                        Confirm delete
                      </button>
                      <button
                        type="button"
                        className="play-history__action"
                        onClick={() => setConfirmId(null)}
                      >
                        Keep
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="play-history__action"
                        onClick={() => downloadPgn(game)}
                      >
                        Export PGN
                      </button>
                      <button
                        type="button"
                        className="play-history__action is-danger"
                        onClick={() => setConfirmId(game.game_id)}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
