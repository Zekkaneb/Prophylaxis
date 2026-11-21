import { useCallback, useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { assetText, assetUrl } from '../assets/assetUrl';
import { buildGoCommand } from './goCommand.ts';

export { buildGoCommand };

/**
 * Stockfish over UCI, running in a dedicated Web Worker so the UI thread never
 * blocks. The build is Stockfish 19 Lite with embedded NNUE weights, compiled
 * single-threaded: no SharedArrayBuffer, so it also runs on static hosts that
 * cannot send COOP/COEP headers.
 *
 * MultiPV is fixed at 2 so every position also returns the engine's second
 * choice — the review engine needs that gap to spot "only move" situations.
 */

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface EngineEvaluation {
  fen: string;
  /** Nominal search depth reported by the engine. */
  depth: number;
  /** PV1's first move in UCI (`e2e4`, `e7e8q`), or null for a finished game. */
  bestMove: string | null;
  /** PV2's first move, i.e. the engine's second choice. */
  secondBestMove: string | null;
  ponder: string | null;
  /** Principal variation of the best line. */
  pv: string[];
  /** Centipawns from White's point of view (mates mapped to ±100000). */
  scoreCp: number;
  /** Mate distance from White's point of view: +N White mates, -N Black mates, 0 side to move is mated. */
  mate: number | null;
  /** White-POV score of the second-best line. */
  secondScoreCp: number;
  /** Mate distance of the second-best line, White's point of view. */
  secondMate: number | null;
  /**
   * White-POV score PV1 reported at `SHALLOW_DEPTH` (6), i.e. what a quick
   * search thinks of this position. Falls back to the final score when the
   * engine never reached that depth.
   */
  shallowScoreCp: number;
  /** Mate distance reported at `SHALLOW_DEPTH`, White's point of view. */
  shallowMate: number | null;
  /** Top engine lines, best first (one per requested MultiPV slot). */
  candidates: EngineCandidate[];
}

/** One engine line, White's point of view. */
export interface EngineCandidate {
  /** 1 = best line. */
  rank: number;
  /** First move of the line, UCI. */
  uci: string;
  scoreCp: number;
  mate: number | null;
  pv: string[];
}

interface ParsedLine {
  depth: number;
  scoreCp: number;
  mate: number | null;
  pv: string[];
}

interface PendingRequest {
  fen: string;
  resolve: (evaluation: EngineEvaluation) => void;
  reject: (error: Error) => void;
  depth: number;
  /** Hard time cap for this search, ms; 0 means depth only. */
  movetimeMs: number;
  lines: Map<number, ParsedLine>;
  /** MultiPV slots requested for this search. */
  multiPv: number;
  /** PV1 snapshot at `SHALLOW_DEPTH`, captured while the search streams. */
  shallow: ParsedLine | null;
  bestMove: string | null;
  ponder: string | null;
  timer: ReturnType<typeof setTimeout>;
  /** True while an `isready` sent after a MultiPV change is still unanswered. */
  awaitingReady: boolean;
  /** Sends `position fen` + `go`; held back until the MultiPV option is live. */
  start: () => void;
  /** Streams the evaluation so far while the search deepens, when set. */
  onProgress: ((evaluation: EngineEvaluation) => void) | null;
  /** Timestamp of the last streamed update, so updates stay coarse. */
  lastProgressAt: number;
}

const WORKER_PATH = 'stockfish/sf19/stockfish.js';
const WORKER_URL = assetUrl(WORKER_PATH);

/**
 * The worker normally loads from the served folder. When the single-file build
 * inlined it, the source is wrapped in a Blob worker instead, with `locateFile`
 * pointing emscripten at the inlined `.wasm` — a Blob worker has no directory
 * to resolve `stockfish.wasm` against.
 */
function createEngineWorker(): Worker {
  const source = assetText(WORKER_PATH);
  if (!source) return new Worker(WORKER_URL);

  const wasm = assetUrl('stockfish/sf19/stockfish.wasm');
  // emscripten resolves `stockfish.wasm` against the worker's own location, and
  // a Blob worker has none, so the URL it builds is unusable. The engine never
  // fetches anything else, so answering every fetch with the inlined bytes is
  // enough to boot it.
  const glue = `(function () {
    var wasm = ${JSON.stringify(wasm)};
    var realFetch = self.fetch.bind(self);
    self.fetch = function (_input, init) {
      return realFetch(wasm, init);
    };
  })();\n`;
  const blob = new Blob([glue, source], { type: 'text/javascript' });
  return new Worker(URL.createObjectURL(blob));
}
/** MB of transposition table; plenty for depth-14 game review without the
 * 1 GB default the threaded builds allocate. */
const HASH_SIZE_MB = 32;
/** Number of engine lines per search: pv1 (best) and pv2 (runner-up). */
const MULTI_PV = 2;
const DEFAULT_DEPTH = 14;
/** Depth whose PV1 score is kept as the "human-visible" evaluation. */
const SHALLOW_DEPTH = 6;
const READY_TIMEOUT_MS = 20_000;
const SEARCH_TIMEOUT_MS = 60_000;
const MATE_SCORE = 100_000;
/**
 * Minimum gap between streamed evaluations. The engine reports every iteration
 * (and every PV refresh inside one), which is far more often than a person can
 * read or React should repaint.
 */
const PROGRESS_INTERVAL_MS = 150;

function terminalEvaluation(fen: string): EngineEvaluation | null {
  const probe = new Chess(fen);
  if (probe.isCheckmate()) {
    const whiteToMove = probe.turn() === 'w';
    const scoreCp = whiteToMove ? -MATE_SCORE : MATE_SCORE;
    return {
      fen,
      depth: 0,
      bestMove: null,
      secondBestMove: null,
      ponder: null,
      pv: [],
      scoreCp,
      mate: 0,
      secondScoreCp: scoreCp,
      secondMate: 0,
      shallowScoreCp: scoreCp,
      shallowMate: 0,
      candidates: [],
    };
  }
  if (probe.isStalemate() || probe.isInsufficientMaterial()) {
    return {
      fen,
      depth: 0,
      bestMove: null,
      secondBestMove: null,
      ponder: null,
      pv: [],
      scoreCp: 0,
      mate: null,
      secondScoreCp: 0,
      secondMate: null,
      shallowScoreCp: 0,
      shallowMate: null,
      candidates: [],
    };
  }
  return null;
}

/** Converts a raw UCI line (side-to-move POV) into a White-POV evaluation. */
function normalizeLine(line: ParsedLine | undefined, sign: number) {
  if (!line) return null;

  let scoreCp = sign * line.scoreCp;
  const mate = line.mate === null ? null : sign * line.mate;

  if (mate !== null) {
    // Fold the mate distance into a decisive centipawn score for comparisons.
    scoreCp = mate > 0 ? MATE_SCORE - mate : mate < 0 ? -MATE_SCORE - mate : sign * MATE_SCORE;
  }

  return { scoreCp, mate, pv: line.pv };
}

function buildEvaluation(request: PendingRequest): EngineEvaluation {
  const blackToMove = request.fen.split(' ')[1] === 'b';
  const sign = blackToMove ? -1 : 1;
  const first = normalizeLine(request.lines.get(1), sign);
  const second = normalizeLine(request.lines.get(2), sign);
  const shallow = normalizeLine(request.shallow ?? undefined, sign);

  const candidates: EngineCandidate[] = [];
  for (let rank = 1; rank <= request.multiPv; rank += 1) {
    const line = normalizeLine(request.lines.get(rank), sign);
    if (!line || line.pv.length === 0) continue;
    candidates.push({
      rank,
      uci: line.pv[0],
      scoreCp: line.scoreCp,
      mate: line.mate,
      pv: line.pv,
    });
  }

  return {
    fen: request.fen,
    depth: request.depth,
    bestMove: request.bestMove ?? first?.pv[0] ?? null,
    secondBestMove: second?.pv[0] ?? null,
    ponder: request.ponder,
    pv: first?.pv ?? [],
    scoreCp: first?.scoreCp ?? 0,
    mate: first?.mate ?? null,
    secondScoreCp: second?.scoreCp ?? first?.scoreCp ?? 0,
    secondMate: second?.mate ?? first?.mate ?? null,
    shallowScoreCp: shallow?.scoreCp ?? first?.scoreCp ?? 0,
    shallowMate: shallow?.mate ?? first?.mate ?? null,
    candidates,
  };
}

export interface StockfishController {
  status: EngineStatus;
  error: string | null;
  /**
   * Evaluates one position at the given depth and MultiPV width. Requests are
   * serialized; `multiPv: 3` is what the live candidate list asks for.
   */
  evaluatePosition: (
    fen: string,
    depth?: number,
    multiPv?: number,
  ) => Promise<EngineEvaluation>;
  /**
   * A search that also respects a wall-clock budget (`movetime`). The clock
   * path uses this; review and draw offers keep the depth-only call.
   *
   * `nodes` adds a node budget on top of depth and time: 0 means no cap. The
   * beginner bands pass their node cap here so a low-rated bot stops after a
   * few dozen positions however much time it has.
   */
  evaluateWithin: (
    fen: string,
    depth: number,
    multiPv: number,
    movetimeMs: number,
    nodes?: number,
  ) => Promise<EngineEvaluation>;
  /**
   * Analyses one position in the background, reporting the evaluation so far
   * as the search deepens. Settles when the search reaches `depth`, when
   * `stop()` cuts it short, or on timeout; the last report is always the
   * deepest one, so a caller may ignore the promise and only use `onProgress`.
   */
  analysePosition: (
    fen: string,
    options?: {
      depth?: number;
      multiPv?: number;
      onProgress?: (evaluation: EngineEvaluation) => void;
    },
  ) => Promise<EngineEvaluation>;
  /** Asks the engine to stop the current search early. */
  stop: () => void;
  /** Kills the worker and resets the controller (a later call re-creates it). */
  terminate: () => void;
}

export function useStockfish(): StockfishController {
  const [status, setStatus] = useState<EngineStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const readyRef = useRef<Promise<void> | null>(null);
  const readyResolveRef = useRef<(() => void) | null>(null);
  const pendingRef = useRef<PendingRequest | null>(null);
  const multiPvRef = useRef(MULTI_PV);
  const startedRef = useRef(false);
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  const failPending = useCallback((message: string) => {
    const pending = pendingRef.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingRef.current = null;
    pending.reject(new Error(message));
  }, []);

  const ensureWorker = useCallback((): Promise<void> => {
    if (readyRef.current) return readyRef.current;
    if (!startedRef.current) {
      startedRef.current = true;
      setStatus('loading');
      setError(null);

      const worker = createEngineWorker();
      workerRef.current = worker;

      worker.onmessage = (event: MessageEvent) => {
        const line = typeof event.data === 'string' ? event.data : '';
        if (!line) return;

        if (line === 'uciok') {
          worker.postMessage(`setoption name Hash value ${HASH_SIZE_MB}`);
          worker.postMessage('setoption name Threads value 1');
          worker.postMessage(`setoption name MultiPV value ${MULTI_PV}`);
          worker.postMessage('isready');
          return;
        }
        if (line === 'readyok') {
          const waiting = pendingRef.current;
          if (waiting?.awaitingReady) {
            /* The MultiPV width is applied only once the engine has answered
               `isready`, so ranks 3..n are guaranteed to be searched. */
            waiting.awaitingReady = false;
            waiting.start();
            return;
          }
          setStatus('ready');
          readyResolveRef.current?.();
          readyResolveRef.current = null;
          return;
        }

        const request = pendingRef.current;
        if (!request) return;

        if (line.startsWith('info')) {
          const cp = / score cp (-?\d+)/.exec(line);
          const mate = / score mate (-?\d+)/.exec(line);
          if (!cp && !mate) return;

          const multipv = / multipv (\d+)/.exec(line);
          const index = multipv ? Number(multipv[1]) : 1;
          const depth = / depth (\d+)/.exec(line);
          const pv = / pv (.+)$/.exec(line);

          const entry = request.lines.get(index) ?? {
            depth: 0,
            scoreCp: 0,
            mate: null,
            pv: [] as string[],
          };

          if (depth) {
            entry.depth = Number(depth[1]);
            request.depth = Math.max(request.depth, entry.depth);
          }
          if (cp) {
            entry.scoreCp = Number(cp[1]);
            entry.mate = null;
          } else if (mate) {
            entry.mate = Number(mate[1]);
          }
          if (pv) entry.pv = pv[1].trim().split(/\s+/);

          request.lines.set(index, entry);

          // Passive analysis: hand back what the engine knows so far so the
          // caller can repaint while the search is still deepening.
          if (request.onProgress && entry.pv.length > 0) {
            const now = Date.now();
            if (now - request.lastProgressAt >= PROGRESS_INTERVAL_MS) {
              request.lastProgressAt = now;
              request.onProgress(buildEvaluation(request));
            }
          }

          // Keep the first PV1 report at depth 6: shallow evaluations are the
          // "what a human/quick scan sees" baseline used by the blunder rules.
          if (index === 1 && entry.depth === SHALLOW_DEPTH && !request.shallow) {
            request.shallow = {
              depth: entry.depth,
              scoreCp: entry.scoreCp,
              mate: entry.mate,
              pv: [...entry.pv],
            };
          }
          return;
        }

        if (line.startsWith('bestmove')) {
          clearTimeout(request.timer);
          pendingRef.current = null;
          const parts = line.split(/\s+/);
          request.bestMove = parts[1] && parts[1] !== '(none)' ? parts[1] : null;
          const ponderIndex = parts.indexOf('ponder');
          request.ponder = ponderIndex > 0 ? parts[ponderIndex + 1] ?? null : null;
          request.resolve(buildEvaluation(request));
        }
      };

      worker.onerror = (event: ErrorEvent) => {
        const message = event.message || 'The Stockfish worker failed to start.';
        setStatus('error');
        setError(message);
        readyRef.current = null;
        readyResolveRef.current = null;
        failPending(message);
      };

      readyRef.current = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          setStatus('error');
          reject(new Error('Stockfish did not initialise in time.'));
        }, READY_TIMEOUT_MS);
        readyResolveRef.current = () => {
          clearTimeout(timer);
          worker.postMessage('ucinewgame');
          resolve();
        };
        worker.postMessage('uci');
      }).catch((cause: unknown) => {
        readyRef.current = null;
        throw cause;
      });
    }
    return readyRef.current ?? Promise.reject(new Error('Stockfish unavailable.'));
  }, [failPending]);

  const requestEvaluation = useCallback(
    (
      fen: string,
      depth: number,
      multiPv: number = MULTI_PV,
      movetimeMs = 0,
      onProgress: ((evaluation: EngineEvaluation) => void) | null = null,
      nodes = 0,
    ): Promise<EngineEvaluation> => {
      const terminal = terminalEvaluation(fen);
      if (terminal) return Promise.resolve(terminal);

      return ensureWorker().then(
        () =>
          new Promise<EngineEvaluation>((resolve, reject) => {
            const worker = workerRef.current;
            if (!worker) {
              reject(new Error('The Stockfish worker is not running.'));
              return;
            }
            if (pendingRef.current) {
              reject(new Error('The engine is already searching.'));
              return;
            }

            const timer = setTimeout(() => {
              pendingRef.current = null;
              worker.postMessage('stop');
              reject(new Error('Stockfish search timed out.'));
            }, SEARCH_TIMEOUT_MS);

            const start = () => {
              worker.postMessage(`position fen ${fen}`);
              worker.postMessage(buildGoCommand(depth, movetimeMs, nodes));
            };

            // MultiPV is a UCI option, not a go parameter: set it between
            // searches (live candidate lines ask for 3, whole-game analysis 2).
            const changingMultiPv = multiPvRef.current !== multiPv;
            if (changingMultiPv) {
              multiPvRef.current = multiPv;
              worker.postMessage(`setoption name MultiPV value ${multiPv}`);
            }

            pendingRef.current = {
              fen,
              resolve,
              reject,
              depth: 0,
              movetimeMs,
              lines: new Map(),
              multiPv,
              shallow: null,
              bestMove: null,
              ponder: null,
              timer,
              awaitingReady: changingMultiPv,
              start,
              onProgress,
              lastProgressAt: 0,
            };

            /* A changed option is confirmed with isready/readyok before the
               search starts, so a search never runs at the old width. */
            if (changingMultiPv) worker.postMessage('isready');
            else start();
          }),
      );
    },
    [ensureWorker],
  );

  const evaluatePosition = useCallback(
    (fen: string, depth: number = DEFAULT_DEPTH, multiPv: number = MULTI_PV): Promise<EngineEvaluation> => {
      const run = () => requestEvaluation(fen, depth, multiPv);
      const result = chainRef.current.then(run, run);
      chainRef.current = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    [requestEvaluation],
  );

  const analysePosition = useCallback(
    (
      fen: string,
      {
        depth = DEFAULT_DEPTH,
        multiPv = MULTI_PV,
        onProgress,
      }: {
        depth?: number;
        multiPv?: number;
        onProgress?: (evaluation: EngineEvaluation) => void;
      } = {},
    ): Promise<EngineEvaluation> => {
      const run = () => requestEvaluation(fen, depth, multiPv, 0, onProgress ?? null);
      const result = chainRef.current.then(run, run);
      chainRef.current = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    [requestEvaluation],
  );

  const evaluateWithin = useCallback(
    (
      fen: string,
      depth: number,
      multiPv: number,
      movetimeMs: number,
      nodes = 0,
    ): Promise<EngineEvaluation> => {
      const run = () => requestEvaluation(fen, depth, multiPv, movetimeMs, null, nodes);
      const result = chainRef.current.then(run, run);
      chainRef.current = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    [requestEvaluation],
  );

  const stop = useCallback(() => {
    workerRef.current?.postMessage('stop');
  }, []);

  const terminate = useCallback(() => {
    failPending('The Stockfish worker was stopped.');
    workerRef.current?.terminate();
    workerRef.current = null;
    readyRef.current = null;
    readyResolveRef.current = null;
    startedRef.current = false;
    /* A fresh worker starts on the boot-time width; keeping the old value here
       would make the next search ask for a width the engine never applied. */
    multiPvRef.current = MULTI_PV;
    setStatus('idle');
  }, [failPending]);

  useEffect(() => terminate, [terminate]);

  return { status, error, evaluatePosition, evaluateWithin, analysePosition, stop, terminate };
}
