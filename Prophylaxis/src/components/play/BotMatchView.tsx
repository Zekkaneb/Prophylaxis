import { useEffect, useMemo, useRef, useState } from 'react';
import { BoardSlot } from '../../board/PersistentBoard';
import type { ClockSnapshot } from '../../play/clock.ts';
import { formatClock, timeControlLabel } from '../../play/timeControls.ts';
import { opponentMeta } from '../../play/opponents.ts';
import { resultReasonLabel, type PlayColor } from '../../play/types.ts';
import type { BotMatchSession, MatchSpeed } from '../../play/useBotMatch.ts';
import { OpponentAvatar } from './OpponentAvatar.tsx';
import { usePlyBrowser } from './usePlyBrowser';

export interface BotMatchViewProps {
  session: BotMatchSession;
  clock: ClockSnapshot;
  onPause: () => void;
  onResume: () => void;
  onRestart: () => void;
  onStop: () => void;
  onSpeed: (speed: MatchSpeed) => void;
  onNewMatch: () => void;
}

const SPEEDS: Array<{ id: MatchSpeed; label: string }> = [
  { id: 'slow', label: 'Slow' },
  { id: 'normal', label: 'Normal' },
  { id: 'fast', label: 'Fast' },
];

function resultText(session: BotMatchSession): string {
  if (!session.result) return '';
  if (session.result === '1/2-1/2') return 'Draw';
  const winner = session.result === '1-0' ? session.white : session.black;
  return `${winner.name} wins`;
}

