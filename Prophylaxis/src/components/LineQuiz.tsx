import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Move } from 'chess.js';
import { type BoardArrow } from './ChessBoardWrapper';
import { BoardSlot, useBoardHandle } from '../board/PersistentBoard';
import type { QuizSegment } from '../courses/courseService';
import './LineQuiz.css';

/** Auto-played opponent moves pause here so the eye can follow. */
const OPPONENT_DELAY_MS = 420;
/** Hint the piece after this many wrong tries; solve it for them after five. */
const HINT_AFTER = 3;
const REVEAL_AFTER = 5;
/** How long the passed-chapter strip stays up before the hand-off. */
const ADVANCE_DELAY_MS = 1100;

export interface QuizResult {
  asked: number;
  clean: number;
  percent: number;
}

export interface LineQuizProps {
  /** Trunk first, then every written side line. */
  segments: QuizSegment[];
  /** The side being tested; the other side plays itself. */
  color: 'w' | 'b';
  title: string;
  /** Shown above the board, e.g. the chapter the quiz belongs to. */
  subtitle?: string;
  onFinish: (result: QuizResult) => void;
  onExit: () => void;
  /**
   * When given, finishing the quiz goes straight on instead of stopping on a
   * results menu: the host decides what "next" means (the next chapter, the
   * next due line) and this is called a beat after the last move.
   */
  onNextChapter?: () => void;
  /** Where the hand-off goes, shown for the beat before it happens. */
  nextLabel?: string;
}

function uciOf(move: Move): string {
  return `${move.from}${move.to}${move.promotion ?? ''}`;
}

/** A segment with no moves for the tested side cannot be quizzed. */
function playableSegments(segments: QuizSegment[], color: 'w' | 'b'): QuizSegment[] {
  return segments.filter((segment) => segment.moves.some((move) => move.color === color));
}

/**
 * Line quiz: the opponent's moves play themselves, the player answers.
 *
 * Every correct move is one point; a move answered after mistakes, hints or a
 * reveal is not clean. The percentage is what the drill table stores.
 */
