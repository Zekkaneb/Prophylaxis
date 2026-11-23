import { useCallback, useEffect, useRef, useState } from 'react';
import { Chess, type Move } from 'chess.js';
import { BoardSlot, useBoardHandle } from '../board/PersistentBoard';
import type { Puzzle, WoodpeckerCycleResult, WoodpeckerSet } from '../db';
import { PUZZLE_TIERS, getTier } from '../puzzles/puzzleTiers';
import EmptyBoardArt from './EmptyBoardArt';
import {
  clearWoodpeckerSession,
  completeCycle,
  createWoodpeckerSet,
  deleteWoodpeckerSet,
  getPuzzle,
  listWoodpeckerSets,
  readWoodpeckerSession,
  saveWoodpeckerSession,
  type PuzzleOutcome,
} from '../puzzles/woodpeckerService';
import './WoodpeckerTrainer.css';

/* -------------------------------------------------------------------------- */
/*                                  Helpers                                   */
/* -------------------------------------------------------------------------- */

type Phase = 'dashboard' | 'solving' | 'summary';

interface Feedback {
  tone: 'good' | 'bad';
  text: string;
}

interface PuzzleTimeline {
  moves: string[];
  /** `fens[i]` is the position before move `i`; the last entry is the final position. */
  fens: string[];
  solver: 'white' | 'black';
}

const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

function buildTimeline(puzzle: Puzzle): PuzzleTimeline {
  const game = new Chess(puzzle.fen);
  const moves = puzzle.moves.trim().split(/\s+/).filter(Boolean);
  const fens = [game.fen()];

  for (const notation of moves) {
    if (!UCI_RE.test(notation)) {
      throw new Error(`Puzzle ${puzzle.puzzle_id} has an invalid move "${notation}".`);
    }
    game.move({
      from: notation.slice(0, 2),
      to: notation.slice(2, 4),
      ...(notation.length === 5 ? { promotion: notation[4] } : {}),
    });
    fens.push(game.fen());
  }

  if (moves.length < 2) {
    throw new Error(`Puzzle ${puzzle.puzzle_id} has no solution moves.`);
  }

  return {
    moves,
    fens,
    solver: puzzle.fen.split(' ')[1] === 'w' ? 'black' : 'white',
  };
}

function toUci(move: Move): string {
  return `${move.from}${move.to}${move.promotion ?? ''}`;
}

