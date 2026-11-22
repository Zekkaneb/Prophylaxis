import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BoardSlot } from '../../board/PersistentBoard';
import { deletePlayedGame, downloadPgn, getPlayedGame } from '../../play/gameStore';
import { getOpponent, profileFromRecord } from '../../play/opponents.ts';
import { playerDisplayName, playerInitials } from '../../profile/playerProfile.ts';
import { usePlayerProfile } from '../../profile/usePlayerProfile.ts';
import { useTitleState } from '../../play/titleStore.ts';
import { ratingForSeconds, useRatingsMap } from '../../play/ratingStore.ts';
import { PlayerNameplate, botTitle } from '../PlayerNameplate';
import { playSoundEvent } from '../../play/audio/soundManager.ts';
import { replayPlySound, replaySans, type ReplayResult } from '../../play/replay.ts';
import {
  formatDateTime,
  formatDuration,
  timeControlLabel,
} from '../../play/timeControls.ts';
import {
  gameOutcome,
  resultReasonLabel,
  type PlayOrientation,
  type PlayedGameRecord,
} from '../../play/types.ts';
import { OpponentAvatar } from './OpponentAvatar';

export interface GameReviewViewProps {
  gameId: string;
  onBack: () => void;
  /** Called after a successful delete so the section can return to history. */
  onDeleted: () => void;
}

/**
 * Read-only replay of a finished game.
 *
 * Positions come from the stored SAN list, so the board is rebuilt rather than
 * trusted from a single FEN. The board is never interactive and nothing here
 * writes to the saved record, so stepping through cannot alter history.
 */
