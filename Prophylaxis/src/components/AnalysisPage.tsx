import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess, type Move } from 'chess.js';
import { BoardSlot } from '../board/PersistentBoard';
import ShareSheet from './ShareSheet';
import { START_FEN } from './ChessBoardWrapper';
import {
  useStockfish,
  type EngineCandidate,
  type EngineEvaluation,
} from '../engine/useStockfish';
import { formatEvaluation, whiteAdvantagePercent } from '../review/gameReviewService';
/* The sandbox borrows the review room's board grammar (plates, eval lane,
   transport, candidate rows and move list) rather than restating it. */
import './GameReviewDashboard.css';
import './AnalysisPage.css';

/**
 * A free analysis board, independent of saved games.
 *
 * The position lives in a small move tree instead of a flat SAN list: stepping
 * back and playing a different move adds a sibling branch, so the first line is
 * never destroyed. Nothing here reads or writes `active_game`, the game store
 * or the review tables — the sandbox is a scratchpad and leaves no record.
 */

const ENGINE_DEPTH = 20;
const MULTI_PV = 3;
/** Plies of each engine line shown as clickable continuations. */
const PV_PLIES = 8;

interface Seat {
  name: string;
  elo: string;
}

const DEFAULT_WHITE: Seat = { name: 'Player', elo: '1500' };
const DEFAULT_BLACK: Seat = { name: 'Stockfish', elo: '2000' };

interface AnalysisNode {
  id: string;
  parent: string | null;
  san: string;
  uci: string;
  fen: string;
  color: 'w' | 'b';
  number: number;
}

interface AnalysisTree {
  root: string;
  nodes: Record<string, AnalysisNode>;
  /** Ordered child ids per node: the first child is the main continuation. */
  children: Record<string, string[]>;
}

function createTree(fen: string): AnalysisTree {
  return {
    root: 'root',
    nodes: {
      root: { id: 'root', parent: null, san: '', uci: '', fen, color: 'w', number: 1 },
    },
    children: { root: [] },
  };
}

let nodeSeq = 0;

/**
 * Adds (or reuses) one move below `fromId`. Playing the same move twice on the
 * same parent walks the existing branch instead of duplicating it.
 */
function appendUci(
  tree: AnalysisTree,
  fromId: string,
  uci: string,
): { tree: AnalysisTree; id: string } | null {
  const parent = tree.nodes[fromId];
  if (!parent || !uci) return null;

  const existing = (tree.children[fromId] ?? []).find(
    (childId) => tree.nodes[childId]?.uci === uci,
  );
  if (existing) return { tree, id: existing };

  const game = new Chess(parent.fen);
  const color = game.turn() === 'w' ? 'w' : 'b';
  const number = Number.parseInt(parent.fen.split(' ')[5] ?? '1', 10) || 1;
  let move: Move;
  try {
    move = game.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      ...(uci.length > 4 ? { promotion: uci[4] } : {}),
    });
  } catch {
    return null;
  }

  nodeSeq += 1;
  const id = `n${nodeSeq}`;
  return {
    tree: {
      ...tree,
      nodes: {
        ...tree.nodes,
        [id]: { id, parent: fromId, san: move.san, uci, fen: game.fen(), color, number },
      },
      children: {
        ...tree.children,
        [fromId]: [...(tree.children[fromId] ?? []), id],
        [id]: [],
      },
    },
    id,
  };
}

/** Root → node, so the move list always describes the line on the board. */
function pathTo(tree: AnalysisTree, id: string): AnalysisNode[] {
  const out: AnalysisNode[] = [];
  let cursor: string | null = id;
  while (cursor && tree.nodes[cursor]) {
    out.push(tree.nodes[cursor]);
    cursor = tree.nodes[cursor].parent;
  }
  return out.reverse();
}

/** Plies in the longest line under the root, for the transport's readout. */
function deepestLine(tree: AnalysisTree): number {
  let best = 0;
  const stack: Array<[string, number]> = [[tree.root, 0]];
  while (stack.length > 0) {
    const [id, depth] = stack.pop()!;
    best = Math.max(best, depth);
    for (const child of tree.children[id] ?? []) stack.push([child, depth + 1]);
  }
  return best;
}

/** One move of an engine line, numbered the way a scoresheet numbers it. */
interface PvToken {
  label: string;
  index: number;
}