function formatTime(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

function accuracy(correct: number, total: number): number {
  return total > 0 ? Math.round((correct / total) * 100) : 0;
}

/**
 * One dashed bar per planned cycle: filled once a cycle is finished, outlined
 * on the cycle in progress, dashed for the cycles still to come. A set without
 * a target still gets a track for what it has run plus the current cycle.
 */
function CycleTrack({ set, compact = false }: { set: WoodpeckerSet; compact?: boolean }) {
  const finished = new Set(set.history.map((entry) => entry.cycle_num));
  const target =
    set.cycle_target && set.cycle_target > 0
      ? set.cycle_target
      : Math.max(set.current_cycle, set.history.length + 1);
  const planned = target <= 40 ? target : 40;

  return (
    <div className={`wp-cycles-wrap${compact ? ' wp-cycles-wrap--compact' : ''}`}>
      <span className="wp-cycles__label">
        Cycles {finished.size}/{target}
      </span>
      <ol
        className={`wp-cycles${compact ? ' wp-cycles--compact' : ''}`}
        aria-label={`${finished.size} of ${target} cycles finished`}
      >
        {Array.from({ length: planned }, (_, index) => index + 1).map((cycle) => {
          const state = finished.has(cycle)
            ? 'done'
            : cycle === set.current_cycle
              ? 'current'
              : 'todo';
          return (
            <li
              key={cycle}
              className={`wp-cycle is-${state}`}
              title={`Cycle ${cycle}: ${
                state === 'done' ? 'finished' : state === 'current' ? 'in progress' : 'to do'
              }`}
            >
              <span className="visually-hidden">
                Cycle {cycle}:{' '}
                {state === 'done' ? 'finished' : state === 'current' ? 'in progress' : 'to do'}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/* -------------------------------------------------------------------------- */
/*                                  Component                                 */
/* -------------------------------------------------------------------------- */

export default function WoodpeckerTrainer() {
  const boardRef = useBoardHandle();

  const [phase, setPhase] = useState<Phase>('dashboard');
  const [sets, setSets] = useState<WoodpeckerSet[]>([]);
  const [tierSlug, setTierSlug] = useState<string>('intermediate');
  const [poolSizeInput, setPoolSizeInput] = useState('10');
  const [cyclesInput, setCyclesInput] = useState('7');
  const [timeLimitInput, setTimeLimitInput] = useState('0');

  const [activeSet, setActiveSet] = useState<WoodpeckerSet | null>(null);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [timeline, setTimeline] = useState<PuzzleTimeline | null>(null);
  const [puzzleIndex, setPuzzleIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [outcomes, setOutcomes] = useState<PuzzleOutcome[]>([]);
  const [locked, setLocked] = useState(true);
  const [moveIndex, setMoveIndex] = useState(1);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [summary, setSummary] = useState<{ set: WoodpeckerSet; result: WoodpeckerCycleResult } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The set form accepts typed values, so they are kept as strings and
  // validated together instead of fighting the browser on every keystroke.
  const parsedPoolSize = Number(poolSizeInput);
  const parsedCycles = Number(cyclesInput);
  const parsedMinutes = Number(timeLimitInput);
  const formValid =
    Number.isInteger(parsedPoolSize) &&
    parsedPoolSize >= 1 &&
    parsedPoolSize <= 5000 &&
    Number.isInteger(parsedCycles) &&
    parsedCycles >= 1 &&
    parsedCycles <= 100 &&
    Number.isFinite(parsedMinutes) &&
    parsedMinutes >= 0 &&
    parsedMinutes <= 120;

  const elapsedRef = useRef(0);
  const correctRef = useRef(0);
  /** True once the current puzzle is decided (solved or skipped). */
  const finishedRef = useRef(false);
  const replyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeUpRef = useRef(false);
  const finishingRef = useRef(false);

  useEffect(
    () => () => {
      if (replyTimer.current) clearTimeout(replyTimer.current);
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    },
    [],
  );

  useEffect(() => {
    elapsedRef.current = elapsed;
  }, [elapsed]);

  useEffect(() => {
    correctRef.current = correctCount;
  }, [correctCount]);

  /* ---------------------------- Stopwatch ---------------------------- */

  useEffect(() => {
    if (phase !== 'solving' || paused) return;
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [paused, phase]);

  /* ------------------- Refresh-safe session snapshot ------------------ */

  useEffect(() => {
    if (phase !== 'solving' || !activeSet) return;
    saveWoodpeckerSession({
      activeSetId: activeSet.set_id,
      currentIndex: puzzleIndex,
      elapsedSeconds: elapsed,
      correctCount,
      cycle: activeSet.current_cycle,
      outcomes,
    });
  }, [activeSet, correctCount, elapsed, outcomes, phase, puzzleIndex]);

  /* ---------------------------- Activation ---------------------------- */

  const activateSet = useCallback(
    (
      set: WoodpeckerSet,
      index: number,
      seconds: number,
      correct: number,
      restoredOutcomes: PuzzleOutcome[] = [],
    ) => {
      const safeIndex = Math.min(Math.max(index, 0), Math.max(0, set.puzzle_ids.length - 1));
      setActiveSet(set);
      setPuzzleIndex(safeIndex);
      setElapsed(seconds);
      elapsedRef.current = seconds;
      setCorrectCount(correct);
      correctRef.current = correct;
      setOutcomes(restoredOutcomes.slice(0, set.puzzle_ids.length));
      finishedRef.current = false;
      timeUpRef.current = false;
      finishingRef.current = false;
      setPaused(false);
      setFeedback(null);
      setSummary(null);
      setPhase('solving');
    },
    [],
  );

  /* ----------------------------- Initial data ------------------------- */

  /*
   * The Puzzles tab always opens on the menu. A saved session is not resumed
   * here: it only feeds the hub's "Continue cycle N" button and the progress
   * bar, so nobody is dropped onto a board before they have picked a set.
   */
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const list = await listWoodpeckerSets();
        if (!alive) return;
        setSets(list);

        const session = readWoodpeckerSession();
        if (session.activeSetId && !list.some((entry) => entry.set_id === session.activeSetId)) {
          clearWoodpeckerSession();
        }
      } catch (cause) {
        if (alive) setError(`Saved sets could not be loaded: ${String(cause)}`);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  /* --------------------------- Puzzle loading ------------------------- */

  useEffect(() => {
    if (phase !== 'solving' || !activeSet) return;
    const puzzleId = activeSet.puzzle_ids[puzzleIndex];
    let alive = true;

    setLocked(true);
    setPuzzle(null);
    setTimeline(null);
    setFeedback(null);
    setMoveIndex(1);
    finishedRef.current = false;

    getPuzzle(puzzleId)
      .then((next) => {
        if (!alive) return;
        if (!next) throw new Error('not found in the local database');
        const built = buildTimeline(next);
        setPuzzle(next);
        setTimeline(built);
      })
      .catch((cause: unknown) => {
        if (alive) setError(`Could not load puzzle ${puzzleId}: ${String(cause)}`);
      });

    return () => {
      alive = false;
      boardRef.current?.cancelPlayback();
    };
  }, [activeSet, phase, puzzleIndex]);

  /* ------------------ Opponent's blunder setup move ------------------- */

  useEffect(() => {
    if (!puzzle || !timeline) return;
    let alive = true;

    setLocked(true);
    boardRef.current?.reset(timeline.fens[0]);

    const timer = setTimeout(() => {
      void (async () => {
        if (!alive) return;
        await boardRef.current?.playMoves([timeline.moves[0]], { intervalMs: 120 });
        if (!alive) return;
        setLocked(false);
      })();
    }, 120);

    return () => {
      alive = false;
      clearTimeout(timer);
      boardRef.current?.cancelPlayback();
    };
  }, [puzzle, timeline]);

  /* ----------------------------- Cycle end ---------------------------- */

  const finishCycle = useCallback(
    async (finalCorrect: number) => {
      // The clock can expire while a solve is mid-flight; both paths call this,
      // so only the first one may close the cycle.
      if (!activeSet || finishingRef.current) return;
      finishingRef.current = true;
      setLocked(true);
      setPaused(true);

      try {
        const completed = await completeCycle(activeSet, finalCorrect, elapsedRef.current);
        setActiveSet(completed.set);
        setSummary(completed);
        setSets((previous) =>
          previous.map((entry) => (entry.set_id === completed.set.set_id ? completed.set : entry)),
        );
        /* The next cycle starts empty; the finished one lives in the set
           history and in the results screen's state. */
        saveWoodpeckerSession({
          activeSetId: completed.set.set_id,
          currentIndex: 0,
          elapsedSeconds: 0,
          correctCount: 0,
          cycle: completed.set.current_cycle,
          outcomes: [],
        });
        setPuzzleIndex(0);
        setCorrectCount(0);
        correctRef.current = 0;
        setElapsed(0);
        elapsedRef.current = 0;
        setPhase('summary');
      } catch (cause) {
        setError(`The finished cycle could not be saved: ${String(cause)}`);
        finishingRef.current = false;
        setLocked(false);
        setPaused(false);
      }
    },
    [activeSet],
  );

  /* --------------------------- Cycle time limit ------------------------ */

  useEffect(() => {
    if (phase !== 'solving' || paused || !activeSet) return;
    const limit = activeSet.time_limit_seconds ?? 0;
    if (limit <= 0 || elapsed < limit || timeUpRef.current) return;

    // The cycle budget is spent: save what was completed and show the summary
    // exactly as a normal finish would, so history stays comparable.
    timeUpRef.current = true;
    setFeedback({ tone: 'bad', text: 'Time limit reached — cycle saved.' });
    void finishCycle(correctRef.current);
  }, [activeSet, elapsed, finishCycle, paused, phase]);

  /**
   * Both exits from a puzzle go through here: solved, or skipped after a wrong
   * move. A puzzle counts as clean only when it was solved, and the next one
   * loads after a short beat so the banner is readable.
   */
  const advanceFromPuzzle = useCallback(
    async (outcome: PuzzleOutcome, message: string, tone: Feedback['tone']) => {
      if (!activeSet || finishedRef.current) return;
      finishedRef.current = true;
      setLocked(true);

      const nextCorrect = correctRef.current + (outcome === 'solved' ? 1 : 0);
      correctRef.current = nextCorrect;
      setCorrectCount(nextCorrect);

      const nextOutcomes = [...outcomes, outcome];
      setOutcomes(nextOutcomes);
      setFeedback({ tone, text: message });

      const nextIndex = puzzleIndex + 1;
      saveWoodpeckerSession({
        activeSetId: activeSet.set_id,
        currentIndex: nextIndex,
        elapsedSeconds: elapsedRef.current,
        correctCount: nextCorrect,
        cycle: activeSet.current_cycle,
        outcomes: nextOutcomes,
      });

      await wait(outcome === 'solved' ? 420 : 780);

      if (nextIndex >= activeSet.puzzle_ids.length) {
        await finishCycle(nextCorrect);
        return;
      }
      finishedRef.current = false;
      setPuzzleIndex(nextIndex);
    },
    [activeSet, finishCycle, outcomes, puzzleIndex],
  );

  const handlePuzzleSolved = useCallback(
    () => advanceFromPuzzle('solved', 'Solved.', 'good'),
    [advanceFromPuzzle],
  );

  /* --------------------------- Board events --------------------------- */

  const handleMove = useCallback(
    (move: Move) => {
      if (phase !== 'solving' || !timeline || locked) return;
      const expected = timeline.moves[moveIndex];
      if (!expected) return;

      if (toUci(move) === expected) {
        const nextIndex = moveIndex + 1;
        setFeedback({ tone: 'good', text: 'Correct.' });

        if (nextIndex >= timeline.moves.length) {
          void handlePuzzleSolved();
          return;
        }

        setLocked(true);
        setMoveIndex(nextIndex);
        if (replyTimer.current) clearTimeout(replyTimer.current);
        replyTimer.current = setTimeout(() => {
          void (async () => {
            const played = await boardRef.current?.playMoves([timeline.moves[nextIndex]], {
              intervalMs: 160,
            });
            if (played === false) {
              setLocked(false);
              return;
            }
            const afterReply = nextIndex + 1;
            if (afterReply >= timeline.moves.length) {
              void handlePuzzleSolved();
            } else {
              setMoveIndex(afterReply);
              setLocked(false);
            }
          })();
        }, 90);
        return;
      }

      /* One wrong move ends the puzzle: it is marked missed and skipped. */
      void advanceFromPuzzle('missed', 'Not the move — skipped. Next puzzle…', 'bad');
    },
    [advanceFromPuzzle, handlePuzzleSolved, locked, moveIndex, phase, timeline],
  );

  const handleIllegalMove = useCallback(() => {
    if (phase !== 'solving' || locked) return;
    setFeedback({ tone: 'bad', text: 'Illegal move — pieces snap back.' });
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(null), 1400);
  }, [locked, phase]);

  /* ----------------------------- Commands ----------------------------- */

  const focusBuilder = useCallback(() => {
    const field = document.getElementById('woodpecker-pool') as HTMLInputElement | null;
    field?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    field?.focus({ preventScroll: true });
  }, []);

  const startNewSet = async () => {
    const tier = getTier(tierSlug);
    if (!tier) return;

    if (!formValid) {
      setError('Use 1–5000 puzzles, 1–100 cycles and a time limit of 0–120 minutes.');
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await createWoodpeckerSet(tier, parsedPoolSize, {
        cycles: parsedCycles,
        timeLimitSeconds: Math.round(parsedMinutes * 60),
      });
      setSets(await listWoodpeckerSets());
      setNotice(
        created.available < parsedPoolSize
          ? `${tier.name} currently holds ${created.available} puzzles, so the set was frozen with ${created.available}.`
          : `Froze ${created.set.puzzle_ids.length} ${tier.name} puzzles.`,
      );
      activateSet(created.set, 0, 0, 0);
    } catch (cause) {
      setError(`The set could not be created: ${String(cause)}`);
    } finally {
      setBusy(false);
    }
  };

  const resumeSet = (set: WoodpeckerSet) => {
    const session = readWoodpeckerSession();
    const resumable =
      session.activeSetId === set.set_id && session.cycle === set.current_cycle
        ? session
        : null;
    activateSet(
      set,
      resumable?.currentIndex ?? 0,
      resumable?.elapsedSeconds ?? 0,
      resumable?.correctCount ?? 0,
    );
  };

  const removeSet = async (set: WoodpeckerSet) => {
    if (!window.confirm(`Delete this ${set.tier_name} set and its cycle history?`)) return;
    try {
      await deleteWoodpeckerSet(set.set_id);
      if (readWoodpeckerSession().activeSetId === set.set_id) clearWoodpeckerSession();
      if (activeSet?.set_id === set.set_id) {
        setActiveSet(null);
        setPhase('dashboard');
      }
      setSets(await listWoodpeckerSets());
    } catch (cause) {
      setError(`The set could not be deleted: ${String(cause)}`);
    }
  };

  const backToDashboard = () => {
    boardRef.current?.cancelPlayback();
    setPaused(true);
    setPhase('dashboard');
    setSummary(null);
    void listWoodpeckerSets()
      .then(setSets)
      .catch((cause: unknown) => setError(String(cause)));
  };

  const startCycle = () => {
    if (!activeSet) return;
    finishedRef.current = false;
    timeUpRef.current = false;
    finishingRef.current = false;
    setSummary(null);
    setPuzzleIndex(0);
    setCorrectCount(0);
    correctRef.current = 0;
    setOutcomes([]);
    setElapsed(0);
    elapsedRef.current = 0;
    setPaused(false);
    setFeedback(null);
    setPhase('solving');
  };

  /* ------------------------------ Dashboard --------------------------- */

  if (!activeSet || phase === 'dashboard') {
    /* The hub: which set the next board session belongs to, and how far its
       current cycle has already run. Derived from the saved session so it stays
       true after a refresh without another table read. */
    const session = readWoodpeckerSession();
    const hubSet =
      (session.activeSetId && sets.find((entry) => entry.set_id === session.activeSetId)) ||
      sets[0] ||
      null;
    const hubSession =
      hubSet && session.activeSetId === hubSet.set_id && session.cycle === hubSet.current_cycle
        ? session
        : null;
    const hubLast = hubSet?.history[hubSet.history.length - 1] ?? null;
    const hubDone = hubSession ? hubSession.outcomes.length : 0;

    return (
      <section className="wp-dashboard">
        {hubSet ? (
          <section className="wp-hub" aria-labelledby="wp-hub-title">
            <div className="wp-hub__main">
              <p className="wp-eyebrow">Selection hub</p>
              <h3 className="wp-hub__title" id="wp-hub-title">
                {hubSet.tier_name}
                <span className="wp-hub__cycle">
                  cycle {hubSet.current_cycle}
                  {hubSet.cycle_target ? ` of ${hubSet.cycle_target}` : ''}
                </span>
              </h3>
              <p className="wp-hub__meta">
                {hubSet.puzzle_ids.length} puzzles frozen in order ·{' '}
                {hubSet.history.length} cycle{hubSet.history.length === 1 ? '' : 's'} finished
                {hubLast
                  ? ` · last ${accuracy(hubLast.correct_count, hubLast.total_count)}% in ${formatTime(
                      hubLast.total_time_seconds,
                    )}`
                  : ' · not started yet'}
              </p>
              {hubSession ? (
                <p className="wp-hub__progress">
                  <span className="wp-hub__bar" aria-hidden="true">
                    <span
                      style={{
                        width: `${Math.round((hubDone / hubSet.puzzle_ids.length) * 100)}%`,
                      }}
                    />
                  </span>
                  {hubDone} of {hubSet.puzzle_ids.length} puzzles this cycle ·{' '}
                  {accuracy(hubSession.correctCount, hubDone || 1)}% clean
                </p>
              ) : null}
              <CycleTrack set={hubSet} />
            </div>

            <div className="wp-hub__actions">
              <button type="button" className="button" onClick={() => resumeSet(hubSet)}>
                {hubSession
                  ? `Continue cycle ${hubSet.current_cycle}`
                  : `Start cycle ${hubSet.current_cycle}`}
              </button>
              <span className="wp-hub__count">
                {sets.length} set{sets.length === 1 ? '' : 's'} in your library
              </span>
            </div>
          </section>
        ) : null}

        <div className="wp-panel">
          <header className="wp-panel__head">
            <p className="wp-eyebrow">Practice</p>
            <h2 className="wp-panel__title">New Woodpecker set</h2>
          </header>
          <p className="wp-muted">
            Pick a chess.com rating band (the library's Lichess-sourced ratings are
            shown on the chess.com scale, +200). Each band serves its harder half — Elite
            already starts at the top — and one-move puzzles are left out. The set is frozen
            in a fixed order and replayed cycle after cycle so you can measure speed and
            accuracy.
          </p>

          <div className="tier-grid">
            {PUZZLE_TIERS.map((tier) => (
              <button
                key={tier.slug}
                type="button"
                className={`tier-card ${tier.slug === tierSlug ? 'is-active' : ''}`}
                aria-pressed={tier.slug === tierSlug}
                onClick={() => setTierSlug(tier.slug)}
              >
                <span className="tier-card__name">{tier.name}</span>
                <span className="tier-card__range">
                  {tier.minRating}–{tier.maxRating}
                </span>
              </button>
            ))}
          </div>

          <div className="wp-fields">
            <label className="wp-field">
              Puzzles
              <input
                id="woodpecker-pool"
                type="number"
                inputMode="numeric"
                min={1}
                max={5000}
                step={1}
                value={poolSizeInput}
                onChange={(event) => setPoolSizeInput(event.target.value)}
              />
            </label>
            <label className="wp-field">
              Cycles
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                step={1}
                value={cyclesInput}
                onChange={(event) => setCyclesInput(event.target.value)}
              />
            </label>
            <label className="wp-field">
              Time limit (minutes, 0 = none)
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={120}
                step={1}
                value={timeLimitInput}
                onChange={(event) => setTimeLimitInput(event.target.value)}
              />
            </label>
          </div>

          <button
            type="button"
            className="button"
            onClick={startNewSet}
            disabled={busy || !formValid}
          >
            {busy
              ? 'Building set…'
              : `Create set · ${Number.isInteger(parsedPoolSize) ? parsedPoolSize : 0} puzzles`}
          </button>

          {notice && <p className="wp-notice">{notice}</p>}
          {error && <p className="wp-error">{error}</p>}
        </div>

        <div className="wp-panel">
          <header className="wp-panel__head">
            <p className="wp-eyebrow">Choose your set</p>
            <h2 className="wp-panel__title">Available sets</h2>
          </header>
          {sets.length === 0 ? (
            <div className="wp-empty">
              <EmptyBoardArt glyph="♟" />
              <strong>No saved cycles yet</strong>
              <p className="wp-muted">
                Freeze a small pool once, then replay the same puzzles until the patterns
                arrive on sight.
              </p>
              <ol className="wp-empty__steps">
                <li>
                  <span>1</span>
                  <p>Pick a rating band on the left.</p>
                </li>
                <li>
                  <span>2</span>
                  <p>Freeze the set and start a cycle.</p>
                </li>
                <li>
                  <span>3</span>
                  <p>Compare speed and accuracy each round.</p>
                </li>
              </ol>
              <button type="button" className="secondary-btn" onClick={focusBuilder}>
                Build my first set
              </button>
            </div>
          ) : (
            <ul className="set-list">
              {sets.map((entry) => {
                const last = entry.history[entry.history.length - 1];
                return (
                  <li key={entry.set_id} className="set-row">
                    <div>
                      <p className="set-row__title">{entry.tier_name}</p>
                      <p className="set-row__meta">
                        {entry.puzzle_ids.length} puzzles · cycle {entry.current_cycle}
                        {entry.cycle_target ? ` of ${entry.cycle_target}` : ''}
                        {entry.cycle_target && entry.history.length >= entry.cycle_target
                          ? ' · complete'
                          : ''}
                        {last
                          ? ` · last ${formatTime(last.total_time_seconds)} · ${accuracy(
                              last.correct_count,
                              last.total_count,
                            )}%`
                          : ' · not started'}
                      </p>
                      <CycleTrack set={entry} compact />
                      {entry.history.length > 0 ? (
                        <ol
                          className="set-row__history"
                          aria-label={`${entry.tier_name} recent cycles`}
                        >
                          {entry.history
                            .slice(-2)
                            .reverse()
                            .map((cycle) => (
                              <li key={cycle.cycle_num}>
                                <strong>Cycle {cycle.cycle_num}</strong>
                                <span>
                                  {accuracy(cycle.correct_count, cycle.total_count)}% clean
                                </span>
                                <span>{formatTime(cycle.total_time_seconds)}</span>
                              </li>
                            ))}
                        </ol>
                      ) : null}
                    </div>
                    <div className="set-row__actions">
                      <button
                        type="button"
                        className="button button--small"
                        onClick={() => resumeSet(entry)}
                      >
                        {entry.history.length > 0 ? `Cycle ${entry.current_cycle}` : 'Start'}
                      </button>
                      <button
                        type="button"
                        className="button button--ghost button--small"
                        onClick={() => void removeSet(entry)}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    );
  }

  /* ------------------------------- Session ---------------------------- */

  const total = activeSet.puzzle_ids.length;
  const limitSeconds = activeSet.time_limit_seconds ?? 0;
  const remaining = limitSeconds > 0 ? Math.max(0, limitSeconds - elapsed) : null;
  const solvedCount = outcomes.filter((outcome) => outcome === 'solved').length;
  const missedCount = outcomes.filter((outcome) => outcome === 'missed').length;
  const attempted = outcomes.length;
  const progress = total > 0 ? (attempted / total) * 100 : 0;
  const orientation = timeline?.solver ?? 'white';
  const userMoves = timeline ? Math.ceil((timeline.moves.length - 1) / 2) : 0;

  /* ------------------------------ Results ----------------------------- */

  if (phase === 'summary' && summary) {
    const result = summary.result;
    const skipped = outcomes.filter((outcome) => outcome === 'missed').length;
    /* A cycle cut short by the clock has puzzles that were never shown. */
    const unreached = Math.max(0, result.total_count - outcomes.length);
    const acc = accuracy(result.correct_count, result.total_count);
    const programmeDone = Boolean(
      summary.set.cycle_target && result.cycle_num >= summary.set.cycle_target,
    );
    const prior =
      summary.set.history.length > 1
        ? summary.set.history[summary.set.history.length - 2]
        : null;
    const timeDelta = prior ? result.total_time_seconds - prior.total_time_seconds : 0;
    const accuracyDelta = prior
      ? acc - accuracy(prior.correct_count, prior.total_count)
      : 0;

    return (
      <section className="wp-results">
        <div className="wp-results__hero">
          <p className="wp-eyebrow">
            {programmeDone ? 'Programme complete' : `Cycle ${result.cycle_num} complete`}
          </p>
          <p className="wp-results__score">
            {acc}
            <span>%</span>
          </p>
          <p className="wp-results__sub">
            {result.correct_count} of {result.total_count} solved · {skipped} skipped
            {unreached > 0 ? ` · ${unreached} not reached` : ''} ·{' '}
            {formatTime(result.total_time_seconds)}
          </p>

          <ol className="wp-dots" aria-label="Puzzle outcomes">
            {outcomes.map((outcome, index) => (
              <li
                key={`${index}-${outcome}`}
                className={`wp-dot is-${outcome}`}
                title={`Puzzle ${index + 1}: ${outcome}`}
              >
                {index + 1}
              </li>
            ))}
          </ol>

          <CycleTrack set={summary.set} />

          <p className="wp-results__delta">
            {prior
              ? `${timeDelta <= 0 ? `${Math.abs(timeDelta)}s faster` : `${timeDelta}s slower`} and ${
                  accuracyDelta >= 0 ? `+${accuracyDelta}` : accuracyDelta
                } points versus cycle ${prior.cycle_num}.`
              : 'First cycle of this set. Cycle 2 uses the same puzzles in the same order.'}
          </p>

          <div className="wp-results__actions">
            <button type="button" className="button" onClick={startCycle}>
              {programmeDone
                ? `Replay cycle ${summary.set.current_cycle}`
                : `Start cycle ${summary.set.current_cycle}`}
            </button>
            <button type="button" className="button button--ghost" onClick={backToDashboard}>
              Back to sets
            </button>
          </div>
          {programmeDone && (
            <p className="wp-muted">All {summary.set.cycle_target} planned cycles are done.</p>
          )}
        </div>

        <div className="wp-results__panel">
          <div className="wp-results__stats">
            <div>
              <span>Solved</span>
              <strong>{result.correct_count}</strong>
            </div>
            <div>
              <span>Skipped</span>
              <strong>{skipped}</strong>
            </div>
            <div>
              <span>Time</span>
              <strong>{formatTime(result.total_time_seconds)}</strong>
            </div>
          </div>

          <div className="wp-results__history">
            <h3>Cycle history</h3>
            <table className="wp-history">
              <thead>
                <tr>
                  <th>Cycle</th>
                  <th>Time</th>
                  <th>Solved</th>
                  <th>Acc.</th>
                </tr>
              </thead>
              <tbody>
                {summary.set.history.map((entry) => (
                  <tr key={entry.cycle_num}>
                    <td>{entry.cycle_num}</td>
                    <td>{formatTime(entry.total_time_seconds)}</td>
                    <td>
                      {entry.correct_count}/{entry.total_count}
                    </td>
                    <td>{accuracy(entry.correct_count, entry.total_count)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="wp">
      <div className="wp__board">
        <div className="wp__board-head">
          <div>
            <p
              className={`wp__timer${remaining !== null && remaining <= 30 ? ' is-low' : ''}`}
              aria-live="off"
            >
              {formatTime(remaining ?? elapsed)}
            </p>
            <p className="wp__timer-label">
              {remaining !== null ? 'Time left · ' : ''}Cycle {activeSet.current_cycle}
              {activeSet.cycle_target ? ` of ${activeSet.cycle_target}` : ''} ·{' '}
              {activeSet.tier_name}
            </p>
          </div>
        </div>

        <div className="wp__turnbar">
          <span className={`wp__turn wp__turn--${orientation}`}>
            <span className="wp__turn-piece" aria-hidden="true">
              {orientation === 'white' ? '♔' : '♚'}
            </span>
            {orientation === 'white' ? 'White' : 'Black'} to move
          </span>
          <span className="wp__turn-meta">
            {userMoves > 0
              ? `${userMoves} move${userMoves === 1 ? '' : 's'} to find`
              : 'Find the best move'}
          </span>
        </div>

        <div className="wp__board-wrap">
          <div className="wp__board-frame">
            <BoardSlot
              props={{
                orientation,
                interactive: phase === 'solving' && !paused && !locked,
                onMove: handleMove,
                onIllegalMove: handleIllegalMove,
                // No last-move tint while solving: the board stays readable
                // and the previous move cannot be mistaken for a hint.
                highlightLastMove: false,
              }}
            />
            {paused && (
              <div className="wp__veil">
                <p>Paused</p>
                <button
                  type="button"
                  className="button"
                  onClick={() => setPaused(false)}
                >
                  Resume cycle
                </button>
              </div>
            )}
          </div>
        </div>

        {feedback && (
          <div className={`wp-banner wp-banner--${feedback.tone}`} role="status">
            {feedback.text}
          </div>
        )}

        {/* Status strip under the board, the anchor every room shares. */}
        <div className="wp__board-foot">
          <span>
            Puzzle {Math.min(puzzleIndex + 1, total)} of {total}
          </span>
          <span>
            <strong>{solvedCount}</strong> solved · <strong>{missedCount}</strong> skipped
          </span>
        </div>
      </div>

      <aside className="wp__side">
        <header>
          <p className="wp-eyebrow">
            {activeSet.tier_name} · Cycle {activeSet.current_cycle}
          </p>
          <h2 className="wp-title">
            Puzzle {Math.min(puzzleIndex + 1, total)} of {total}
          </h2>
        </header>

        {notice && <p className="wp-notice">{notice}</p>}

        <div className="wp-meter">
          <div className="wp-meter__track">
            <span className="wp-meter__fill" style={{ width: `${progress}%` }} />
          </div>
          <p className="wp-meter__text">
            {attempted} of {total} done · {solvedCount} solved
          </p>
        </div>

        <dl className="wp-stats">
          <div>
            <dt>Solved</dt>
            <dd>{solvedCount}</dd>
          </div>
          <div>
            <dt>Skipped</dt>
            <dd>{missedCount}</dd>
          </div>
          <div>
            <dt>Accuracy</dt>
            <dd>{accuracy(solvedCount, attempted)}%</dd>
          </div>
        </dl>

        <p className="wp-muted">
          {puzzle
            ? `You play ${orientation === 'white' ? 'White' : 'Black'}. ${
                userMoves > 1 ? `${userMoves} moves to find.` : 'Find the best move.'
              }`
            : 'Loading puzzle…'}
        </p>

        {puzzle && (
          <div className="wp-chips">
            <span className="wp-chip">chess.com {puzzle.rating}</span>
            {puzzle.themes.slice(0, 3).map((theme) => (
              <span key={theme} className="wp-chip">
                {theme}
              </span>
            ))}
          </div>
        )}

        <div className="wp-rules">
          <p className="wp-eyebrow">How this works</p>
          <ul>
            <li>
              <span aria-hidden="true">✓</span>
              A correct line marks the puzzle solved.
            </li>
            <li>
              <span aria-hidden="true">✕</span>
              One wrong move skips it — accuracy counts solves only.
            </li>
            <li>
              <span aria-hidden="true">↻</span>
              Every cycle replays the same puzzles, in the same order.
            </li>
          </ul>
        </div>

        {activeSet.history.length > 0 && (
          <div className="wp-history-block">
            <h3>Previous cycles</h3>
            <table className="wp-history">
              <thead>
                <tr>
                  <th>Cycle</th>
                  <th>Time</th>
                  <th>Clean</th>
                  <th>Acc.</th>
                </tr>
              </thead>
              <tbody>
                {activeSet.history
                  .slice(-4)
                  .reverse()
                  .map((entry) => (
                    <tr key={entry.cycle_num}>
                      <td>{entry.cycle_num}</td>
                      <td>{formatTime(entry.total_time_seconds)}</td>
                      <td>
                        {entry.correct_count}/{entry.total_count}
                      </td>
                      <td>{accuracy(entry.correct_count, entry.total_count)}%</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Cycle progress and the room's actions live here, on the panel floor,
            so every control has one predictable home. */}
        <div className="wp__progress">
          <div className="wp__progress-head">
            <div>
              <p className="wp-eyebrow">This cycle</p>
              <p className="wp__progress-title">
                {solvedCount} solved · {missedCount} skipped
              </p>
            </div>
            <p className="wp__progress-remaining">
              {Math.max(0, total - attempted)} to go
            </p>
          </div>

          {total <= 60 ? (
            <ol className="wp-dots" aria-label="Puzzle outcomes">
              {activeSet.puzzle_ids.map((id, index) => {
                const outcome = outcomes[index];
                const state = outcome ?? (index === attempted ? 'current' : 'upcoming');
                return (
                  <li
                    key={id}
                    className={`wp-dot is-${state}`}
                    title={`Puzzle ${index + 1}: ${state}`}
                  >
                    {index + 1}
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="wp__progress-bar" aria-hidden="true">
              <span
                className="wp__progress-solved"
                style={{ width: `${(solvedCount / total) * 100}%` }}
              />
              <span
                className="wp__progress-missed"
                style={{ width: `${(missedCount / total) * 100}%` }}
              />
            </div>
          )}

          <div className="wp__side-actions">
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={() => setPaused((value) => !value)}
            >
              {paused ? 'Resume' : 'Pause'}
            </button>
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={backToDashboard}
            >
              Sets
            </button>
          </div>
        </div>
      </aside>

    </div>
  );
}