export function GameReviewView({ gameId, onBack, onDeleted }: GameReviewViewProps) {
  /* The player's own name and monogram, as set on the Dashboard. */
  const profile = usePlayerProfile();
  const titleState = useTitleState();
  const ratings = useRatingsMap();
  const [record, setRecord] = useState<PlayedGameRecord | null>(null);
  const [positions, setPositions] = useState<ReplayResult | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ply, setPly] = useState(0);
  /* The ply the board is showing; the sound effect compares against it. */
  const lastPlyRef = useRef<number | null>(null);
  const [orientation, setOrientation] = useState<PlayOrientation>('white');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const row = await getPlayedGame(gameId);
        if (cancelled) return;
        if (!row) {
          setError('That game is no longer in your history.');
          setRecord(null);
          return;
        }
        setRecord(row);
        /* Opening a game is not a move: baseline the ply so the board can land
           on the final position without a cue. */
        lastPlyRef.current = row.sans.length;
        setPly(row.sans.length);
        setOrientation(
          row.board_orientation ?? (row.player_color === 'w' ? 'white' : 'black'),
        );
      } catch {
        if (!cancelled) setError('That game could not be read from local storage.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [gameId]);

  useEffect(() => {
    if (!record) {
      setPositions(null);
      return;
    }
    try {
      setPositions(replaySans(record.starting_fen ?? '', record.sans));
      setReplayError(null);
    } catch (cause) {
      setPositions(null);
      setReplayError(
        `${(cause as Error).message} The saved game itself has not been changed.`,
      );
    }
  }, [record]);

  const totalPlies = positions?.plies.length ?? record?.sans.length ?? 0;
  const currentPly = Math.min(ply, totalPlies);

  const go = useCallback(
    (next: number) => setPly(Math.max(0, Math.min(totalPlies, next))),
    [totalPlies],
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setPly((value) => Math.max(0, value - 1));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setPly((value) => Math.min(totalPlies, value + 1));
      } else if (event.key === 'Home') {
        event.preventDefault();
        setPly(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        setPly(totalPlies);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [totalPlies]);

  /*
   * Review audio: stepping one ply plays the cue that move would have made
   * live — capture, check, castle, promotion or a plain move, in the mover's
   * own self/opponent voice. Jumping to the start or the end is navigation, not
   * a move, so it stays quiet.
   */
  useEffect(() => {
    const previous = lastPlyRef.current;
    lastPlyRef.current = currentPly;
    if (previous === null || currentPly === previous || !positions) return;
    if (Math.abs(currentPly - previous) !== 1) return;

    const step = currentPly - previous;
    const stepped = positions.plies[step > 0 ? currentPly - 1 : previous - 1];
    if (!stepped) return;
    const sound = replayPlySound(stepped, record?.player_color ?? null);
    if (sound) playSoundEvent(sound);
  }, [currentPly, positions, record]);

  const rows = useMemo(() => {
    const sans = positions?.plies.map((entry) => entry.san) ?? record?.sans ?? [];
    const result: Array<{ number: number; white: string | null; black: string | null }> = [];
    for (let index = 0; index < sans.length; index += 2) {
      result.push({
        number: index / 2 + 1,
        white: sans[index] ?? null,
        black: sans[index + 1] ?? null,
      });
    }
    return result;
  }, [positions, record]);

  async function remove() {
    setDeleting(true);
    try {
      await deletePlayedGame(gameId);
      onDeleted();
    } catch {
      setDeleting(false);
      setError('That game could not be deleted.');
    }
  }

  if (loading) {
    return (
      <div className="play-review">
        <div className="play-review__main">
          <div className="play-skeleton play-skeleton--board" />
          <p className="play-review__status">Loading game…</p>
        </div>
      </div>
    );
  }

  if (error || !record) {
    return (
      <div className="play-empty-state">
        <p className="play-eyebrow">Game review</p>
        <h2>{error ?? 'That game could not be opened.'}</h2>
        <p>Finished games stay on this device; a backup can restore a missing one.</p>
        <button type="button" className="primary-btn" onClick={onBack}>
          Back to history
        </button>
      </div>
    );
  }

  const outcome = gameOutcome(record);
  const botMatch = record.mode === 'bot-vs-bot';
  const opponent = profileFromRecord(record);
  const whiteBot = botMatch && record.white_opponent_id
    ? getOpponent(record.white_opponent_id) ?? null
    : null;
  const blackBot = botMatch && record.black_opponent_id
    ? getOpponent(record.black_opponent_id) ?? null
    : null;
  const matchTitle = `${whiteBot?.name ?? record.white_name ?? 'White'} vs ${blackBot?.name ?? record.black_name ?? record.opponent_name}`;
  const fen = positions?.fens[currentPly] ?? positions?.startingFen ?? record.final_fen;
  const lastMove =
    positions && currentPly > 0
      ? (() => {
          const entry = positions.plies[currentPly - 1];
          return entry ? { from: entry.from, to: entry.to } : null;
        })()
      : null;
  const turnField = fen.split(' ')[1];
  const sideToMove = turnField === 'b' ? 'Black to move' : 'White to move';
  const atEnd = currentPly >= totalPlies;

  return (
    <div className="play-review">
      <div className="play-review__main">
        <div className="play-review__top">
          <button type="button" className="play-link play-review__back" onClick={onBack}>
            ‹ Game History
          </button>
          <span className={`play-history__result is-${botMatch ? 'draw' : outcome.tone}`}>
            <span className="play-history__result-label">
              {botMatch ? 'Bot match' : outcome.label}
            </span>
            <span className="play-history__score">
              {botMatch ? record.result : outcome.score}
            </span>
          </span>
        </div>

        <div className="play-seat play-seat--opponent">
          <OpponentAvatar opponent={opponent} size="md" loading="eager" />
          <div className="play-seat__id">
            <span className="play-seat__name">
              <PlayerNameplate
                name={
                  botMatch
                    ? (blackBot?.name ?? record.black_name ?? record.opponent_name)
                    : opponent.name
                }
                rating={Number(botMatch ? (record.black_elo ?? record.opponent_elo) : record.opponent_elo)}
                title={botTitle(
                  Number(botMatch ? (record.black_elo ?? record.opponent_elo) : record.opponent_elo),
                )}
                size="sm"
              />
            </span>
            <span className="play-seat__meta">
              {(botMatch ? blackBot : opponent)?.title ?? 'Opponent'} ·{' '}
              {botMatch ? (record.black_elo ?? record.opponent_elo) : record.opponent_elo} Elo ·{' '}
              {botMatch ? 'Black' : record.player_color === 'w' ? 'Black' : 'White'}
            </span>
          </div>
          <span className="play-clock play-clock--static">
            {botMatch
              ? record.result === '0-1'
                ? 'Win'
                : record.result === '1-0'
                  ? 'Loss'
                  : 'Draw'
              : record.result === '1/2-1/2'
                ? '½–½'
                : record.player_color === 'w'
                  ? record.result === '0-1'
                    ? 'Win'
                    : 'Loss'
                  : record.result === '1-0'
                    ? 'Win'
                    : 'Loss'}
          </span>
        </div>

        <div className="play-board-wrap">
          <BoardSlot
            props={{
              fen,
              orientation,
              interactive: false,
              highlightLastMove: true,
              highlightCheck: true,
              lastMove,
              /* History replay is silent by policy. */
              soundFeedback: false,
            }}
          />
        </div>

        <div className="play-seat play-seat--self">
          {whiteBot ? (
            <OpponentAvatar opponent={whiteBot} size="md" loading="eager" />
          ) : (
            <span className="play-avatar play-avatar--md play-avatar--self" aria-hidden="true">
              {profile.avatar ? (
                <img className="play-avatar__photo" src={profile.avatar} alt="" />
              ) : (
                <span className="play-avatar__initial">{playerInitials(profile)}</span>
              )}
            </span>
          )}
          <div className="play-seat__id">
            <span className="play-seat__name">
              <PlayerNameplate
                name={
                  botMatch
                    ? (whiteBot?.name ?? record.white_name ?? 'White')
                    : playerDisplayName(profile)
                }
                rating={
                  Number(botMatch ? record.white_elo : 0) ||
                  ratingForSeconds(
                    ratings,
                    record.initial_seconds,
                    record.initial_seconds === 0,
                  ) ||
                  profile.elo
                }
                title={
                  botMatch ? botTitle(Number(record.white_elo)) : titleState.worn
                }
                size="sm"
              />
            </span>
            <span className="play-seat__meta">
              {botMatch
                ? `${whiteBot?.title ?? 'White'} · ${record.white_elo ?? ''} Elo · White`
                : `You · ${record.player_color === 'w' ? 'White' : 'Black'}`}
            </span>
          </div>
          <span className="play-clock play-clock--static">
            {botMatch
              ? record.result === '1-0'
                ? 'Win'
                : record.result === '0-1'
                  ? 'Loss'
                  : 'Draw'
              : record.result === '1/2-1/2'
                ? '½–½'
                : record.player_color === 'w'
                  ? record.result === '1-0'
                    ? 'Win'
                    : 'Loss'
                  : record.result === '0-1'
                    ? 'Win'
                    : 'Loss'}
          </span>
        </div>

        <div className="play-review__nav">
          <button
            type="button"
            className="play-nav__btn"
            onClick={() => go(0)}
            disabled={currentPly === 0}
            aria-label="First move"
            title="First move (Home)"
          >
            «
          </button>
          <button
            type="button"
            className="play-nav__btn"
            onClick={() => go(currentPly - 1)}
            disabled={currentPly === 0}
            aria-label="Previous move"
            title="Previous move (←)"
          >
            ‹
          </button>
          <span className="play-review__counter">
            <strong>{currentPly}</strong> / {totalPlies}
          </span>
          <button
            type="button"
            className="play-nav__btn"
            onClick={() => go(currentPly + 1)}
            disabled={atEnd}
            aria-label="Next move"
            title="Next move (→)"
          >
            ›
          </button>
          <button
            type="button"
            className="play-nav__btn"
            onClick={() => go(totalPlies)}
            disabled={atEnd}
            aria-label="Last move"
            title="Last move (End)"
          >
            »
          </button>
          <button
            type="button"
            className="play-nav__btn play-nav__flip"
            onClick={() => setOrientation((value) => (value === 'white' ? 'black' : 'white'))}
            aria-label="Flip board"
          >
            ⇅
          </button>
          <span className="play-review__turn">
            {atEnd ? 'Final position' : sideToMove}
          </span>
        </div>

        {replayError ? (
          <div className="play-error" role="alert">
            {replayError}
          </div>
        ) : null}
      </div>

      <aside className="play-review__side" aria-label="Game details and moves">
        <section className="play-review__card">
          <div className="play-review__who">
            <OpponentAvatar opponent={whiteBot ?? opponent} size="lg" loading="eager" />
            <div>
              <p className="play-eyebrow">Reviewing</p>
              <h2>{botMatch ? matchTitle : opponent.name}</h2>
              <p className="play-preview__elo">
                {botMatch
                  ? `${whiteBot?.title ?? 'White'} ${record.white_elo ?? ''} Elo vs ${blackBot?.title ?? 'Black'} ${record.black_elo ?? ''} Elo`
                  : `${opponent.title ?? opponent.shortName} · ${record.opponent_elo} Elo`}
              </p>
            </div>
          </div>

          <dl className="play-facts play-facts--review">
            <div>
              <dt>Result</dt>
              <dd>
                {botMatch ? record.result : outcome.label} ·{' '}
                {resultReasonLabel(record.reason)}
              </dd>
            </div>
            <div>
              <dt>Played</dt>
              <dd>{formatDateTime(record.ended_at)}</dd>
            </div>
            <div>
              <dt>Time control</dt>
              <dd>
                {timeControlLabel(record.initial_seconds, record.increment_seconds)}
              </dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>{formatDuration(record.duration_seconds)}</dd>
            </div>
            {botMatch ? null : (
              <div>
                <dt>You played</dt>
                <dd>{record.player_color === 'w' ? 'White' : 'Black'}</dd>
              </div>
            )}
          </dl>

          <div className="play-review__actions">
            <button type="button" className="secondary-btn" onClick={() => downloadPgn(record)}>
              Export PGN
            </button>
            {confirmDelete ? (
              <>
                <button
                  type="button"
                  className="play-history__action is-danger"
                  onClick={() => void remove()}
                  disabled={deleting}
                >
                  {deleting ? 'Deleting…' : 'Confirm delete'}
                </button>
                <button
                  type="button"
                  className="play-history__action"
                  onClick={() => setConfirmDelete(false)}
                >
                  Keep
                </button>
              </>
            ) : (
              <button
                type="button"
                className="play-history__action is-danger"
                onClick={() => setConfirmDelete(true)}
              >
                Delete game
              </button>
            )}
          </div>
        </section>

        <section className="play-review__moves">
          <div className="play-side__head">
            <p className="play-eyebrow">Moves</p>
            <span className="play-side__count">{totalPlies} plies</span>
          </div>
          <div className="play-moves play-moves--review" aria-label="Move list">
            {rows.length === 0 ? (
              <p className="play-moves__empty">No moves in this game.</p>
            ) : (
              rows.map((row) => {
                const whitePly = (row.number - 1) * 2 + 1;
                const blackPly = whitePly + 1;
                return (
                  <div className="play-moves__row" key={row.number}>
                    <span className="play-moves__num">{row.number}.</span>
                    {row.white ? (
                      <button
                        type="button"
                        className={`play-moves__ply play-moves__ply--button${
                          currentPly === whitePly ? ' is-selected' : ''
                        }`}
                        onClick={() => go(whitePly)}
                        aria-current={currentPly === whitePly}
                      >
                        {row.white}
                      </button>
                    ) : (
                      <span className="play-moves__ply is-empty" />
                    )}
                    {row.black ? (
                      <button
                        type="button"
                        className={`play-moves__ply play-moves__ply--button${
                          currentPly === blackPly ? ' is-selected' : ''
                        }`}
                        onClick={() => go(blackPly)}
                        aria-current={currentPly === blackPly}
                      >
                        {row.black}
                      </button>
                    ) : (
                      <span className="play-moves__ply is-empty" />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>
      </aside>
    </div>
  );
}
