/**
 * Development trace of the bot strength pipeline.
 *
 * One record per engine move: the rating the move was played at, the depth and
 * MultiPV width the search actually used, which line of that list was chosen,
 * and how many centipawns it gave up. Calibration questions ("is the 1400 bot
 * really playing like a 1400?") are answered from this, not from a feeling
 * about a single game.
 *
 * Nothing is recorded or logged in a production build, and the array is capped
 * so a long session cannot grow without bound. In a dev build the latest
 * records are also on `window.__botTraces` for inspection from the console.
 */

export interface BotMoveTrace {
  /** The card rating the bot was asked to play at. */
  elo: number;
  /** The rating this turn's plan actually used (phase/time-control adjusted). */
  effectiveElo: number;
  /** Depth handed to the engine. */
  depth: number;
  /** MultiPV width of the search. */
  multiPv: number;
  /** Where the move came from: book, a plan, or the engine list. */
  source: string;
  bookMove: boolean;
  /** 1-based position of the chosen move in the engine's list; 0 if absent. */
  rank: number;
  /** Centipawn loss against the engine's best line, in the bot's own POV. */
  cpLoss: number;
  /** The rolled quality class, when the move came from a slip band. */
  kind: string | null;
  /** The centipawn band the roll asked for; null when the roll freed the choice. */
  rolledBand: { minGap: number; maxGap: number } | null;
  /** The rating's hard ceiling on a deliberate slip (`ratedLossCap`). */
  capCp: number | null;
}

const MAX_TRACES = 200;

/** The most recent traces in this session, oldest first. */
export const botTraces: BotMoveTrace[] = [];

let forcedOn = false;

/**
 * Turns tracing on outside a dev build.
 *
 * Only the calibration test uses this: it drives the real chooser with a stub
 * engine and then reads the ranks back, which is the whole point of the trace.
 * Nothing in the app calls it, so a production build records nothing.
 */
export function setBotTraceEnabled(on: boolean): void {
  forcedOn = on;
  if (!on) botTraces.length = 0;
}

function isDevBuild(): boolean {
  if (forcedOn) return true;
  /* Vite replaces this at build time; the cast keeps the module importable
     from plain Node, where `import.meta.env` does not exist. */
  const env = (import.meta as unknown as { env?: { DEV?: boolean } }).env;
  return env?.DEV === true;
}

/** Records one decision. A no-op outside a dev build. */
export function traceBotMove(trace: BotMoveTrace): void {
  if (!isDevBuild()) return;
  botTraces.push(trace);
  if (botTraces.length > MAX_TRACES) botTraces.shift();
  console.debug(
    `[bot] ${trace.elo} Elo (d${trace.depth}, MultiPV ${trace.multiPv}) · ` +
      `#${trace.rank || '?'} · −${Math.max(0, trace.cpLoss)}cp` +
      `${trace.kind ? ` · ${trace.kind}` : ''}` +
      `${trace.rolledBand ? ` (${trace.rolledBand.minGap}-${trace.rolledBand.maxGap}cp)` : ''}` +
      `${trace.capCp !== null ? ` · cap ${trace.capCp}cp` : ''}` +
      `${trace.bookMove ? ' · book' : ''}`,
    trace,
  );
  if (typeof window !== 'undefined') {
    (window as unknown as { __botTraces?: BotMoveTrace[] }).__botTraces = botTraces;
  }
}