function pvTokens(fen: string, pv: readonly string[]): PvToken[] {
  const game = new Chess(fen);
  const out: PvToken[] = [];
  for (let index = 0; index < pv.length && index < PV_PLIES; index += 1) {
    const [, turn, , , , fullmove] = game.fen().split(' ');
    try {
      const move = game.move({
        from: pv[index].slice(0, 2),
        to: pv[index].slice(2, 4),
        ...(pv[index].length > 4 ? { promotion: pv[index][4] } : {}),
      });
      out.push({
        label:
          turn === 'w'
            ? `${fullmove}. ${move.san}`
            : index === 0
              ? `${fullmove}… ${move.san}`
              : move.san,
        index,
      });
    } catch {
      break;
    }
  }
  return out;
}

function eloLabel(value: string): string {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? String(parsed) : '—';
}

function clampElo(value: string): string {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return String(1500);
  return String(Math.max(100, Math.min(3000, parsed)));
}

function escapePgn(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function pgnDate(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}`;
}

/**
 * One player plate, the review's nameplate with its two figures as fields:
 * the name where the name goes, the rating inside the Elo chip.
 */
function SeatPlate({
  side,
  seat,
  onChange,
  onBlur,
}: {
  side: 'white' | 'black';
  seat: Seat;
  onChange: (patch: Partial<Seat>) => void;
  onBlur: () => void;
}) {
  const label = side === 'white' ? 'White' : 'Black';
  return (
    <div className={`gr-player gr-player--${side}`}>
      <span className={`gr-player__dot gr-player__dot--${side}`} aria-hidden="true" />
      <span className="gr-player__id">
        <input
          className="gr-player__name gr-player__input"
          type="text"
          value={seat.name}
          aria-label={`${label} player name`}
          title={`${label} player name`}
          spellCheck={false}
          onChange={(event) => onChange({ name: event.target.value })}
          onBlur={onBlur}
        />
        <span className="gr-player__elo" title={`${label} rating`}>
          <input
            className="gr-player__input gr-player__elo-input"
            type="number"
            inputMode="numeric"
            min={100}
            max={3000}
            step={50}
            value={seat.elo}
            aria-label={`${label} rating`}
            onChange={(event) => onChange({ elo: event.target.value })}
            onBlur={onBlur}
          />
        </span>
      </span>
    </div>
  );
}

export interface AnalysisPageProps {
  /** Hands the line on the board to Game Review for a full grading pass. */
  onSendToReview?: (pgn: string) => void;
}

export default function AnalysisPage({ onSendToReview }: AnalysisPageProps = {}) {
  const { status, error, analysePosition, stop } = useStockfish();

  const [tree, setTree] = useState<AnalysisTree>(() => createTree(START_FEN));
  const [currentId, setCurrentId] = useState('root');
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [white, setWhite] = useState<Seat>(DEFAULT_WHITE);
  const [black, setBlack] = useState<Seat>(DEFAULT_BLACK);

  const [lines, setLines] = useState<EngineCandidate[]>([]);
  const [depth, setDepth] = useState(0);
  const [searching, setSearching] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [finalScore, setFinalScore] = useState<{ cp: number; mate: number | null }>({
    cp: 0,
    mate: null,
  });

  const [fenOpen, setFenOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [fenDraft, setFenDraft] = useState('');
  const [fenError, setFenError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const current = tree.nodes[currentId] ?? tree.nodes[tree.root];
  const currentFen = current.fen;

  const say = useCallback((message: string) => {
    if (noteTimer.current) clearTimeout(noteTimer.current);
    setNote(message);
    noteTimer.current = setTimeout(() => setNote(null), 2400);
  }, []);

  useEffect(
    () => () => {
      if (noteTimer.current) clearTimeout(noteTimer.current);
    },
    [],
  );

  /* The search restarts on every position; an abandoned search is stopped so a
     stale line can never arrive after the board has moved on. */
  useEffect(() => {
    let cancelled = false;
    setLines([]);
    setDepth(0);
    setSearching(true);
    setEngineError(null);

    const onProgress = (evaluation: EngineEvaluation) => {
      if (cancelled) return;
      setLines(evaluation.candidates);
      setDepth(evaluation.depth);
    };

    analysePosition(currentFen, {
      depth: ENGINE_DEPTH,
      multiPv: MULTI_PV,
      onProgress,
    })
      .then((evaluation) => {
        if (cancelled) return;
        setLines(evaluation.candidates);
        setDepth(evaluation.depth);
        setFinalScore({ cp: evaluation.scoreCp, mate: evaluation.mate });
        setSearching(false);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setSearching(false);
        setEngineError(
          cause instanceof Error
            ? cause.message
            : 'The engine could not analyse this position.',
        );
      });

    return () => {
      cancelled = true;
      stop();
    };
  }, [analysePosition, currentFen, stop]);

  const play = useCallback(
    (uci: string) => {
      const result = appendUci(tree, currentId, uci);
      if (!result) return;
      setTree(result.tree);
      setCurrentId(result.id);
    },
    [currentId, tree],
  );

  const handleBoardMove = useCallback(
    (move: Move) => {
      play(`${move.from}${move.to}${move.promotion ?? ''}`);
    },
    [play],
  );

  const playLine = useCallback(
    (pv: readonly string[], index: number) => {
      let nextTree = tree;
      let nextId = currentId;
      for (let i = 0; i <= index && i < pv.length; i += 1) {
        const result = appendUci(nextTree, nextId, pv[i]);
        if (!result) break;
        nextTree = result.tree;
        nextId = result.id;
      }
      setTree(nextTree);
      setCurrentId(nextId);
    },
    [currentId, tree],
  );

  const path = useMemo(() => pathTo(tree, currentId), [currentId, tree]);
  const plies = useMemo(() => path.slice(1), [path]);
  const mainLength = useMemo(() => deepestLine(tree), [tree]);
  const parentNode = current.parent ? tree.nodes[current.parent] : null;
  const siblings = current.parent ? tree.children[current.parent] ?? [] : [];
  const continuations = tree.children[currentId] ?? [];

  const board = useMemo(() => new Chess(currentFen), [currentFen]);
  const gameOver = board.isGameOver();

  const best = lines[0] ?? null;
  const scoreCp = best?.scoreCp ?? finalScore.cp;
  const mate = best?.mate ?? finalScore.mate;
  const whitePercent =
    gameOver && board.isCheckmate()
      ? board.turn() === 'w'
        ? 0
        : 100
      : whiteAdvantagePercent(scoreCp, mate);
  const bestMove = best?.uci ?? '';
  const arrows = useMemo(
    () =>
      bestMove
        ? [{ startSquare: bestMove.slice(0, 2), endSquare: bestMove.slice(2, 4) }]
        : undefined,
    [bestMove],
  );

  const lastMove = current.uci
    ? { from: current.uci.slice(0, 2), to: current.uci.slice(2, 4) }
    : null;

  const rows = useMemo(() => {
    const out: Array<{ number: number; white: AnalysisNode | null; black: AnalysisNode | null }> = [];
    for (const node of plies) {
      const last = out[out.length - 1];
      if (node.color === 'w' || !last || last.number !== node.number) {
        out.push({
          number: node.number,
          white: node.color === 'w' ? node : null,
          black: node.color === 'b' ? node : null,
        });
      } else {
        last.black = node;
      }
    }
    return out;
  }, [plies]);

  const pgn = useMemo(() => {
    const root = tree.nodes[tree.root];
    const headers = [
      '[Event "Analysis"]',
      '[Site "Prophylaxis"]',
      `[Date "${pgnDate()}"]`,
      `[White "${escapePgn(white.name.trim() || 'White')}"]`,
      `[Black "${escapePgn(black.name.trim() || 'Black')}"]`,
      `[WhiteElo "${eloLabel(white.elo)}"]`,
      `[BlackElo "${eloLabel(black.elo)}"]`,
      '[Result "*"]',
    ];
    if (root.fen !== START_FEN) {
      headers.push('[SetUp "1"]', `[FEN "${root.fen}"]`);
    }
    const moves = plies
      .map((node) => (node.color === 'w' ? `${node.number}. ${node.san}` : node.san))
      .join(' ');
    return `${headers.join('\n')}\n\n${moves ? `${moves} *` : '*'}\n`;
  }, [black.name, black.elo, plies, tree, white.name, white.elo]);

  const copy = useCallback(
    async (text: string, message: string) => {
      try {
        await navigator.clipboard.writeText(text);
        say(message);
      } catch {
        say('Clipboard access was refused — select the text and copy it manually.');
      }
    },
    [say],
  );

  const downloadPgn = useCallback(() => {
    const slug = (value: string) =>
      value.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'player';
    const blob = new Blob([pgn], { type: 'application/x-chess-pgn' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${slug(white.name)}-${slug(black.name)}.pgn`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    say('PGN downloaded.');
  }, [black.name, pgn, say, white.name]);

  const closeShare = useCallback(() => setShareOpen(false), []);

  const loadFen = useCallback(() => {
    const trimmed = fenDraft.trim();
    if (!trimmed) {
      setFenError('Paste a FEN first.');
      return;
    }
    try {
      const game = new Chess(trimmed);
      setTree(createTree(game.fen()));
      setCurrentId('root');
      setFenDraft('');
      setFenError(null);
      setFenOpen(false);
      say('Position loaded.');
    } catch {
      setFenError('That FEN is not a legal position.');
    }
  }, [fenDraft, say]);

  const clearBoard = useCallback(() => {
    setTree(createTree(START_FEN));
    setCurrentId('root');
    setFenOpen(false);
    setFenError(null);
    say('Board cleared.');
  }, [say]);

  const goToEnd = useCallback(() => {
    let cursor = currentId;
    let next = tree.children[cursor]?.[0];
    while (next) {
      cursor = next;
      next = tree.children[cursor]?.[0];
    }
    setCurrentId(cursor);
  }, [currentId, tree]);

  /* ← / → step the line, Home returns to the start, End follows the main line
     out, X flips — the review screen's shortcuts, so the rooms read alike. */
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
        if (current.parent) setCurrentId(current.parent);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        const next = tree.children[currentId]?.[0];
        if (next) setCurrentId(next);
      } else if (event.key === 'Home') {
        event.preventDefault();
        setCurrentId(tree.root);
      } else if (event.key === 'End') {
        event.preventDefault();
        goToEnd();
      } else if (event.key === 'x' || event.key === 'X') {
        event.preventDefault();
        setOrientation((value) => (value === 'white' ? 'black' : 'white'));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [current.parent, currentId, goToEnd, tree]);

  const topSide = orientation === 'white' ? 'black' : 'white';
  const bottomSide = orientation === 'white' ? 'white' : 'black';

  const seatFor = (side: 'white' | 'black') => (side === 'white' ? white : black);
  const seatSetter = (side: 'white' | 'black') => (side === 'white' ? setWhite : setBlack);
  const seatBlur = (side: 'white' | 'black') => () => {
    const setSeat = seatSetter(side);
    setSeat((value) => ({ ...value, elo: clampElo(value.elo) }));
  };
  const seatPatch = (side: 'white' | 'black') => (patch: Partial<Seat>) => {
    const setSeat = seatSetter(side);
    setSeat((value) => ({ ...value, ...patch }));
  };

  const scoreLabel = formatEvaluation(scoreCp, mate);

  return (
    <section className="gr gr-analysis" aria-label="Analysis board">
      <div className="gr-board-col">
        <div className="gr-board-shell">
          <div className="gr-board-row">
            <div className="gr-board-stack">
              <SeatPlate
                side={topSide}
                seat={seatFor(topSide)}
                onChange={seatPatch(topSide)}
                onBlur={seatBlur(topSide)}
              />

              <div className="gr-board-wrap">
                <div
                  className={`gr-eval-wrap${orientation === 'black' ? ' is-flipped' : ''}`}
                >
                  <span
                    className={`gr-eval__label${whitePercent >= 50 ? ' is-white' : ' is-black'}`}
                  >
                    {scoreLabel}
                  </span>
                  <div
                    className="gr-eval"
                    role="meter"
                    aria-label="Evaluation"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(whitePercent)}
                    aria-valuetext={`${scoreLabel}, White ${Math.round(whitePercent)}%`}
                  >
                    <div className="gr-eval__fill" style={{ height: `${whitePercent}%` }} />
                  </div>
                </div>
                <BoardSlot
                  props={{
                    fen: currentFen,
                    orientation,
                    interactive: true,
                    highlightLastMove: true,
                    highlightCheck: true,
                    lastMove,
                    arrows,
                    onMove: handleBoardMove,
                  }}
                />
              </div>

              <SeatPlate
                side={bottomSide}
                seat={seatFor(bottomSide)}
                onChange={seatPatch(bottomSide)}
                onBlur={seatBlur(bottomSide)}
              />
            </div>
          </div>

          <div className="gr-nav">
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={() => setCurrentId(tree.root)}
              disabled={!current.parent}
              aria-label="Start position"
              title="Start position (Home)"
            >
              «
            </button>
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={() => current.parent && setCurrentId(current.parent)}
              disabled={!current.parent}
              aria-label="Previous move"
              title="Previous move (←)"
            >
              ‹
            </button>
            <span className="gr-nav__count">
              {plies.length} / {mainLength}
            </span>
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={() => {
                const next = continuations[0];
                if (next) setCurrentId(next);
              }}
              disabled={continuations.length === 0}
              aria-label="Next move"
              title="Next move (→)"
            >
              ›
            </button>
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={goToEnd}
              disabled={continuations.length === 0}
              aria-label="End of line"
              title="End of line (End)"
            >
              »
            </button>
            <button
              type="button"
              className="button button--ghost button--small gr-nav__flip"
              onClick={() => setOrientation((value) => (value === 'white' ? 'black' : 'white'))}
              aria-label="Flip board"
              title="Flip board (X)"
            >
              ⇅
            </button>
          </div>
        </div>
      </div>

      <aside className="gr-side gr-rail gr-rail--right" aria-label="Engine and move history">
        <div className="gr-rail__card">
          <section className="gr-active__engine">
            <p className="gr-opening-strip">
              <span className="gr-opening-strip__name is-muted">
                Sandbox · nothing is saved
              </span>
            </p>
            <div className="gr-card__head">
              <h3 className="gr-card__title">Top moves</h3>
              <span className={`gr-candidates__status${searching ? ' is-busy' : ''}`}>
                {status === 'error'
                  ? 'unavailable'
                  : searching
                    ? `Searching… depth ${depth || '–'}`
                    : `depth ${depth || ENGINE_DEPTH}`}
              </span>
            </div>

            {status === 'error' ? (
              <p className="gr-muted" role="alert">
                {error ?? 'The Stockfish worker could not start.'}
              </p>
            ) : lines.length === 0 ? (
              <p className="gr-muted">
                {gameOver
                  ? 'The game is over — there is nothing left to search.'
                  : 'The engine is looking at this position…'}
              </p>
            ) : (
              <ol className="gr-candidates__list">
                {lines.map((candidate) => {
                  const tokens = pvTokens(currentFen, candidate.pv);
                  const side = (candidate.mate ?? candidate.scoreCp) >= 0 ? 'is-white' : 'is-black';
                  return (
                    <li
                      key={`${candidate.rank}-${candidate.uci}`}
                      className={`gr-candidate${candidate.rank === 1 ? ' is-best' : ''}`}
                    >
                      <span className={`gr-candidate__eval ${side}`}>
                        {formatEvaluation(candidate.scoreCp, candidate.mate)}
                      </span>
                      <span className="gr-candidate__san gr-analysis__pv">
                        {tokens.map((token) => (
                          <button
                            key={`${candidate.rank}-${token.index}`}
                            type="button"
                            className="gr-analysis__pv-move"
                            title={`Play up to ${token.label}`}
                            onClick={() => playLine(candidate.pv, token.index)}
                          >
                            {token.label}
                          </button>
                        ))}
                      </span>
                      <span className="gr-candidate__chev" aria-hidden="true">
                        ▾
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}

            {engineError ? (
              <p className="gr-muted gr-analysis__error" role="alert">
                {engineError}
              </p>
            ) : null}
          </section>

          <section className="gr-moves-card">
            <div className="gr-card__head">
              <h3 className="gr-card__title">Moves</h3>
              <span className="gr-candidates__status">
                {plies.length} {plies.length === 1 ? 'ply' : 'plies'}
              </span>
            </div>

            {rows.length === 0 ? (
              <p className="gr-muted">
                No moves yet — play on the board, or click a move in an engine line.
              </p>
            ) : (
              <div className="gr-moves__list">
                {rows.map((row) => (
                  <div className="gr-move-row" key={`${row.number}-${row.white?.id ?? ''}`}>
                    <span className="gr-move-num">{row.number}.</span>
                    {[row.white, row.black].map((node, index) =>
                      node ? (
                        <button
                          key={node.id}
                          type="button"
                          className={`gr-move${currentId === node.id ? ' is-active' : ''}`}
                          onClick={() => setCurrentId(node.id)}
                        >
                          <span>{node.san}</span>
                          <span className="gr-move__icon" aria-hidden="true">
                            {(tree.children[node.id]?.length ?? 0) > 1 ? '⋔' : ''}
                          </span>
                        </button>
                      ) : (
                        <span key={`empty-${index}`} />
                      ),
                    )}
                  </div>
                ))}
              </div>
            )}

            {siblings.length > 1 && parentNode ? (
              <div className="gr-analysis__variations">
                <span className="gr-analysis__variations-label">
                  Variations at {parentNode.san || 'the start'}
                </span>
                <div className="gr-analysis__variations-list">
                  {siblings.map((id) => {
                    const node = tree.nodes[id];
                    if (!node) return null;
                    return (
                      <button
                        key={id}
                        type="button"
                        className={`gr-analysis__chip${id === currentId ? ' is-active' : ''}`}
                        onClick={() => setCurrentId(id)}
                      >
                        {node.san}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {continuations.length > 1 ? (
              <div className="gr-analysis__variations">
                <span className="gr-analysis__variations-label">Branches from here</span>
                <div className="gr-analysis__variations-list">
                  {continuations.map((id) => {
                    const node = tree.nodes[id];
                    if (!node) return null;
                    return (
                      <button
                        key={id}
                        type="button"
                        className="gr-analysis__chip"
                        onClick={() => setCurrentId(id)}
                      >
                        {node.san}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </section>

          <section className="gr-analysis__tools" aria-label="Board tools">
            <div className="gr-analysis__buttons">
              {onSendToReview ? (
                <button
                  type="button"
                  className="button button--small gr-analysis__send"
                  onClick={() => onSendToReview(pgn)}
                  disabled={plies.length === 0}
                  title={
                    plies.length === 0
                      ? 'Play a move first — Review grades the moves in this line'
                      : 'Grade every move of this line in Game Review'
                  }
                >
                  Send to Game Review
                </button>
              ) : null}
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={() => setOrientation((value) => (value === 'white' ? 'black' : 'white'))}
              >
                Flip
              </button>
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={() => setCurrentId(tree.root)}
                title="Return to the starting position of this line"
              >
                Reset
              </button>
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={clearBoard}
                title="Clear the line and start again from the standard position"
              >
                Clear board
              </button>
              <button
                type="button"
                className={`button button--ghost button--small${fenOpen ? ' is-active' : ''}`}
                aria-expanded={fenOpen}
                onClick={() => {
                  setFenOpen((value) => !value);
                  setFenError(null);
                }}
              >
                Load FEN
              </button>
              <button
                type="button"
                className="button button--ghost button--small"
                aria-haspopup="dialog"
                aria-expanded={shareOpen}
                onClick={() => setShareOpen(true)}
              >
                Share
              </button>
            </div>

            {fenOpen ? (
              <form
                className="gr-analysis__fen"
                onSubmit={(event) => {
                  event.preventDefault();
                  loadFen();
                }}
              >
                <input
                  className="gr-analysis__fen-input"
                  type="text"
                  value={fenDraft}
                  placeholder="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
                  aria-label="FEN to load"
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) => {
                    setFenDraft(event.target.value);
                    setFenError(null);
                  }}
                />
                <button type="submit" className="button button--small">
                  Load
                </button>
                <button
                  type="button"
                  className="button button--ghost button--small"
                  onClick={() => {
                    setFenOpen(false);
                    setFenError(null);
                  }}
                >
                  Cancel
                </button>
                {fenError ? (
                  <p className="gr-analysis__fen-error" role="alert">
                    {fenError}
                  </p>
                ) : null}
              </form>
            ) : null}

            <p className="gr-analysis__note" role="status" aria-live="polite">
              {note ?? ''}
            </p>
          </section>
        </div>
      </aside>

      <ShareSheet
        open={shareOpen}
        onClose={closeShare}
        title="Share position"
        subtitle={`${
          current.san
            ? `After ${current.number}${current.color === 'w' ? '.' : '…'} ${current.san}`
            : 'Start position'
        } · ${plies.length} ${plies.length === 1 ? 'move' : 'moves'} in this line`}
        activities={[
          {
            id: 'copy-pgn',
            label: 'Copy PGN',
            description: 'The whole line, with both players and their ratings',
            symbol: '⧉',
            onSelect: () => void copy(pgn, 'PGN copied.'),
          },
          {
            id: 'copy-fen',
            label: 'Copy FEN',
            description: 'The exact position on the board',
            symbol: '⌗',
            onSelect: () => void copy(currentFen, 'FEN copied.'),
          },
          {
            id: 'download-pgn',
            label: 'Download PGN',
            description: 'Save the line as a .pgn file',
            symbol: '↓',
            onSelect: downloadPgn,
          },
        ]}
      />
    </section>
  );
}
