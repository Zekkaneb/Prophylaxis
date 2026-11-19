import { useEffect, useState } from 'react';
import { useStockfish } from '../../engine/useStockfish';
import { opponentStage, profileFromRecord } from '../../play/opponents.ts';
import { formatClock } from '../../play/timeControls.ts';
import { usePlayGame } from '../../play/usePlayGame';
import { useBotMatch } from '../../play/useBotMatch';
import { BotMatchSetupView } from './BotMatchSetupView';
import { BotMatchView } from './BotMatchView';
import { CurrentGameView } from './CurrentGameView';
import { GameReviewView } from './GameReviewView';
import { HistoryView } from './HistoryView';
import { NewGameView } from './NewGameView';
import { OpponentAvatar } from './OpponentAvatar';
import EmptyBoardArt from '../EmptyBoardArt';
import './play.css';

export type PlayView = 'new' | 'current' | 'bots' | 'match' | 'history' | 'review';

/**
 * The playing views share one live-game owner, so switching between them (and
 * back) keeps the position, clocks and move list intact. The unfinished game is
 * also stored in IndexedDB, so leaving the tab or reloading does not lose it.
 */
export function PlaySection() {
  const [view, setView] = useState<PlayView>('new');
  const [reviewId, setReviewId] = useState<string | null>(null);
  /* One shared Stockfish worker serves both the human game and bot matches. */
  const engine = useStockfish();
  const game = usePlayGame(engine);
  const match = useBotMatch(engine);
  const { setVisible } = game;
  const setMatchVisible = match.setVisible;

  /* Only the board view can run the bot; the player's clock keeps its own time. */
  useEffect(() => {
    setVisible(view === 'current');
  }, [setVisible, view]);

  useEffect(() => {
    setMatchVisible(view === 'match');
  }, [setMatchVisible, view]);

  const liveSession = game.session?.status === 'playing' ? game.session : null;
  const hasLiveGame = Boolean(liveSession);
  const hasUnfinished = hasLiveGame || Boolean(game.resumable);
  const resumeProfile = game.resumable ? profileFromRecord(game.resumable) : null;

  const resume = () => {
    if (liveSession) {
      setView('current');
      window.scrollTo({ top: 0 });
      return;
    }
    if (game.resumable && game.resumeGame(game.resumable)) {
      setView('current');
      window.scrollTo({ top: 0 });
    }
  };

  const openReview = (gameId: string) => {
    setReviewId(gameId);
    setView('review');
    window.scrollTo({ top: 0 });
  };

  const liveClock =
    liveSession && !liveSession.config.untimed
      ? formatClock(liveSession.playerColor === 'w' ? game.clock.whiteMs : game.clock.blackMs)
      : null;

  return (
    <div className="play">
      <div className="play-topbar">
        <div className="play-tabs" role="tablist" aria-label="Playing views">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'new'}
            className={`play-tabs__tab${view === 'new' ? ' is-active' : ''}`}
            onClick={() => setView('new')}
          >
            New Game
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'current'}
            className={`play-tabs__tab${view === 'current' ? ' is-active' : ''}`}
            onClick={() => setView('current')}
          >
            Current Game
            {hasUnfinished ? (
              <span className="play-tabs__dot" aria-label="Game in progress" />
            ) : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'bots' || view === 'match'}
            className={`play-tabs__tab${view === 'bots' || view === 'match' ? ' is-active' : ''}`}
            onClick={() => setView(match.session ? 'match' : 'bots')}
          >
            Watch Bots
            {match.session && match.session.status !== 'finished' ? (
              <span className="play-tabs__dot" aria-label="Bot match in progress" />
            ) : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'history' || view === 'review'}
            className={`play-tabs__tab${view === 'history' || view === 'review' ? ' is-active' : ''}`}
            onClick={() => setView('history')}
          >
            History
          </button>
        </div>

        {hasUnfinished && view !== 'current' ? (
          <button type="button" className="play-live" onClick={resume}>
            <span className="play-live__dot" aria-hidden="true" />
            <span className="play-live__label">
              {/* Version first: the chip truncates, and two Bryans share a
                  surname. */}
              {liveSession
                ? `${opponentStage(liveSession.opponent) ?? liveSession.opponent.shortName} · ${liveSession.opponent.name}`
                : (resumeProfile
                    ? `${opponentStage(resumeProfile) ?? resumeProfile.shortName} · ${resumeProfile.name}`
                    : null)}
            </span>
            {liveClock ? <span className="play-live__clock">{liveClock}</span> : null}
          </button>
        ) : null}
      </div>

      {view === 'new' ? (
        <NewGameView
          hasLiveGame={hasLiveGame}
          resumable={game.resumable}
          resumeError={game.resumeError}
          onStart={(opponent, config) => {
            game.startGame(opponent, config);
            setView('current');
            /* The setup form is tall; bring the board into view immediately. */
            window.scrollTo({ top: 0 });
          }}
          onResume={resume}
          onAbandon={() => void game.abandonResumable()}
          onDismissResumeError={game.clearResumeError}
        />
      ) : null}

      {view === 'current' ? (
        game.session ? (
          <CurrentGameView
            session={game.session}
            clock={game.clock}
            engine={engine}
            botThinking={game.botThinking}
            notice={game.notice}
            onMove={game.playMove}
            onPremove={game.queuePremove}
            onResign={game.resign}
            onDraw={() => void game.offerDraw()}
            onRematch={game.rematch}
            onNewGame={() => setView('new')}
            onHistory={() => setView('history')}
            onFlip={game.flipBoard}
            onReview={openReview}
            onDismissNotice={game.clearNotice}
          />
        ) : game.resumable && resumeProfile ? (
          <div className="play-empty-state play-empty-state--resume">
            <OpponentAvatar opponent={resumeProfile} size="xl" loading="eager" />
            <p className="play-eyebrow">Unfinished game</p>
            <h2>Resume your game against {resumeProfile.name}</h2>
            <p>
              {opponentStage(resumeProfile) ? `${opponentStage(resumeProfile)} · ` : ''}
              {game.resumable.player_color === 'w' ? 'White' : 'Black'} ·{' '}
              {game.resumable.sans.length}{' '}
              {game.resumable.sans.length === 1 ? 'move played' : 'moves played'} · saved on
              this device.
            </p>
            {game.resumeError ? (
              <p className="play-empty-state__error" role="alert">
                {game.resumeError}
              </p>
            ) : null}
            <div className="play-empty-state__actions">
              <button type="button" className="primary-btn" onClick={resume}>
                Resume game
              </button>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => void game.abandonResumable()}
              >
                Abandon
              </button>
            </div>
          </div>
        ) : (
          <div className="play-empty-state">
            <EmptyBoardArt />
            <p className="play-eyebrow">No game in progress</p>
            <h2>Your next game starts here</h2>
            <p>
              Pick an opponent, choose a colour and set the clock. The board opens as
              soon as you start.
            </p>
            <ul className="empty-points" aria-label="Game features">
              <li>Thirteen personalities</li>
              <li>Real clocks</li>
              <li>Saved on this device</li>
            </ul>
            <button type="button" className="primary-btn" onClick={() => setView('new')}>
              Set up a game
            </button>
          </div>
        )
      ) : null}

      {view === 'bots' ? (
        <BotMatchSetupView
          onCancel={() => setView('new')}
          onStart={(config) => {
            match.start(config);
            setView('match');
            window.scrollTo({ top: 0 });
          }}
        />
      ) : null}

      {view === 'match' ? (
        match.session ? (
          <BotMatchView
            session={match.session}
            clock={match.clock}
            onPause={match.pause}
            onResume={match.resume}
            onRestart={match.restart}
            onStop={() => {
              match.stop();
              setView('bots');
            }}
            onSpeed={match.setSpeed}
            onNewMatch={() => {
              match.stop();
              setView('bots');
            }}
          />
        ) : (
          <div className="play-empty-state">
            <EmptyBoardArt glyph="♜" />
            <p className="play-eyebrow">Watch mode</p>
            <h2>Two bots. One board.</h2>
            <p>
              Choose a white and a black opponent, then watch two different repertoires
              meet in real time.
            </p>
            <ul className="empty-points" aria-label="Watch match features">
              <li>Any pairing</li>
              <li>Three viewing paces</li>
              <li>Saved to history</li>
            </ul>
            <button type="button" className="primary-btn" onClick={() => setView('bots')}>
              Set up a match
            </button>
          </div>
        )
      ) : null}

      {view === 'history' ? (
        <HistoryView onStartGame={() => setView('new')} onOpenGame={openReview} />
      ) : null}

      {view === 'review' && reviewId ? (
        <GameReviewView
          key={reviewId}
          gameId={reviewId}
          onBack={() => setView('history')}
          onDeleted={() => {
            setReviewId(null);
            setView('history');
          }}
        />
      ) : null}
    </div>
  );
}

export default PlaySection;
