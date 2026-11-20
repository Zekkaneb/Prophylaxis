import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { Move } from 'chess.js';
import { START_FEN } from './ChessBoardWrapper';
import EmptyBoardArt from './EmptyBoardArt';
import { BoardSlot, useBoardHandle } from '../board/PersistentBoard';
import BoardScaleBar from './BoardScaleBar';
import BoardScaleGrip from './BoardScaleGrip';
import { db, type MoveEvaluation, type SavedReview } from '../db';
import { useStockfish, type EngineCandidate } from '../engine/useStockfish';
import { getPlayedGame } from '../play/gameStore';
import {
  SUMMARY_CLASSIFICATIONS,
  canRetry,
  classificationMeta,
  isBadMove,
  isKeyMoment,
} from '../config/moveClassifications';

/**
 * Two decimals and a sign, the shape an engine list is scanned by: `+0.22`,
 * `-0.24`, `+M3`.
 */
function candidateScoreLabel(candidate: EngineCandidate): string {
  if (candidate.mate !== null) {
    return `${candidate.mate > 0 ? '+' : '-'}M${Math.abs(candidate.mate)}`;
  }
  const pawns = candidate.scoreCp / 100;
  return `${pawns >= 0 ? '+' : '-'}${Math.abs(pawns).toFixed(2)}`;
}

/** Which side the number favours: white chips are light, black chips dark. */
function evaluationSide(candidate: EngineCandidate): 'white' | 'black' {
  const score = candidate.mate !== null ? candidate.mate : candidate.scoreCp;
  return score >= 0 ? 'white' : 'black';
}

/** Mistakes worth drilling: the deck is "My Game Blunders", not every ply. */
const EXPORTABLE_CLASSES: ReadonlySet<string> = new Set(['miss', 'blunder', 'throw']);
import { detectOpening, loadOpeningBook } from '../review/openingBook';
import {
  MY_GAME_BLUNDERS_SET_NAME,
  analyzeGame,
  estimateElo,
  exportTacticToWoodpecker,
  formatEvaluation,
  formatPvLine,
  parsePgn,
  summarizeReview,
  uciToSan,
  whiteAdvantagePercent,
  type ParsedGame,
  type ReviewSummary,
} from '../review/gameReviewService';
import {
  REVIEW_PROFILE_IDS,
  REVIEW_PROFILES,
  useReviewProfile,
} from '../review/reviewSettings';
import './GameReviewDashboard.css';

type Phase = 'input' | 'analyzing' | 'review';

export interface GameReviewDashboardProps {
  /**
   * A played game to review on open.
   *
   * The Play tab's "Review game" button hands the id over and switches to this
   * tab, so the analysis starts by itself instead of asking for the PGN again.
   */
  initialGameId?: string | null;
  /** Called once the handed-over game has been picked up. */
  onInitialConsumed?: () => void;
}

/*
 * Depth cap for the passive search that follows the position while you step
 * through a game. The list fills in from the first iteration and then keeps
 * deepening in the background; the cap only decides when it stops growing.
 */
const LIVE_DEPTH = 20;

interface RetryState {
  fen: string;
  color: 'w' | 'b';
  bestMove: string;
  bestSan: string;
  revealed: boolean;
  correct: boolean;
  feedback: string | null;
}

function moverScore(scoreCp: number, color: 'w' | 'b'): number {
  return color === 'w' ? scoreCp : -scoreCp;
}

function moverMate(mate: number | null, color: 'w' | 'b'): number | null {
  if (mate === null) return null;
  return color === 'w' ? mate : -mate;
}

/**
 * One player, written the way a scoresheet writes it: colour, name, then the
 * rating as a badge. The predicted rating lives in the left rail.
 */