export function BotMatchView({
  session,
  clock,
  onPause,
  onResume,
  onRestart,
  onStop,
  onSpeed,
  onNewMatch,
}: BotMatchViewProps) {
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const movesRef = useRef<HTMLDivElement | null>(null);
  /* The match plays itself, so the browser is the only way to read back through
     it: the board follows unless the reader steps away from the latest ply. */
  /* Bot vs. bot has no human seat, so both sides use the opponent voice. */
  const browser = usePlyBrowser(session.sans, session.fen, { playerColor: null });
  const reviewing = !browser.atLive;

  useEffect(() => {
    const element = movesRef.current?.querySelector('.play-moves__ply.is-selected');
    element?.scrollIntoView({ block: 'nearest' });
  }, [browser.ply, session.sans.length]);

  const rows = useMemo(() => {
    const result: Array<{ number: number; white: string; black: string | null }> = [];
    for (let index = 0; index < session.sans.length; index += 2) {
      result.push({
        number: index / 2 + 1,
        white: session.sans[index] ?? '',
        black: session.sans[index + 1] ?? null,
      });
    }
    return result;
  }, [session.sans]);

  const untimed = session.config.untimed;
  const finished = session.status === 'finished';
  const active = session.status === 'playing';

  function seat(color: PlayColor) {
    const opponent = color === 'w' ? session.white : session.black;
    const ms = color === 'w' ? clock.whiteMs : clock.blackMs;
    /* Reviewing a snapshot? Then the plate follows the position on the board. */
    const running = reviewing ? browser.turn === color : active && clock.active === color;
    const thinking = session.thinking === color;
    const reaction = session.reactions[color];
    return (
      <div
        className={`play-seat ${color === 'w' ? 'play-seat--self' : 'play-seat--opponent'}${
          running ? ' is-active' : ''
        }`}
      >
        <OpponentAvatar opponent={opponent} size="md" loading="eager" />
        <div className="play-seat__id">
          <span className="play-seat__name">
            <span
              className={`play-seat__dot play-seat__dot--${color === 'w' ? 'white' : 'black'}`}
              aria-hidden="true"
            />
            {opponent.name}
          </span>
          <span className="play-seat__meta">
            {opponentMeta(opponent)} · {color === 'w' ? 'White' : 'Black'}
            {thinking ? ' · thinking' : ''}
          </span>
          <span className="play-seat__line" aria-live="polite">
            {reaction ? (
              <span className="play-seat__line-text" key={reaction.at}>
                {reaction.text}
              </span>
            ) : null}
          </span>
        </div>
        <span
          className={[
            'play-clock',
            running ? 'is-active' : '',
            !untimed && ms < 20_000 ? 'is-low' : '',
            untimed ? 'is-untimed' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-label={`${color === 'w' ? 'White' : 'Black'} clock ${
            untimed ? 'untimed' : formatClock(ms)
          }`}
        >
          {untimed ? '—' : formatClock(ms)}
        </span>
      </div>
    );
  }

  return (
    <div className="play-game bot-match">
      <div className="play-game__board">
        {seat('b')}
        <div className="play-board-wrap">
          <BoardSlot
            props={{
              fen: browser.fen,
              orientation,
              interactive: false,
              highlightLastMove: true,
              highlightCheck: true,
              lastMove: browser.lastMove,
              soundFeedback: false,
            }}
          />
        </div>
        {seat('w')}

        <div className="play-review__nav play-game__nav" role="group" aria-label="Move browser">
          <button
            type="button"
            className="play-nav__btn"
            onClick={browser.first}
            disabled={browser.ply === 0}
            aria-label="Start position"
            title="Start position (Home)"
          >
            «
          </button>
          <button
            type="button"
            className="play-nav__btn"
            onClick={browser.prev}
            disabled={browser.ply === 0}
            aria-label="Previous move"
            title="Previous move (←)"
          >
            ‹
          </button>
          <span className="play-review__counter">
            <strong>{browser.ply}</strong> / {browser.total}
          </span>
          <button
            type="button"
            className="play-nav__btn"
            onClick={browser.next}
            disabled={browser.atLive}
            aria-label="Next move"
            title="Next move (→)"
          >
            ›
          </button>
          <button
            type="button"
            className="play-nav__btn"
            onClick={browser.last}
            disabled={browser.atLive}
            aria-label="Latest position"
            title="Latest position (End)"
          >
            »
          </button>
          <button
            type="button"
            className="play-nav__btn play-nav__flip"
            onClick={() => setOrientation((value) => (value === 'white' ? 'black' : 'white'))}
            aria-label="Flip board"
            title="Flip board"
          >
            ⇅
          </button>
          <span className={`play-review__turn${reviewing ? ' is-reviewing' : ''}`}>
            {reviewing ? 'Reviewing' : 'Live'}
          </span>
          {reviewing ? (
            <button type="button" className="play-live-return" onClick={browser.last}>
              Back to live ›
            </button>
          ) : null}
        </div>

        <p className="play-turn" role="status">
          {reviewing
            ? `Move ${browser.ply} of ${browser.total} · ${browser.turn === 'w' ? 'White' : 'Black'} to move`
            : finished
              ? `${resultText(session)} · ${resultReasonLabel(session.reason ?? 'checkmate')}`
              : session.status === 'paused'
                ? 'Paused'
                : session.thinking
                  ? `${session.thinking === 'w' ? 'White' : 'Black'} is thinking…`
                  : 'Match in progress'}
        </p>
      </div>

      <aside className="play-side" aria-label="Match controls and moves">
        <div className="play-side__card">
          <div className="play-side__head">
            <p className="play-eyebrow">Moves</p>
            <span className="play-side__count">{session.sans.length} plies</span>
          </div>
          <div className="play-moves" ref={movesRef} tabIndex={0} aria-label="Move list">
            {rows.length === 0 ? (
              <p className="play-moves__empty">Waiting for the first move.</p>
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
                          browser.ply === whitePly ? ' is-selected' : ''
                        }`}
                        onClick={() => browser.go(whitePly)}
                        aria-current={browser.ply === whitePly}
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
                          browser.ply === blackPly ? ' is-selected' : ''
                        }`}
                        onClick={() => browser.go(blackPly)}
                        aria-current={browser.ply === blackPly}
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
          <p className="play-side__footnote">Click a move or use ← → to look back.</p>
        </div>

        <div className="play-side__card">
          <div className="play-side__head">
            <p className="play-eyebrow">Match</p>
            <span className={`play-side__status${reviewing ? ' is-reviewing' : ''}`}>
              {reviewing ? 'Reviewing' : finished ? 'Finished' : session.status === 'paused' ? 'Paused' : 'Live'}
            </span>
          </div>
          <div className="bot-controls">
          {active ? (
            <button type="button" className="play-action" onClick={onPause}>
              Pause
            </button>
          ) : (
            <button
              type="button"
              className="play-action"
              onClick={onResume}
              disabled={session.status !== 'paused'}
            >
              Resume
            </button>
          )}
          <button type="button" className="play-action" onClick={onRestart}>
            Restart
          </button>
          <button type="button" className="play-action" onClick={onStop}>
            Stop match
          </button>
          <button type="button" className="play-action" onClick={onNewMatch}>
            New match
          </button>
        </div>

        <div className="bot-speed bot-speed--compact" role="group" aria-label="Viewing pace">
          {SPEEDS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={session.speed === option.id}
              className={`play-time${session.speed === option.id ? ' is-selected' : ''}`}
              onClick={() => onSpeed(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
          <p className="play-hint">
            Pace only changes how quickly moves are shown, not engine strength.
          </p>
        </div>

        {finished ? (
          <div className="bot-result" role="status">
            <p className="play-eyebrow">{resultReasonLabel(session.reason ?? 'checkmate')}</p>
            <h3>{resultText(session)}</h3>
            <p className="play-preview__elo">
              {session.result} · {session.sans.length} plies
            </p>
            {session.saveError ? (
              <p className="play-end__warn">{session.saveError}</p>
            ) : (
              <p className="play-end__saved">
                {session.savedGameId ? 'Saved to Game History.' : 'Saving match…'}
              </p>
            )}
          </div>
        ) : null}

        <div className="play-side__card">
          <div className="play-side__head">
            <p className="play-eyebrow">Game</p>
            <span className="play-side__count">
              {timeControlLabel(
                session.config.initialSeconds,
                session.config.incrementSeconds,
              )}
            </span>
          </div>
          <dl className="play-facts">
            <div>
              <dt>White</dt>
              <dd title={session.white.name}>{session.white.name}</dd>
            </div>
            <div>
              <dt>Black</dt>
              <dd title={session.black.name}>{session.black.name}</dd>
            </div>
            <div>
              <dt>Material</dt>
              <dd>
                {browser.material === 0
                  ? 'Level'
                  : `${browser.material > 0 ? '+' : '−'}${Math.abs(browser.material)} White`}
              </dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                {finished ? 'Finished' : session.status === 'paused' ? 'Paused' : 'In progress'}
              </dd>
            </div>
          </dl>
        </div>
      </aside>
    </div>
  );
}