function LineQuizComponent({
  segments,
  color,
  title,
  subtitle,
  onFinish,
  onExit,
  onNextChapter,
  nextLabel,
}: LineQuizProps) {
  const other = color === 'w' ? 'b' : 'w';
  const own = useMemo(() => playableSegments(segments, color), [segments, color]);
  const opposite = useMemo(() => playableSegments(segments, other), [segments, other]);
  /* A study is usually written for one side, and the course's colour toggle can
     point at the other one. Asking the side that actually has moves beats a
     quiz that can never ask anything. */
  const switched = own.length === 0 && opposite.length > 0;
  const usable = switched ? opposite : own;
  const tested = switched ? other : color;

  const boardRef = useBoardHandle();
  const autoPlaying = useRef(false);
  const turnFen = useRef<string | null>(null);
  const mistakeRef = useRef(0);
  const finished = useRef(false);

  const [segmentIndex, setSegmentIndex] = useState(0);
  const [moveIndex, setMoveIndex] = useState(0);
  const [phase, setPhase] = useState<'run' | 'done'>('run');
  const [message, setMessage] = useState('Watch the reply, then play your move.');
  const [mistakes, setMistakes] = useState(0);
  const [asked, setAsked] = useState(0);
  const [clean, setClean] = useState(0);
  const [hint, setHint] = useState<BoardArrow | null>(null);
  const [result, setResult] = useState<QuizResult | null>(null);

  /* Held in a ref so a parent re-render cannot restart the hand-off timer. */
  const nextChapterRef = useRef(onNextChapter);
  nextChapterRef.current = onNextChapter;

  /* The quiz never parks on a menu: once the last move is answered it hands
     straight over. */
  useEffect(() => {
    if (phase !== 'done' || !nextChapterRef.current) return;
    const timer = setTimeout(() => nextChapterRef.current?.(), ADVANCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  const segment = usable[segmentIndex];
  const expected = segment?.moves[moveIndex];
  const totalAsked = useMemo(
    () =>
      usable.reduce(
        (sum, entry) => sum + entry.moves.filter((move) => move.color === tested).length,
        0,
      ),
    [usable, tested],
  );

  /* Fresh position whenever a new line starts. */
  useEffect(() => {
    if (phase !== 'run' || !segment) return;
    boardRef.current?.cancelPlayback();
    boardRef.current?.reset(segment.startFen);
    setHint(null);
    mistakeRef.current = 0;
    setMistakes(0);
  }, [phase, segment]);

  /* The engine of the quiz: advance or wait, one ply at a time. */
  useEffect(() => {
    if (phase !== 'run') return;
    if (!usable[segmentIndex]) return;
    if (!expected) {
      /* End of this line — start the next one, or close the quiz. */
      if (segmentIndex + 1 < usable.length) {
        setSegmentIndex((index) => index + 1);
        setMoveIndex(0);
        setMessage('Next line.');
      } else if (!finished.current) {
        finished.current = true;
        const percent = asked === 0 ? 0 : Math.round((clean / asked) * 100);
        const summary = { asked, clean, percent };
        setResult(summary);
        setPhase('done');
        onFinish(summary);
      }
      return;
    }

    if (expected.color === tested) {
      turnFen.current = boardRef.current?.getFen() ?? null;
      setMessage(
        segment.moves.some((move) => move.color !== color)
          ? 'Your move.'
          : 'Play your move.',
      );
      return;
    }

    autoPlaying.current = true;
    const timer = setTimeout(() => {
      void boardRef.current?.playMoves([expected.uci], { intervalMs: 120 }).finally(() => {
        autoPlaying.current = false;
        setMoveIndex((index) => index + 1);
      });
    }, OPPONENT_DELAY_MS);
    return () => {
      clearTimeout(timer);
      autoPlaying.current = false;
    };
  }, [
    asked,
    clean,
    expected,
    onFinish,
    phase,
    segment,
    segmentIndex,
    tested,
    usable,
  ]);

  const handleMove = useCallback(
    (move: Move) => {
      if (autoPlaying.current || phase !== 'run' || !expected) return;

      if (uciOf(move) === expected.uci) {
        setAsked((value) => value + 1);
        if (mistakeRef.current === 0) setClean((value) => value + 1);
        mistakeRef.current = 0;
        setMistakes(0);
        setHint(null);
        setMessage('Correct.');
        setMoveIndex((index) => index + 1);
        return;
      }

      /* Wrong move: take the piece back and let them try again. */
      mistakeRef.current += 1;
      setMistakes(mistakeRef.current);
      if (turnFen.current) boardRef.current?.reset(turnFen.current);

      if (mistakeRef.current >= REVEAL_AFTER) {
        setMessage(`That move was ${expected.san} — playing it for you.`);
        autoPlaying.current = true;
        setAsked((value) => value + 1);
        setTimeout(() => {
          void boardRef.current?.playMoves([expected.uci], { intervalMs: 120 }).finally(() => {
            autoPlaying.current = false;
            mistakeRef.current = 0;
            setMistakes(0);
            setHint(null);
            setMoveIndex((index) => index + 1);
          });
        }, 520);
        return;
      }

      if (mistakeRef.current >= HINT_AFTER) {
        setHint({
          startSquare: expected.uci.slice(0, 2),
          endSquare: expected.uci.slice(2, 4),
          color: '#d8b87d',
        });
        setMessage(`Not that one. The highlighted piece is the one — move it to ${expected.uci.slice(2, 4)}.`);
        return;
      }

      setMessage('Not that move. Look for the piece your line moves here.');
    },
    [expected, phase],
  );

  const restart = () => {
    finished.current = false;
    setSegmentIndex(0);
    setMoveIndex(0);
    setAsked(0);
    setClean(0);
    setResult(null);
    setPhase('run');
  };

  const progress = totalAsked === 0 ? 0 : Math.round((asked / totalAsked) * 100);

  return (
    <section className="quiz" aria-label={`${title} quiz`}>
      <header className="quiz__head">
        <div className="quiz__titles">
          <p className="quiz__eyebrow">{subtitle ?? 'Quiz'}</p>
          <h1>{title}</h1>
          <p className="quiz__meta">
            You play {tested === 'w' ? 'White' : 'Black'} ·{' '}
            {usable.length} line{usable.length === 1 ? '' : 's'} · {asked}/{totalAsked} moves
          </p>
        </div>
        <button type="button" className="secondary-btn" onClick={onExit}>
          Back to reading
        </button>
      </header>

      <div className="quiz__bar" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>

      {usable.length === 0 ? (
        <div className="quiz__done">
          <p className="quiz__eyebrow">Nothing to test</p>
          <p className="quiz__summary">
            This chapter has no moves in the PGN, so there is nothing to ask. Read the
            position, or import a study with played moves to test.
          </p>
          <div className="quiz__done-actions">
            <button type="button" className="secondary-btn" onClick={onExit}>
              Back to reading
            </button>
          </div>
        </div>
      ) : phase === 'done' && result ? (
        onNextChapter ? (
          <div className="quiz__done quiz__done--auto">
            <p className="quiz__eyebrow">Chapter passed · {result.percent}% clean</p>
            <p className="quiz__summary">
              {result.clean} of {result.asked} moves answered cleanly
              {nextLabel ? ` — moving on to ${nextLabel}.` : ' — moving on.'}
            </p>
          </div>
        ) : (
          <div className="quiz__done">
            <p className="quiz__eyebrow">Session complete</p>
            <p className="quiz__score">{result.percent}%</p>
            <p className="quiz__summary">
              {result.clean} of {result.asked} moves played cleanly
              {result.percent >= 90
                ? ' — this line is yours.'
                : ' — run it again while it is fresh.'}
            </p>
            <div className="quiz__done-actions">
              <button type="button" className="primary-btn" onClick={restart}>
                Drill it again
              </button>
              <button type="button" className="secondary-btn" onClick={onExit}>
                Back to reading
              </button>
            </div>
          </div>
        )
      ) : (
        <div className="quiz__stage">
          <div className="quiz__board">
            <BoardSlot
              props={{
                orientation: tested === 'w' ? 'white' : 'black',
                onMove: handleMove,
                arrows: hint ? [hint] : undefined,
                highlights: hint
                  ? { [hint.startSquare]: { background: 'rgba(216, 184, 125, 0.45)' } }
                  : undefined,
              }}
            />
          </div>

          <aside className="quiz__side" aria-live="polite">
            <p className="quiz__eyebrow">{segment?.label ?? 'Line'}</p>
            <p className="quiz__message">{message}</p>
            <dl className="quiz__stats">
              <div>
                <dt>Move</dt>
                <dd>
                  {Math.min(asked + 1, totalAsked)} / {totalAsked}
                </dd>
              </div>
              <div>
                <dt>Clean</dt>
                <dd>{clean}</dd>
              </div>
              <div>
                <dt>Tries</dt>
                <dd>{mistakes}</dd>
              </div>
            </dl>
            <p className="quiz__hint">
              The other side answers by itself. Wrong moves come back to you, so you can
              find the right piece.
            </p>
            {switched && (
              <p className="quiz__hint quiz__hint--warn">
                This chapter has no {color === 'w' ? 'White' : 'Black'} moves, so the quiz
                asks for {tested === 'w' ? 'White' : 'Black'}. Switch the course side in
                the library to test it the other way round.
              </p>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}

export default memo(LineQuizComponent);