function PlayerCard({
  side,
  name,
  elo,
  active,
}: {
  side: 'white' | 'black';
  name: string;
  elo?: string | null;
  active: boolean;
}) {
  return (
    <div className={`gr-player gr-player--${side}${active ? ' is-active' : ''}`}>
      <span className={`gr-player__dot gr-player__dot--${side}`} aria-hidden="true" />
      <span className="gr-player__id">
        <span className="gr-player__name" title={name}>
          {name}
        </span>
        {elo ? (
          <span className="gr-player__elo" title="Rating from the PGN">
            {elo}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/**
 * Outcome-aware coach lines for the three tags that are easy to confuse with a
 * blunder. Everything else falls back to the classification headline.
 */
function outcomeSentence(entry: MoveEvaluation, bestSan: string): string | null {
  const best = bestSan || 'the best move';

  if (entry.classification === 'miss') {
    const hadForcedMate = (moverMate(entry.mate_before, entry.color) ?? 0) > 0;
    return `Miss — ${best} ${
      hadForcedMate ? 'had a forced checkmate' : 'was the decisive blow'
    }, and you kept the position instead.`;
  }

  if (entry.classification === 'blunder' || entry.classification === 'throw') {
    const before = moverScore(entry.eval_before, entry.color);
    const after = moverScore(entry.eval_after, entry.color);
    const from = before >= 150 ? 'winning' : before > -150 ? 'equal' : 'losing';
    const to = after >= -50 ? 'drawn' : 'losing';
    const label = entry.classification === 'throw' ? 'Throw' : 'Blunder';
    return `${label} — This flips the game from ${from} to ${to}. Best was ${best}.`;
  }

  return null;
}

export default function GameReviewDashboard({
  initialGameId = null,
  onInitialConsumed,
}: GameReviewDashboardProps = {}) {
  const stockfish = useStockfish();
  const [reviewProfile, setReviewProfile] = useReviewProfile();
  const boardRef = useBoardHandle();
  const pgnFileRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>('input');
  const [pgnText, setPgnText] = useState('');
  const [reviews, setReviews] = useState<SavedReview[]>([]);
  const [reviewsError, setReviewsError] = useState<string | null>(null);
  const [active, setActive] = useState<SavedReview | null>(null);
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [ply, setPly] = useState(0);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<RetryState | null>(null);
  /* Manual board orientation: X or the flip button turns the board around. */
  const [flipped, setFlipped] = useState(false);
  /* The eval bar is a study aid, so it can be hidden from the transport bar. */
  const [showEvalBar, setShowEvalBar] = useState(true);
  const [keyMomentsOnly, setKeyMomentsOnly] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [bookReady, setBookReady] = useState(false);
  const [candidates, setCandidates] = useState<EngineCandidate[]>([]);
  const [candidatesPending, setCandidatesPending] = useState(false);
  const [candidateDepth, setCandidateDepth] = useState(0);
  const liveToken = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const focusPgn = useCallback(() => {
    const field = document.getElementById('review-pgn') as HTMLTextAreaElement | null;
    field?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    field?.focus({ preventScroll: true });
  }, []);

  const refreshReviews = useCallback(async () => {
    try {
      const list = await db.saved_reviews.orderBy('created_at').reverse().toArray();
      setReviews(list);
      setReviewsError(null);
    } catch (cause) {
      setReviewsError(`Saved reviews could not be loaded: ${String(cause)}`);
    }
  }, []);

  useEffect(() => {
    void refreshReviews();
  }, [refreshReviews]);

  useEffect(() => {
    let alive = true;
    void loadOpeningBook().then(() => {
      if (alive) setBookReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    setToast(null);
  }, [ply]);

  const evaluations = active?.evaluations ?? [];
  const totalPlies = evaluations.length;
  /* Rating prediction needs real decisions: a line made almost entirely of book
     moves would otherwise be "predicted" as a masterclass for both players. */
  const analysedPlies = evaluations.filter(
    (entry) => entry.classification !== 'book',
  ).length;
  const currentPly = Math.min(ply, totalPlies);

  const currentFen =
    totalPlies === 0
      ? START_FEN
      : currentPly === 0
        ? evaluations[0].fen_before
        : evaluations[currentPly - 1].fen_after;

  const currentEval =
    totalPlies === 0
      ? { cp: 0, mate: null as number | null }
      : currentPly === 0
        ? { cp: evaluations[0].eval_before, mate: evaluations[0].mate_before }
        : {
            cp: evaluations[currentPly - 1].eval_after,
            mate: evaluations[currentPly - 1].mate_after,
          };

  const opening = useMemo(
    () => detectOpening((active?.evaluations ?? []).map((entry) => entry.fen_after)),
    [active, bookReady],
  );

  /*
   * Passive analysis of the position on screen (MultiPV 3). The engine keeps
   * deepening while the position is displayed and streams what it has so far,
   * so the list fills in immediately and its numbers keep improving until
   * either the depth cap or the next ←/→. Nothing here waits on the engine
   * being warm: the first call boots the worker, and only an engine failure
   * suppresses the panel. Results are token-checked, so a fast ←/→ never
   * paints an older position.
   */
  const engineFailed = stockfish.status === 'error';

  useEffect(() => {
    if (phase !== 'review' || retry || !active || engineFailed) return;
    const token = liveToken.current + 1;
    liveToken.current = token;
    /* Drop the old lines before asking: a PV is only readable against the
       position it was searched from, and the new search needs a moment. */
    setCandidates([]);
    setCandidateDepth(0);
    setCandidatesPending(true);
    const timer = window.setTimeout(() => {
      void stockfish
        .analysePosition(currentFen, {
          depth: LIVE_DEPTH,
          multiPv: 3,
          onProgress: (evaluation) => {
            if (liveToken.current !== token) return;
            setCandidates(evaluation.candidates);
            setCandidateDepth(evaluation.depth);
          },
        })
        .then((evaluation) => {
          if (liveToken.current !== token) return;
          setCandidates(evaluation.candidates);
          setCandidateDepth(evaluation.depth);
          setCandidatesPending(false);
        })
        .catch(() => {
          if (liveToken.current === token) setCandidatesPending(false);
        });
    }, 220);
    return () => {
      window.clearTimeout(timer);
      /* Hand the worker back: otherwise a deepening search on the old position
         holds it until its depth cap and the next move waits for nothing. */
      stockfish.stop();
    };
  }, [phase, retry, active, currentFen, engineFailed, stockfish.analysePosition, stockfish.stop]);

  const inspected = currentPly > 0 ? evaluations[currentPly - 1] : null;
  const inspectedMeta = inspected ? classificationMeta(inspected.classification) : null;
  const coachBest = inspected?.best_move ? uciToSan(inspected.fen_before, inspected.best_move) : '';
  const coachPlayedBest =
    inspected !== null &&
    Boolean(inspected.best_move) &&
    inspected.uci.toLowerCase() === inspected.best_move.toLowerCase();
  const coachSentence = inspected ? outcomeSentence(inspected, coachBest) : null;

  const openReview = useCallback((review: SavedReview) => {
    setActive(review);
    setSummary(summarizeReview(review));
    setPly(0);
    setRetry(null);
    setKeyMomentsOnly(false);
    setError(null);
    setPhase('review');
  }, []);

  const runAnalysis = async (source?: SavedReview, text?: string) => {
    setError(null);
    let parsed: ParsedGame;
    try {
      parsed = parsePgn(text ?? source?.pgn ?? pgnText);
    } catch (cause) {
      setError((cause as Error).message);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setRetry(null);
    setProgress({ completed: 0, total: parsed.moves.length });
    setPhase('analyzing');

    try {
      const result = await analyzeGame(parsed, stockfish.evaluatePosition, {
        depth: reviewProfile.depth,
        signal: controller.signal,
        onProgress: (next) => setProgress(next),
      });
      abortRef.current = null;
      // Re-review replaces the old row with the freshly analysed game.
      if (source) await db.saved_reviews.delete(source.game_id);
      openReview(result.review);
      await refreshReviews();
    } catch (cause) {
      abortRef.current = null;
      if ((cause as Error).name === 'AbortError') {
        setPhase('input');
        return;
      }
      setError((cause as Error).message);
      setPhase('input');
    }
  };

  /*
   * Auto-review: a finished game handed over from the Play tab goes straight
   * through the same pipeline as "Analyse game" — parse, run, save, open — so
   * the player lands on the graded game instead of an empty PGN box. The latest
   * `runAnalysis` is kept in a ref so the effect below never re-runs on renders.
   */
  const runAnalysisRef = useRef(runAnalysis);
  runAnalysisRef.current = runAnalysis;
  const autoStarted = useRef<string | null>(null);

  useEffect(() => {
    if (!initialGameId || stockfish.status === 'loading') return;
    if (autoStarted.current === initialGameId) return;
    autoStarted.current = initialGameId;
    onInitialConsumed?.();

    void (async () => {
      try {
        const record = await getPlayedGame(initialGameId);
        if (!record) {
          setError('That game is no longer in your history.');
          return;
        }
        setPgnText(record.pgn);
        await runAnalysisRef.current(undefined, record.pgn);
      } catch (cause) {
        setError(`That game could not be prepared for review: ${(cause as Error).message}`);
      }
    })();
  }, [initialGameId, onInitialConsumed, stockfish.status]);

  const cancelAnalysis = () => {
    abortRef.current?.abort();
    stockfish.stop();
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setPgnText(await file.text());
      setError(null);
    } catch (cause) {
      setError(`That file could not be read: ${String(cause)}`);
    }
    event.target.value = '';
  };

  const deleteReview = async (review: SavedReview) => {
    if (!window.confirm('Delete this saved game review?')) return;
    try {
      await db.saved_reviews.delete(review.game_id);
      if (active?.game_id === review.game_id) {
        setActive(null);
        setSummary(null);
        setPhase('input');
      }
      await refreshReviews();
    } catch (cause) {
      setError(`The review could not be deleted: ${String(cause)}`);
    }
  };

  useEffect(() => {
    if (phase !== 'review' || retry) return;
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setPly((value) => Math.max(0, value - 1));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setPly((value) => Math.min(totalPlies, value + 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setPly(0);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setPly(totalPlies);
      } else if (event.key === 'x' || event.key === 'X') {
        event.preventDefault();
        setFlipped((value) => !value);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [phase, retry, totalPlies]);

  const startRetry = () => {
    if (!inspected?.best_move) return;
    setToast(null);
    setRetry({
      fen: inspected.fen_before,
      color: inspected.color,
      bestMove: inspected.best_move,
      bestSan: uciToSan(inspected.fen_before, inspected.best_move),
      revealed: false,
      correct: false,
      feedback: null,
    });
  };

  const handleRetryMove = (move: Move) => {
    if (!retry) return;
    const uci = `${move.from}${move.to}${move.promotion ?? ''}`;
    if (uci === retry.bestMove) {
      setRetry({ ...retry, correct: true, revealed: false, feedback: 'That is the engine move.' });
      return;
    }
    setRetry({
      ...retry,
      revealed: true,
      feedback: `Not the engine's choice — it prefers ${retry.bestSan}.`,
    });
  };

  const tryAgain = () => {
    if (!retry) return;
    boardRef.current?.reset(retry.fen);
    setRetry({ ...retry, revealed: false, correct: false, feedback: null });
  };

  const showToast = (message: string, tone: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, tone });
    toastTimer.current = setTimeout(() => setToast(null), 3600);
  };

  const exportToWoodpecker = async () => {
    if (!active || !inspected) return;
    setExporting(true);
    try {
      const result = await exportTacticToWoodpecker(active.game_id, inspected.ply);
      if (!result.added) {
        showToast(`This tactic is already in “${result.setName}”.`);
      } else if (result.createdSet) {
        showToast(`Created “${result.setName}” with ${inspected.san}.`);
      } else {
        showToast(`Added ${inspected.san} to “${result.setName}”.`);
      }
    } catch (cause) {
      showToast(`Could not add the puzzle: ${(cause as Error).message}`, 'error');
    } finally {
      setExporting(false);
    }
  };

  const jumpKeyMoment = (direction: 1 | -1) => {
    const moments = evaluations.filter((entry) => isKeyMoment(entry.classification));
    if (moments.length === 0) return;
    const next =
      direction === 1
        ? moments.find((entry) => entry.ply > currentPly)
        : [...moments].reverse().find((entry) => entry.ply < currentPly);
    const fallback = direction === 1 ? moments[0] : moments[moments.length - 1];
    setRetry(null);
    setPly((next ?? fallback).ply);
  };

  const arrows = useMemo(() => {
    if (retry) {
      if (!retry.revealed || !retry.bestMove) return [];
      return [
        {
          startSquare: retry.bestMove.slice(0, 2),
          endSquare: retry.bestMove.slice(2, 4),
          color: '#3f9a57',
        },
      ];
    }
    if (!inspected || !isBadMove(inspected.classification) || !inspected.best_move) return [];
    return [
      {
        startSquare: inspected.best_move.slice(0, 2),
        endSquare: inspected.best_move.slice(2, 4),
        color: '#3f9a57',
      },
    ];
  }, [inspected, retry]);

  const moveRows = useMemo(() => {
    const rows: Array<{
      number: number;
      white: (typeof evaluations)[number];
      black: (typeof evaluations)[number] | null;
    }> = [];
    for (let index = 0; index < evaluations.length; index += 2) {
      rows.push({
        number: evaluations[index].move_number,
        white: evaluations[index],
        black: evaluations[index + 1] ?? null,
      });
    }
    return rows;
  }, [evaluations]);

  const keyMoments = useMemo(
    () => evaluations.filter((entry) => isKeyMoment(entry.classification)),
    [evaluations],
  );

  const engineLabel =
    stockfish.status === 'loading'
      ? 'Loading Stockfish…'
      : stockfish.status === 'ready'
        ? `Stockfish ready · MultiPV 2 · depth ${reviewProfile.depth}`
        : stockfish.status === 'error'
          ? 'Engine error'
          : `Stockfish idle · depth ${reviewProfile.depth}`;

  /* -------------------------------- Input -------------------------------- */

  if (phase === 'input') {
    return (
      <section className="gr gr-input">
        <div className="gr-panel">
          <p className="gr-eyebrow">Analysis</p>
          <h2 className="gr-panel__title">Analyse a game</h2>
          <p className="gr-muted">
            Paste a PGN or upload a file. Stockfish runs locally in a Web Worker, opening-book
            moves are recognised instantly, and nothing leaves your browser.
          </p>

          <textarea
            id="review-pgn"
            className="gr-textarea"
            value={pgnText}
            onChange={(event) => setPgnText(event.target.value)}
            placeholder={`[Event "Club game"]\n[White "You"]\n[Black "Opponent"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 ...`}
            spellCheck={false}
            rows={8}
          />

          <div className="gr-depth" role="group" aria-label="Review depth">
            <div className="gr-depth__head">
              <p className="gr-depth__title">Review depth</p>
              <span className="gr-depth__current">
                {reviewProfile.label} · depth {reviewProfile.depth}
              </span>
            </div>
            <div className="gr-depth__options">
              {REVIEW_PROFILE_IDS.map((id) => {
                const option = REVIEW_PROFILES[id];
                const active = reviewProfile.id === id;
                return (
                  <button
                    key={id}
                    type="button"
                    className={`gr-depth__option${active ? ' is-active' : ''}`}
                    aria-pressed={active}
                    onClick={() => setReviewProfile(id)}
                  >
                    <strong>{option.label}</strong>
                    <small>depth {option.depth}</small>
                  </button>
                );
              })}
            </div>
            <p className="gr-depth__hint">{reviewProfile.blurb}</p>
          </div>

          <div className="gr-input__actions">
            <button
              type="button"
              className="button button--ghost gr-upload"
              onClick={() => pgnFileRef.current?.click()}
            >
              Upload .pgn
            </button>
            <input
              ref={pgnFileRef}
              type="file"
              accept=".pgn,text/plain"
              onChange={handleFile}
              hidden
            />
            <button
              type="button"
              className="button"
              onClick={() => void runAnalysis()}
              disabled={!pgnText.trim() || stockfish.status === 'loading'}
            >
              Analyse game
            </button>
            <span className={`gr-engine gr-engine--${stockfish.status}`}>{engineLabel}</span>
          </div>

          <p className="gr-muted gr-book-note">
            Opening book: {bookReady ? 'Lichess ECO database loaded' : 'built-in fallback (loading Lichess ECO…)'}
          </p>

          {stockfish.error && <p className="gr-error">{stockfish.error}</p>}
          {error && <p className="gr-error">{error}</p>}
        </div>

        <div className="gr-panel">
          <p className="gr-eyebrow">Archive</p>
          <h2 className="gr-panel__title">Saved reviews</h2>
          {reviewsError && <p className="gr-error">{reviewsError}</p>}
          {reviews.length === 0 ? (
            <div className="gr-empty">
              <EmptyBoardArt glyph="♜" />
              <strong>No analysed games yet</strong>
              <p className="gr-muted">
                Finished reviews collect here with their accuracy, move grades and
                replay board — ready to reopen at any time.
              </p>
              <ul className="empty-points" aria-label="Saved review features">
                <li>Move grades</li>
                <li>Accuracy</li>
                <li>Key moments</li>
              </ul>
              <button
                type="button"
                className="button button--ghost"
                onClick={focusPgn}
              >
                Paste your first game
              </button>
            </div>
          ) : (
            <ul className="gr-history">
              {reviews.map((review) => {
                const reviewSummary = summarizeReview(review);
                return (
                  <li key={review.game_id} className="gr-history__row">
                    <button
                      type="button"
                      className="gr-history__open"
                      onClick={() => openReview(review)}
                    >
                      <span className="gr-history__players">
                        {review.white_player} <span className="gr-vs">vs</span>{' '}
                        {review.black_player}
                      </span>
                      <span className="gr-history__meta">
                        {new Date(review.created_at).toLocaleString()} ·{' '}
                        {Math.ceil(review.evaluations.length / 2)} moves
                      </span>
                      <span className="gr-history__accuracy">
                        <span>{reviewSummary.whiteAccuracy.toFixed(1)}%</span>
                        <span className="gr-vs">/</span>
                        <span>{reviewSummary.blackAccuracy.toFixed(1)}%</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--small"
                      onClick={() => void runAnalysis(review)}
                      title={`Re-analyse at ${reviewProfile.label} depth (${reviewProfile.depth})`}
                    >
                      ↻ Re-review
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--small"
                      onClick={() => void deleteReview(review)}
                    >
                      Delete
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    );
  }

  /* ------------------------------ Analyzing ------------------------------ */

  if (phase === 'analyzing' || !active) {
    const percent =
      progress.total === 0 ? 0 : Math.round((progress.completed / progress.total) * 100);
    return (
      <section className="gr gr-analyzing">
        <div className="gr-panel gr-panel--centre">
          <p className="gr-eyebrow">
            Stockfish · MultiPV 2 · depth {reviewProfile.depth} · {reviewProfile.label}
          </p>
          <h2 className="gr-analyzing__title">
            Analysing move {progress.completed} of {progress.total}…
          </h2>
          <div
            className="gr-progress"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ width: `${percent}%` }} />
          </div>
          <p className="gr-muted">
            Book moves are skipped, so only the real decisions are searched. Cancel any time —
            finished moves are discarded.
          </p>
          <button type="button" className="button button--ghost" onClick={cancelAnalysis}>
            Cancel
          </button>
        </div>
      </section>
    );
  }

  /* -------------------------------- Review ------------------------------- */

  /*
   * The bar follows the engine's live best line, not the score stored for the
   * move that was played: while the passive search keeps deepening, PV1's score
   * moves with it, so the bar tracks what Stockfish currently believes instead
   * of freezing at the once-graded value. It falls back to the saved evaluation
   * whenever the live list is empty — the first moments after a step, and once
   * the search has finished.
   */
  const liveEval = !retry && candidates.length > 0 ? candidates[0] : null;
  const barEval = liveEval ? { cp: liveEval.scoreCp, mate: liveEval.mate } : currentEval;
  const whitePercent = whiteAdvantagePercent(barEval.cp, barEval.mate);
  const scoreLabel = formatEvaluation(barEval.cp, barEval.mate);
  const badgeSquare = inspected ? inspected.uci.slice(2, 4) : null;

  /* The board faces White unless a retry flips it to the side to move; the
     manual flip turns it around again, and the nameplates follow. */
  const bottomSide: 'white' | 'black' = retry && retry.color === 'b' ? 'black' : 'white';
  const orientation: 'white' | 'black' = flipped
    ? bottomSide === 'white'
      ? 'black'
      : 'white'
    : bottomSide;
  const playerAtBottom = orientation;
  const playerAtTop: 'white' | 'black' = orientation === 'white' ? 'black' : 'white';
  const accuracyOf = (side: 'white' | 'black') =>
    summary ? (side === 'white' ? summary.whiteAccuracy : summary.blackAccuracy) : null;
  const predictedOf = (side: 'white' | 'black') =>
    summary && analysedPlies >= 4
      ? estimateElo(
          accuracyOf(side) ?? 0,
          side === 'white' ? summary.whiteAverageCpl : summary.blackAverageCpl,
        )
      : null;

  return (
    <section className="gr gr-review">
      {/* Left rail: accuracy, move quality, evaluation graph. */}
      <aside className="gr-side gr-rail gr-rail--left">
        <div className="gr-rail__card">
          <div className="gr-rail__head">
            <div className="gr-rail__head-row">
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={() => setPhase('input')}
              >
                ← Games
              </button>
              <button
                type="button"
                className="button button--ghost button--small gr-rail__redo"
                onClick={() => void runAnalysis(active)}
                aria-label="Re-review this game"
                title={`Re-run this game at ${reviewProfile.label} depth (${reviewProfile.depth})`}
              >
                ↻
              </button>
            </div>
          </div>

          {summary && (
            <section className="gr-acc-card">
              <div className="gr-card__head">
                <h3 className="gr-card__title">Accuracy</h3>
              </div>
              <div className="gr-acc-grid">
                {(['white', 'black'] as const).map((side) => {
                  const accuracy = accuracyOf(side) ?? 0;
                  const cpl = side === 'white' ? summary.whiteAverageCpl : summary.blackAverageCpl;
                  return (
                    <div key={side} className={`gr-acc gr-acc--${side}`}>
                      <span className="gr-acc__side">{side === 'white' ? 'White' : 'Black'}</span>
                      <strong className="gr-acc__value">
                        {accuracy.toFixed(1)}
                        <small>%</small>
                      </strong>
                      <span className="gr-acc__meta">avg loss {Math.round(cpl)} cp</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {summary && (
            <section className="gr-quality">
              <div className="gr-classes">
                <div className="gr-classes__head">
                  <span>Move quality</span>
                  <span>W</span>
                  <span>B</span>
                </div>
                {SUMMARY_CLASSIFICATIONS.map((value) => {
                  const meta = classificationMeta(value);
                  const white = summary.whiteCounts[value];
                  const black = summary.blackCounts[value];
                  return (
                    <div key={value} className={`gr-classes__row gr-tone--${meta.tone}`}>
                      <span className="gr-classes__label">
                        <span className="gr-classes__icon" aria-hidden="true">
                          {meta.symbol}
                        </span>
                        {meta.label}
                      </span>
                      <span className={white > 0 ? 'is-on' : undefined}>{white}</span>
                      <span className={black > 0 ? 'is-on' : undefined}>{black}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="gr-predicted">
            <div className="gr-card__head">
              <h3 className="gr-card__title">Predicted rating</h3>
            </div>
            {(['white', 'black'] as const).map((side) => {
              const predicted = predictedOf(side);
              return (
                <div key={side} className="gr-predicted__row">
                  <span
                    className={`gr-player__dot gr-player__dot--${side}`}
                    aria-hidden="true"
                  />
                  <span className="gr-predicted__side">{side === 'white' ? 'White' : 'Black'}</span>
                  <span className="gr-predicted__value">
                    {predicted === null ? '—' : `≈ ${predicted}`}
                  </span>
                </div>
              );
            })}
          </section>

        </div>
      </aside>

      <div className="gr-board-col">
        <div className="gr-board-shell">
          <div className="gr-board-row">
            {/* Cards and board share one board-width stack, so a nameplate is
                always exactly as wide as the board it belongs to. */}
            <div className="gr-board-stack">
              {/* Nameplates sit on the players' own sides of the board and swap
                  with it when the board is flipped. */}
              <PlayerCard
                side={playerAtTop}
                name={playerAtTop === 'white' ? active.white_player : active.black_player}
                elo={playerAtTop === 'white' ? active.white_elo : active.black_elo}
                active={!retry && inspected?.color === (playerAtTop === 'white' ? 'w' : 'b')}
              />

              <div className="gr-board-wrap">
              {showEvalBar && (
                <div
                  className={`gr-eval-wrap${orientation === 'black' ? ' is-flipped' : ''}`}
                >
                  {/* The score sits on the lane, not inside the bar: a bar
                      clips its own overflow, and the number is wider than the
                      gauge. */}
                  <span
                    className={`gr-eval__label${whitePercent >= 50 ? ' is-white' : ' is-black'}`}
                  >
                    {scoreLabel}
                  </span>
                  <div className="gr-eval" aria-hidden="true">
                    <div className="gr-eval__fill" style={{ height: `${whitePercent}%` }} />
                  </div>
                </div>
              )}
              <BoardSlot
                props={{
                  fen: retry ? retry.fen : currentFen,
                  orientation,
                  interactive: Boolean(retry) && !retry?.correct && !retry?.revealed,
                  arrows,
                  badges:
                    !retry && badgeSquare && inspectedMeta
                      ? [
                          {
                            square: badgeSquare,
                            symbol: inspectedMeta.symbol,
                            tone: inspectedMeta.tone,
                            label: inspectedMeta.label,
                            pulse: inspected?.classification === 'clutch',
                          },
                        ]
                      : undefined,
                  onMove: handleRetryMove,
                }}
              />
              {/* Sized by dragging the board's own corner; the transport keeps
                  the − / + / Fit steps for taps and the keyboard. */}
              <BoardScaleGrip />
              </div>

              <PlayerCard
                side={playerAtBottom}
                name={playerAtBottom === 'white' ? active.white_player : active.black_player}
                elo={playerAtBottom === 'white' ? active.white_elo : active.black_elo}
                active={!retry && inspected?.color === (playerAtBottom === 'white' ? 'w' : 'b')}
              />
            </div>
          </div>

          {/* The transport sits below the board's own scroll window, so a board
              scaled past its column can never push the controls out of reach. */}
          {retry ? (
                <div className="gr-retry">
                  <p className="gr-retry__prompt">
                    Retry: {retry.color === 'w' ? 'White' : 'Black'} to play — find a better
                    move.
                  </p>
                  {retry.feedback && (
                    <p className={`gr-retry__feedback ${retry.correct ? 'is-good' : 'is-bad'}`}>
                      {retry.feedback}
                    </p>
                  )}
                  <div className="gr-retry__actions">
                    <button
                      type="button"
                      className="button button--ghost button--small"
                      onClick={tryAgain}
                    >
                      Try again
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--small"
                      onClick={() => setRetry(null)}
                    >
                      Back to review
                    </button>
                  </div>
                </div>
              ) : (
                <div className="gr-nav">
                  <button
                    type="button"
                    className="button button--ghost button--small"
                    onClick={() => setPly(0)}
                    aria-label="Start position"
                  >
                    «
                  </button>
                  <button
                    type="button"
                    className="button button--ghost button--small"
                    onClick={() => setPly((value) => Math.max(0, value - 1))}
                    aria-label="Previous move"
                  >
                    ‹
                  </button>
                  <span className="gr-nav__count">
                    {currentPly} / {totalPlies}
                  </span>
                  <button
                    type="button"
                    className="button button--ghost button--small"
                    onClick={() => setPly((value) => Math.min(totalPlies, value + 1))}
                    aria-label="Next move"
                  >
                    ›
                  </button>
                  <button
                    type="button"
                    className="button button--ghost button--small"
                    onClick={() => setPly(totalPlies)}
                    aria-label="Final position"
                  >
                    »
                  </button>
                  <button
                    type="button"
                    className="button button--ghost button--small gr-nav__flip"
                    onClick={() => setFlipped((value) => !value)}
                    aria-label="Flip board"
                    title="Flip board (X)"
                  >
                    ⇅
                  </button>
                  <button
                    type="button"
                    className="button button--ghost button--small gr-nav__eval"
                    onClick={() => setShowEvalBar((value) => !value)}
                    aria-pressed={showEvalBar}
                    aria-label={showEvalBar ? 'Hide evaluation bar' : 'Show evaluation bar'}
                    title={showEvalBar ? 'Hide evaluation bar' : 'Show evaluation bar'}
                  >
                    ±
                  </button>
                  {/* The same global board scale as the top bar, next to the
                      navigation it changes the look of. */}
                  <BoardScaleBar />
                </div>
              )}
        </div>
      </div>

      <aside className="gr-side gr-rail gr-rail--right">
        <div className="gr-rail__card">
        <section className="gr-active">
          {inspected && inspectedMeta ? (
            <>
              <div className="gr-active__row">
                <span
                  className={`gr-active__glyph gr-tone--${inspectedMeta.tone}`}
                  aria-hidden="true"
                >
                  {inspectedMeta.symbol}
                </span>
                <div className={`gr-active__bubble gr-tone--${inspectedMeta.tone}`}>
                  <div className="gr-active__head">
                    <span className="gr-active__label">{inspectedMeta.label}</span>
                    <span className="gr-active__score">
                      {formatEvaluation(inspected.eval_after, inspected.mate_after)}
                    </span>
                  </div>
                  <p className="gr-active__move">
                    {inspected.move_number}
                    {inspected.color === 'w' ? '.' : '…'} {inspected.san}
                  </p>

                  <p className="gr-coach__text">
                {coachSentence ?? (
                  <>
                    {inspectedMeta.headline}
                    {inspected.classification !== 'book' &&
                      !coachPlayedBest &&
                      coachBest &&
                      inspected.centipawn_loss > 10 && (
                        <>
                          {' '}
                          Better was <strong>{coachBest}</strong> (
                          {formatEvaluation(inspected.eval_before, inspected.mate_before)}).
                        </>
                      )}
                    {inspected.classification === 'book' && opening && (
                      <> This position is {opening.name} ({opening.eco}).</>
                    )}
                  </>
                )}
                  </p>
                </div>
              </div>

              <div className="gr-coach__actions">
                {canRetry(inspected.classification) && inspected.best_move && (
                  <button type="button" className="button" onClick={startRetry}>
                    Retry move
                  </button>
                )}
                {EXPORTABLE_CLASSES.has(inspected.classification) && (
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => void exportToWoodpecker()}
                    disabled={exporting}
                    title={`Appends this tactic to your “${MY_GAME_BLUNDERS_SET_NAME}” deck`}
                  >
                    {exporting ? 'Saving…' : '🪶 Add to Woodpecker Set'}
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="gr-active__row">
                <span className="gr-active__glyph" aria-hidden="true">
                  ±
                </span>
                <div className="gr-active__bubble">
                  <div className="gr-active__head">
                    <span className="gr-active__label">Position</span>
                    <span className="gr-active__score">{scoreLabel}</span>
                  </div>
                  <p className="gr-active__move">Start position</p>
                  <p className="gr-coach__text">
                    Step through with ← / →, jump to the start or end with ↑ / ↓, and flip
                    the board with X.
                  </p>
                </div>
              </div>
            </>
          )}

          <div className="gr-active__engine">
            <p className="gr-opening-strip" title={opening?.name ?? 'No known opening'}>
              {opening ? (
                <>
                  <span className="gr-opening__eco">{opening.eco}</span>
                  <span className="gr-opening-strip__name">{opening.name}</span>
                </>
              ) : (
                <span className="gr-opening-strip__name is-muted">No known opening</span>
              )}
            </p>
            <div className="gr-card__head">
              <h3 className="gr-card__title">Top moves</h3>
              <span className={`gr-candidates__status${candidatesPending ? ' is-busy' : ''}`}>
                {candidatesPending
                  ? `Searching… depth ${candidateDepth || '–'}`
                  : `depth ${candidateDepth || LIVE_DEPTH}`}
              </span>
            </div>
            {candidates.length === 0 ? (
              <p className="gr-muted">
                {candidatesPending
                  ? 'The engine is looking at this position…'
                  : 'No engine lines for this position.'}
              </p>
            ) : (
              <ol className="gr-candidates__list">
                {candidates.map((candidate) => (
                  <li
                    key={`${candidate.rank}-${candidate.uci}`}
                    className={`gr-candidate${candidate.rank === 1 ? ' is-best' : ''}`}
                  >
                    <span
                      className={`gr-candidate__eval${evaluationSide(
                        candidate,
                      ) === 'white' ? ' is-white' : ' is-black'}`}
                    >
                      {candidateScoreLabel(candidate)}
                    </span>
                    <span className="gr-candidate__san">
                      {formatPvLine(currentFen, candidate.pv) ||
                        uciToSan(currentFen, candidate.uci)}
                    </span>
                    <span className="gr-candidate__chev" aria-hidden="true">
                      ▾
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>

        <section className="gr-moves-card">
          <div className="gr-card__head">
            <h3 className="gr-card__title">Moves</h3>
            <button
              type="button"
              className={`gr-toggle ${keyMomentsOnly ? 'is-active' : ''}`}
              aria-pressed={keyMomentsOnly}
              onClick={() => setKeyMomentsOnly((value) => !value)}
            >
              ⚡ Key moments
            </button>
          </div>

          {keyMomentsOnly && (
            <div className="gr-keynav">
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={() => jumpKeyMoment(-1)}
              >
                ‹ Prev
              </button>
              <span className="gr-muted">{keyMoments.length} key moments</span>
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={() => jumpKeyMoment(1)}
              >
                Next ›
              </button>
            </div>
          )}

          <div className="gr-moves__list">
            {keyMomentsOnly ? (
              keyMoments.length === 0 ? (
                <p className="gr-muted">No key moments in this game.</p>
              ) : (
                keyMoments.map((entry) => {
                  const meta = classificationMeta(entry.classification);
                  return (
                    <button
                      key={entry.ply}
                      type="button"
                      className={`gr-keymove gr-tone--${meta.tone} ${
                        currentPly === entry.ply ? 'is-active' : ''
                      }`}
                      onClick={() => {
                        setRetry(null);
                        setPly(entry.ply);
                      }}
                    >
                      <span className="gr-keymove__num">
                        {entry.move_number}
                        {entry.color === 'w' ? '.' : '…'}
                      </span>
                      <span className="gr-keymove__san">{entry.san}</span>
                      <span className="gr-keymove__badge">
                        {meta.symbol} {meta.label}
                      </span>
                      <span className="gr-keymove__eval">
                        {formatEvaluation(entry.eval_after, entry.mate_after)}
                      </span>
                    </button>
                  );
                })
              )
            ) : (
              moveRows.map((row) => (
                <div key={row.number} className="gr-move-row">
                  <span className="gr-move-num">{row.number}.</span>
                  {[row.white, row.black].map((entry, index) =>
                    entry ? (
                      <button
                        key={entry.ply}
                        type="button"
                        className={`gr-move gr-tone--${classificationMeta(entry.classification).tone} ${
                          currentPly === entry.ply ? 'is-active' : ''
                        }`}
                        onClick={() => {
                          setRetry(null);
                          setPly(entry.ply);
                        }}
                      >
                        <span>{entry.san}</span>
                        <span className="gr-move__icon">
                          {classificationMeta(entry.classification).symbol}
                        </span>
                      </button>
                    ) : (
                      <span key={`empty-${index}`} />
                    ),
                  )}
                </div>
              ))
            )}
          </div>
        </section>
        </div>
      </aside>

      {toast && (
        <div
          className={`gr-toast ${toast.tone === 'error' ? 'is-error' : ''}`}
          role="status"
          aria-live="polite"
        >
          {toast.message}
        </div>
      )}
    </section>
  );
}
