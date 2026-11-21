import { useCallback, useEffect, useRef, useState } from 'react';
import { Chess, type Move } from 'chess.js';
import type { StockfishController } from '../engine/useStockfish';
import { ChessClock, recoverClock, type ClockSnapshot } from './clock.ts';
import { profileFromRecord, type OpponentProfile } from './opponents.ts';
import {
  activeToPlayedGame,
  createActiveRecord,
  finishActiveRecord,
  recordLooksConsistent,
} from './activeGame.ts';
import {
  clearActiveGame,
  finalizePlayedGame,
  loadActiveGame,
  saveActiveGame,
} from './gameStore.ts';
import { STANDARD_START_FEN } from './pgn.ts';
import { playSoundEvent } from './audio/soundManager.ts';
import { classifyMoveSound, moveSoundFacts } from './audio/soundEvents.ts';
import {
  enqueuePremove,
  premoveQueueFen,
  resolvePremoveQueue,
  type Premove,
} from './premove.ts';
import { replaySans } from './replay.ts';
import { chooseCandidate, chooseBlunder, depthForElo } from './strength.ts';
import {
  BEGINNER_ELO,
  HUMAN_MULTI_PV,
  PROBE_MULTI_PV,
  SHALLOW_DEPTH,
  SHALLOW_MULTI_PV,
  bucketFor,
  describePhaseProfile,
  getEffectivePhaseElo,
  lastCaptureOf,
  phaseForMoveNumber,
  planHumanSearch,
  probeErrorMove,
  referenceCandidateScores,
  rollPhaseProfile,
  selectHumanBotMove,
  timeControlCategory,
  type Bucket,
  type HumanMoveChoice,
  type PhaseProfile,
} from './humanStrength.ts';
import { chooseRandomLegalMove } from './blunders.ts';
import {
  hasPreparedOpening,
  openingSource,
  shouldTakeBlunder,
} from './personality/opening.ts';
import {
  choosePersonalityMove,
  describeMove,
  materialBalance,
  type MoveFeatures,
  type SelectionResult,
} from './personality/engine.ts';
import {
  createDialogueState,
  maybeReact,
  type DialogueEvent,
} from './personality/dialogue.ts';
import {
  botMoveEvents,
  createNarrativeState,
  endingEvent,
  playerMoveEvents,
} from './personality/events.ts';
import { bookKey, legalBookMoves } from './personality/repertoires/book.ts';
import { personalityBookFor } from './personality/repertoires/index.ts';
import { chooseKidMove, kidPlan } from './personality/repertoires/kid.ts';
import {
  chooseNinaBookMove,
  chooseNinaPlanMove,
  createOpeningMemory,
  ninaPlan,
} from './personality/nina.ts';
import { faadiAllowsMistake } from './personality/faadi.ts';
import { bryanWidjajaAllowsMistake } from './personality/bryanWidjaja.ts';
import { styleFor, type PersonalityStyle } from './personality/styles.ts';
import { computeThinkingPlan, type ThinkingPlan } from './personality/thinking.ts';
import type {
  ActiveGameRecord,
  GameConfig,
  PlayColor,
  PlayOrientation,
  PlayResult,
  PlayedGameRecord,
  ResultReason,
} from './types.ts';

/**
 * Live game orchestration.
 *
 * Owns the authoritative chess.js game, the clock, the bot's move selection,
 * the persisted unfinished row and the finished-game record. The board stays
 * the single place where moves are made (drag, click, promotion); this hook
 * receives the accepted move and keeps its own game in step for notation,
 * result detection and PGN.
 *
 * Bot moves are applied here and published through the board's controlled
 * `fen` prop, so there is no second board or second rules implementation.
 *
 * Clock policy while away from the board (documented in the section as well):
 * the player's clock keeps running in real time — reloading is not free
 * thinking time — while the bot's clock is held, because no engine search can
 * happen while the app is closed. A running clock is only written on discrete
 * events, never on a timer tick.
 */

/** The character's latest spoken line, shown beside its portrait. */
export interface PlayReaction {
  text: string;
  event: DialogueEvent;
  at: number;
}

export interface PlaySession {
  id: string;
  opponent: OpponentProfile;
  /** Latest in-game remark; null until the character says something. */
  reaction: PlayReaction | null;
  config: GameConfig;
  playerColor: PlayColor;
  orientation: PlayOrientation;
  initialFen: string;
  fen: string;
  sans: string[];
  lastMove: { from: string; to: string } | null;
  /**
   * Transient: the player's chain of premoves, one per opponent reply. Never a
   * played move and never persisted.
   */
  premoves: Premove[];
  turn: PlayColor;
  status: 'playing' | 'finished';
  result: PlayResult | null;
  reason: ResultReason | null;
  startedAt: number;
  endedAt: number | null;
  saveError: string | null;
  savedGameId: string | null;
}

interface BotTimers {
  move: ReturnType<typeof setTimeout> | null;
  tick: ReturnType<typeof setInterval> | null;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Deepest ply of prepared theory a personality may keep following, by rating.
 *
 * A repertoire is a memory, and memory is part of strength: an 1150 who recites
 * twelve moves of grandmaster theory is not an 1150 any more. The cap is checked
 * against the number of plies already played, and it gates every theory source
 * (repertoire, Nina's plan, the King's Indian plan), not just the book table.
 */
export const BOOK_PLY_CAP = {
  beginner: 4,
  club: 6,
  expert: 8,
  master: 12,
} as const;

export function bookPlyLimit(elo: number): number {
  if (elo <= 1000) return BOOK_PLY_CAP.beginner;
  if (elo <= 1500) return BOOK_PLY_CAP.club;
  if (elo <= 2000) return BOOK_PLY_CAP.expert;
  return BOOK_PLY_CAP.master;
}

/**
 * Opening book for a beginner general bot, and the only book it may read.
 *
 * Three short mainlines — the Italian, the Queen's Gambit and the Najdorf — so
 * a low-rated bot opens like someone who has been taught the first few moves
 * instead of like a random-move generator. `bookPlyLimit` caps how deep it can
 * follow them (four plies at 700), and above 1200 the table is skipped entirely
 * so the calibrated error model starts on move one.
 *
 * The player's imported PGN courses are deliberately not part of this: a bot's
 * repertoire must never leak out of the library, and no live-game path reads
 * `usesRepertoire` any more. Personality bots above read only their own
 * declared books.
 */
const BEGINNER_BOOK_ELO = 1200;

const BEGINNER_LINES: readonly (readonly string[])[] = [
  ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3', 'd6', 'O-O', 'O-O'],
  ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3', 'O-O', 'Nf3', 'h6'],
  ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Be3', 'e5'],
];

/**
 * Position -> the book move(s) played from it, built once from the SAN lines.
 *
 * Keying by board, side to move and castling rights reuses the personality
 * book's key, so a transposition finds the same entry; an illegal line is
 * dropped at build time instead of reaching the board.
 */
function buildBeginnerBook(): Map<string, string[]> {
  const book = new Map<string, string[]>();
  for (const line of BEGINNER_LINES) {
    const game = new Chess();
    for (const san of line) {
      const before = bookKey(game.fen());
      let applied;
      try {
        applied = game.move(san);
      } catch {
        break;
      }
      if (!applied) break;
      const uci = `${applied.from}${applied.to}${applied.promotion ?? ''}`;
      const moves = book.get(before);
      if (!moves) book.set(before, [uci]);
      else if (!moves.includes(uci)) moves.push(uci);
    }
  }
  return book;
}

const BEGINNER_BOOK = buildBeginnerBook();

/** A standard beginner book move for this position, or null when out of book. */
export function beginnerBookMove(game: Chess): string | null {
  const moves = BEGINNER_BOOK.get(bookKey(game.fen()));
  if (!moves || moves.length === 0) return null;

  const legal = new Set(
    game.moves({ verbose: true }).map((move) => `${move.from}${move.to}${move.promotion ?? ''}`),
  );
  const playable = moves.filter((uci) => legal.has(uci));
  if (playable.length === 0) return null;
  return playable[Math.min(playable.length - 1, Math.floor(Math.random() * playable.length))];
}

/** Used when a book move has no measurable engine features attached. */
const NEUTRAL_FEATURES: MoveFeatures = {
  capture: false,
  capturedValue: 0,
  check: false,
  castle: false,
  promotion: false,
  develops: false,
  centralPawn: false,
  toEnemyHalf: false,
  movesKing: false,
  sacrifices: false,
  attacksKing: false,
  trades: false,
  materialAfter: 0,
};

export function usePlayGame(engine: StockfishController) {
  const engineRef = useRef(engine);
  engineRef.current = engine;

  const [session, setSession] = useState<PlaySession | null>(null);
  const [clockView, setClockView] = useState<ClockSnapshot>(() => ChessClock.empty());
  const [botThinking, setBotThinking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** The unfinished game read back from IndexedDB, waiting for a decision. */
  const [resumable, setResumable] = useState<ActiveGameRecord | null>(null);
  const resumableRef = useRef<ActiveGameRecord | null>(null);
  resumableRef.current = resumable;
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [loadingActive, setLoadingActive] = useState(true);

  const sessionRef = useRef<PlaySession | null>(null);
  const gameRef = useRef(new Chess());
  const clockRef = useRef<ChessClock | null>(null);
  const opponentRef = useRef<OpponentProfile | null>(null);
  const configRef = useRef<GameConfig | null>(null);
  const playerColorRef = useRef<PlayColor>('w');
  const orientationRef = useRef<PlayOrientation>('white');
  const initialFenRef = useRef<string>(STANDARD_START_FEN);
  const gameIdRef = useRef<string | null>(null);
  const statusRef = useRef<'idle' | 'playing' | 'finished'>('idle');
  const sansRef = useRef<string[]>([]);
  const startedAtRef = useRef(0);
  const savedRef = useRef(false);
  const viewVisibleRef = useRef(true);
  /** Rolled once per game (keyed by game id) and kept for that whole game. */
  const phaseProfileRef = useRef<{ key: string; elo: number; profile: PhaseProfile } | null>(
    null,
  );
  const timersRef = useRef<BotTimers>({ move: null, tick: null });
  const runBotRef = useRef<() => Promise<void>>(async () => {});
  const scheduleBotRef = useRef<(delay?: number) => void>(() => {});
  const commitRef = useRef<(from: string, to: string, promotion?: string) => boolean>(() => false);
  /** Queued premoves, oldest first; transient interaction state only. */
  const premovesRef = useRef<Premove[]>([]);
  /** True while a premove is being committed, so it does not clear its own chain. */
  const premoveCommitRef = useRef(false);
  /** Restoring a game must never fire the completion cue. */
  const silentFinishRef = useRef(false);
  const finishRef = useRef<(result: PlayResult, reason: ResultReason) => void>(() => {});
  const persistRef = useRef<() => void>(() => {});

  /* ------------------------------ personality ------------------------------ */

  const styleRef = useRef<PersonalityStyle | null>(null);
  const dialogueRef = useRef(createDialogueState());
  const narrativeRef = useRef(createNarrativeState());
  /** What the bot decided last, used to narrate its move after it lands. */
  const decisionRef = useRef<(SelectionResult & { bookMove: boolean; botPov: number }) | null>(null);
  /** White-POV evaluation of the position the bot just left behind. */
  const probeRef = useRef<number | null>(null);
  /** True when the bot's most recent move came from its repertoire. */
  const bookLineRef = useRef(false);
  /** Nina's per-game opening recall; other characters ignore it. */
  const openingMemoryRef = useRef(createOpeningMemory());
  /** Set while a move is being chosen after Nina forgot her line. */
  const forgotLineRef = useRef(false);

  const publish = useCallback((next: PlaySession | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  /**
   * Speaks the first event that survives the cooldown, and returns whether it
   * said anything. Called by the engine path (with the bot's own view of the
   * position) and by game end (forced).
   */
  const react = useCallback(
    (events: readonly DialogueEvent[], ply: number, force = false): boolean => {
      const style = styleRef.current;
      if (!style || events.length === 0) return false;
      for (const event of events) {
        const line = maybeReact(style.id, event, {
          ply,
          state: dialogueRef.current,
          force,
        });
        if (!line) continue;
        const current = sessionRef.current;
        if (!current) return false;
        if (event === 'book') narrativeRef.current.bookSaid = true;
        if (event === 'deviation') narrativeRef.current.deviationSaid = true;
        publish({ ...current, reaction: { text: line.text, event, at: Date.now() } });
        return true;
      }
      return false;
    },
    [publish],
  );

  /** Resets the personality state at the start of a game. */
  const primePersonality = useCallback((opponent: OpponentProfile) => {
    styleRef.current = opponent.kind === 'personality' ? styleFor(opponent.id, opponent.elo) : null;
    dialogueRef.current = createDialogueState();
    narrativeRef.current = createNarrativeState();
    decisionRef.current = null;
    probeRef.current = null;
    bookLineRef.current = false;
    openingMemoryRef.current = createOpeningMemory();
    forgotLineRef.current = false;
  }, []);

  const clearTimers = useCallback(() => {
    if (timersRef.current.move) {
      clearTimeout(timersRef.current.move);
      timersRef.current.move = null;
    }
  }, []);

  /* ------------------------------ persistence ------------------------------ */

  /** Writes the recoverable state after a discrete change. Never on a tick. */
  const persist = useCallback(() => {
    const current = sessionRef.current;
    const opponent = opponentRef.current;
    const config = configRef.current;
    const gameId = gameIdRef.current;
    if (!current || !opponent || !config || !gameId || statusRef.current !== 'playing') return;

    const now = Date.now();
    const clock = clockRef.current;
    const snapshot = clock ? clock.snapshot(now) : null;

    const record = createActiveRecord({
      id: gameId,
      opponent,
      config,
      playerColor: playerColorRef.current,
      orientation: orientationRef.current,
      initialFen: initialFenRef.current,
      currentFen: gameRef.current.fen(),
      sans: sansRef.current,
      whiteMs: snapshot?.whiteMs ?? 0,
      blackMs: snapshot?.blackMs ?? 0,
      active: snapshot?.active ?? null,
      clockStarted: clock?.isStarted ?? false,
      paused: snapshot ? !snapshot.running : true,
      startedAt: startedAtRef.current,
      now,
    });

    void saveActiveGame(record).catch(() => {
      setNotice('Progress could not be saved. Keep this tab open if the game matters.');
    });
  }, []);
  persistRef.current = persist;

  /* ------------------------------- game over ------------------------------- */

  const finish = useCallback(
    (result: PlayResult, reason: ResultReason) => {
      if (statusRef.current !== 'playing') return;
      statusRef.current = 'finished';
      premovesRef.current = [];
      clearTimers();
      clockRef.current?.stop();
      /* One completion cue for every ending: mate, stalemate, draw, resign, flag.
         A game restored after its clock already expired stays silent. */
      if (!silentFinishRef.current) playSoundEvent('game-end');
      silentFinishRef.current = false;
      /* A search running for a game that just ended must not hold the worker. */
      engineRef.current.stop();
      setBotThinking(false);
      setClockView(clockRef.current?.snapshot(Date.now()) ?? ChessClock.empty());

      const current = sessionRef.current;
      const opponent = opponentRef.current;
      const config = configRef.current;
      const gameId = gameIdRef.current;
      if (!current || !opponent || !config || !gameId) return;

      const game = gameRef.current;
      const endedAt = Date.now();
      const finalFen = game.fen();
      const sans = [...sansRef.current];

      publish({
        ...current,
        status: 'finished',
        result,
        reason,
        endedAt,
        fen: finalFen,
        premoves: [],
        turn: game.turn(),
      });

      /* The closing line is always allowed: this is the one moment it matters. */
      react([endingEvent(result, playerColorRef.current)], sans.length, true);

      /* One completion path only: savedRef makes a resize/timeout race harmless. */
      if (savedRef.current) return;
      savedRef.current = true;

      const base = createActiveRecord({
        id: gameId,
        opponent,
        config,
        playerColor: playerColorRef.current,
        orientation: orientationRef.current,
        initialFen: initialFenRef.current,
        currentFen: finalFen,
        sans,
        whiteMs: 0,
        blackMs: 0,
        active: null,
        clockStarted: clockRef.current?.isStarted ?? false,
        paused: true,
        startedAt: startedAtRef.current,
        now: endedAt,
      });
      const finished = finishActiveRecord(base, result, reason, endedAt, finalFen);
      let record: PlayedGameRecord;
      try {
        record = activeToPlayedGame(finished);
      } catch {
        const latest = sessionRef.current;
        if (latest) publish({ ...latest, saveError: 'This game could not be archived.' });
        return;
      }

      void (async () => {
        /* Park the finished row first: if the tab dies mid-archive, the next
           load replays this write instead of losing the result. */
        try {
          await saveActiveGame(finished);
        } catch {
          /* the archive below is the important write */
        }

        try {
          await finalizePlayedGame(record);
          const latest = sessionRef.current;
          if (latest?.id === gameId) publish({ ...latest, savedGameId: record.game_id });
          setResumable(null);
        } catch {
          const latest = sessionRef.current;
          if (latest?.id === gameId) {
            publish({ ...latest, saveError: 'This game could not be saved to local history.' });
          }
        }
      })();
    },
    [clearTimers, publish, react],
  );
  finishRef.current = finish;

  /* --------------------------------- bot ----------------------------------- */

  const scheduleBot = useCallback(
    (delay = 320) => {
      if (statusRef.current !== 'playing' || !viewVisibleRef.current) return;
      clearTimers();
      timersRef.current.move = setTimeout(() => {
        timersRef.current.move = null;
        void runBotRef.current();
      }, delay);
    },
    [clearTimers],
  );
  scheduleBotRef.current = scheduleBot;

  const runBot = useCallback(async () => {
    if (statusRef.current !== 'playing' || !viewVisibleRef.current) return;
    const game = gameRef.current;
    if (game.turn() === playerColorRef.current) return;

    /* The turn starts here: the deliberation floor is measured from this instant,
       so a book move or a fast search still takes a human-length beat. */
    const thinkStart = Date.now();
    setBotThinking(true);
    const fen = game.fen();
    const botColor = game.turn();
    const style = styleRef.current;
    const baseElo = opponentRef.current?.elo ?? 1500;

    /* One strength profile per game: three phase levels rolled now and kept for
       the whole match, so a bot can be sharp in the opening and sloppy in the
       endgame (or the reverse) instead of being the same opponent throughout. */
    const profileKey = gameIdRef.current ?? 'game';
    const cached = phaseProfileRef.current;
    const profileChanged = !cached || cached.key !== profileKey || cached.elo !== baseElo;
    const phaseProfile = profileChanged ? rollPhaseProfile(baseElo) : cached.profile;
    if (profileChanged) {
      phaseProfileRef.current = { key: profileKey, elo: baseElo, profile: phaseProfile };
      if (import.meta.env.DEV) {
        console.info(
          '[play] bot phase profile',
          describePhaseProfile(baseElo, phaseProfile),
        );
      }
    }

    /* `elo` is the rating this turn is actually played at: the card rating moved
       by the active phase's level. Everything below — book cap, blunder roll,
       personality dials, the six-bucket distribution, depth, recapture curve and
       tunnel-vision filter — reads this number. */
    const phase = phaseForMoveNumber(Math.floor(sansRef.current.length / 2) + 1);
    const phaseLevel = phaseProfile[phase];
    const elo = getEffectivePhaseElo(baseElo, phaseLevel);

    /** Theory is only followed while this rating would still remember it. */
    const inBookWindow = sansRef.current.length < bookPlyLimit(elo);
    /** A search that resolves after a rematch must not move in the new game. */
    const searchGameId = gameIdRef.current;
    let uci: string | null = null;
    let pauseMs = 180;
    let plan: ThinkingPlan | null = null;
    /** Human thinking time the calibrated sampler asked for, ms. */
    let humanWaitMs = 900;
    /** Shallow-search order (best first) for the calibrated selector. */
    let shallowRank: string[] = [];

    const clockSnapshot = clockRef.current?.snapshot(Date.now());
    const remainingMs = clockSnapshot
      ? botColor === 'w'
        ? clockSnapshot.whiteMs
        : clockSnapshot.blackMs
      : null;
    const thinkingInput = {
      fen,
      style: style ?? undefined,
      clockMs: remainingMs,
      incrementMs: (configRef.current?.incrementSeconds ?? 0) * 1000,
      initialMs: (configRef.current?.initialSeconds ?? 0) * 1000,
      ply: sansRef.current.length,
    };

    try {
      if (style) {
        /* Repertoire first: an opening move costs no search at all — but only
           for as many plies as this rating would really remember. */
        const bookMoves = inBookWindow
          ? legalBookMoves(personalityBookFor(style.id, botColor), game)
          : [];
        const book = chooseNinaBookMove({
          moves: bookMoves,
          style,
          history: sansRef.current,
          memory: openingMemoryRef.current,
        });
        if (book.forgotten) forgotLineRef.current = true;
        const bookMove = book.move;
        if (bookMove) {
          uci = bookMove.uci;
          decisionRef.current = {
            uci: bookMove.uci,
            gap: 0,
            best: true,
            bookMove: true,
            botPov: 0,
            features: describeMove(fen, bookMove.uci) ?? NEUTRAL_FEATURES,
          };
          plan = computeThinkingPlan({ ...thinkingInput, style, bookMove: true });
          pauseMs = plan.pauseMs;
        }
      }

      /* A general bot under 1200 opens from the compact table above — never
         from the player's imported courses. From 1200 up it has no book at all
         and relies on its calibrated error model from the first move. */
      if (!uci && !style && inBookWindow && elo < BEGINNER_BOOK_ELO) {
        const bookMove = beginnerBookMove(game);
        if (bookMove) uci = bookMove;
      }

      /* Theory first: the prepared move above, then the character's
         principle-based system, and only then ordinary engine play. */
      const nina =
        !uci && style && inBookWindow
          ? ninaPlan(fen, sansRef.current, style, openingMemoryRef.current.forgotten)
          : null;
      const kid = !uci && style && inBookWindow ? kidPlan(fen, sansRef.current, style) : null;
      const source = openingSource({
        bookMove: Boolean(uci),
        ninaPlan: Boolean(nina),
        kidPlan: Boolean(kid),
      });

      if (!uci) {
        /* A King's Indian position needs one more engine line: the preference
           layer may want a developing move the engine ranks just outside the
           top few. */
        if (style) {
          plan = computeThinkingPlan({ ...thinkingInput, style, bookMove: false });
        }

        /* Five lines: the personality layer and the blunder pick both choose
           from this list, so it needs real alternatives near the best move.
           A bot with no personality is calibrated to its USCF rating: the plan
           fixes the depth, the human error rates and the deliberation before
           the engine runs, and the search itself uses that whole budget. */
        const humanSearch = style
          ? null
          : planHumanSearch({
              fen,
              elo: baseElo,
              phaseProfile,
              moveNumber: Math.floor(sansRef.current.length / 2) + 1,
              timeControlCategory: timeControlCategory(
                (configRef.current?.initialSeconds ?? 0) * 1000,
              ),
              remainingTimeMs: remainingMs,
              incrementMs: (configRef.current?.incrementSeconds ?? 0) * 1000,
              lastMove: lastCaptureOf(game),
            });
        const evaluation = style
          ? await engineRef.current.evaluateWithin(
              fen,
              depthForElo(elo),
              5,
              plan?.searchMs ?? 1200,
            )
          : await engineRef.current.evaluateWithin(
              fen,
              humanSearch!.depth,
              HUMAN_MULTI_PV,
              humanSearch!.thinkTimeMs,
              /* A beginner's whole search: a few dozen nodes, so simple
                 two-ply tactics and forks stay outside its horizon. */
              humanSearch!.nodeCap ?? 0,
            );

        /* Pass 2, calibrated bots only: score each PV move's resulting position
           at a fixed deeper depth. The shallow search that generated the list is
           also the search that scored it, so its lines all look nearly equal;
           the reference pass is what lets the severity buckets fill up. It runs
           inside the deliberation budget, so it adds no visible wait. */
        let reference: Map<string, number> | null = null;
        if (!style) {
          reference = await referenceCandidateScores(
            engineRef.current,
            fen,
            evaluation.candidates,
          );
          if (statusRef.current !== 'playing' || gameIdRef.current !== searchGameId) {
            setBotThinking(false);
            return;
          }

          /* Shallow pass: the order a player ranks the moves in after a quick
             look. At club level an error has to be one of the first six of
             these; a 1500+ slip one of the first four. It is a depth-3 search
             over six lines, so it costs a fraction of the main one. */
          const shallow = await engineRef.current.evaluateWithin(
            fen,
            SHALLOW_DEPTH,
            SHALLOW_MULTI_PV,
            Math.max(150, Math.min(500, Math.round(humanSearch!.thinkTimeMs * 0.25))),
          );
          if (statusRef.current !== 'playing' || gameIdRef.current !== searchGameId) {
            setBotThinking(false);
            return;
          }
          shallowRank = shallow.candidates.map((candidate) => candidate.uci);
        }

        /* Personalities roll once per turn for a human-style mistake. The
           calibrated path carries its own mistake model in the sampler. */
        const rolled =
          style && shouldTakeBlunder(elo, Math.random, hasPreparedOpening(source))
            ? chooseBlunder(evaluation.candidates, botColor, elo, Math.random)
            : null;
        /* Faadi still sees a free piece: his wildcard error is an idea he
           missed, not a queen handed over in broad daylight. */
        const blunder =
          rolled &&
          faadiAllowsMistake(fen, rolled, style) &&
          bryanWidjajaAllowsMistake(fen, rolled, style)
            ? rolled
            : null;

        if (style) {
          /* Judge the player's last move against the bot's own reading of the
             position it left behind. Both numbers are White-POV centipawns. */
          if (probeRef.current !== null) {
            const gain =
              (evaluation.scoreCp - probeRef.current) *
              (playerColorRef.current === 'w' ? 1 : -1);
            probeRef.current = null;
            if (statusRef.current === 'playing') {
              react(playerMoveEvents(gain), sansRef.current.length);
            }
          }

          const sign = botColor === 'w' ? 1 : -1;
          const blunderFeatures = blunder ? describeMove(fen, blunder) : null;
          const blunderScore = blunder
            ? (evaluation.candidates.find((candidate) => candidate.uci === blunder)?.scoreCp ??
              evaluation.scoreCp)
            : evaluation.scoreCp;
          const blunderSelection =
            blunder && blunderFeatures
              ? {
                  uci: blunder,
                  gap: Math.max(0, Math.round(sign * (evaluation.scoreCp - blunderScore))),
                  features: blunderFeatures,
                  best: false,
                }
              : null;

          let kidSelection = kid
            ? chooseKidMove({
                fen,
                history: sansRef.current,
                style,
                elo,
                candidates: evaluation.candidates,
              })
            : null;

          /* A setup move such as ...g6 is often outside the top engine
             lines in the opening. If the plan wants one that MultiPV did not
             list, evaluate the resulting position directly: the plan is only
             followed when the engine says the move is sound. */
          if (kid && !kidSelection) {
            for (const move of kid.moves.slice(0, 2)) {
              if (evaluation.candidates.some((candidate) => candidate.uci === move.uci)) continue;
              const features = describeMove(fen, move.uci);
              if (!features) continue;

              const child = new Chess(fen);
              child.move({
                from: move.uci.slice(0, 2) as never,
                to: move.uci.slice(2, 4) as never,
                promotion: move.uci.length > 4 ? move.uci.slice(4, 5) : undefined,
              });
              const childEval = await engineRef.current.evaluateWithin(
                child.fen(),
                Math.max(4, depthForElo(elo) - 2),
                1,
                300,
              );
              if (statusRef.current !== 'playing' || gameIdRef.current !== searchGameId) {
                setBotThinking(false);
                return;
              }

              /* Both scores are White-POV: a positive difference means the
                 bot just made its own position worse. */
              const gap = Math.max(0, childEval.scoreCp - evaluation.scoreCp);
              const tolerance =
                move.kind === 'setup'
                  ? 90
                  : style.id === 'junior'
                    ? 60
                    : style.id === 'bryan'
                      ? 75
                      : style.id === 'bryan-prime'
                        ? 70
                        : style.id === 'bryan-sophomore'
                          ? 65
                          : 100;
              if (gap <= tolerance) {
                kidSelection = { uci: move.uci, gap, features, best: gap <= 5 };
                break;
              }
            }
          }

          const ninaSelection = nina
            ? chooseNinaPlanMove({
                fen,
                history: sansRef.current,
                style,
                elo,
                candidates: evaluation.candidates,
                forgotten: openingMemoryRef.current.forgotten,
              })
            : null;

          const selection =
            blunderSelection ??
            kidSelection ??
            ninaSelection ??
            choosePersonalityMove({
              fen,
              candidates: evaluation.candidates,
              style,
              elo,
            });
          if (selection) {
            uci = selection.uci;
            decisionRef.current = {
              ...selection,
              bookMove: false,
              botPov: (botColor === 'w' ? 1 : -1) * evaluation.scoreCp,
            };
          } else if (evaluation.bestMove) {
            uci = evaluation.bestMove;
          }
          pauseMs = plan?.pauseMs ?? 120;
        } else {
          /* USCF-calibrated human selection: softmax over the engine's ten
             lines, the recapture and anti-catastrophe heuristics, and the
             tier's own mistake rate. Severity is judged on reference scores. */
          const select = (allowProbe: boolean, forcedBucket?: Bucket) =>
            selectHumanBotMove({
              fen,
              elo,
              candidates: evaluation.candidates,
              lastMove: lastCaptureOf(game),
              plan: humanSearch!,
              reference: reference ?? undefined,
              shallowRank,
              allowProbe,
              forcedBucket,
            });

          /* Only a beginner gets the off-list probe: from 600 up an error has
             to be a move the player meant, and the intent filter handles it. */
          let choice: HumanMoveChoice = select(elo < BEGINNER_ELO);

          /* The engine's own ten lines are all reasonable in a quiet position,
             so an error roll can find nothing bad enough to play. A real
             sub-1500 player then hangs something: probe a few plausible
             off-list moves and take the first that lands in the rolled band. */
          if (choice.kind === 'probe') {
            const target = choice.probeTarget ?? 'blunder';
            const known = new Set(evaluation.candidates.map((candidate) => candidate.uci));
            /* One wide shallow search supplies ranks 11-20: the moves this
               player would also consider, minus the engine's own top ten. */
            const wide = reference
              ? await engineRef.current.evaluatePosition(fen, humanSearch!.depth, PROBE_MULTI_PV)
              : null;
            if (statusRef.current !== 'playing' || gameIdRef.current !== searchGameId) {
              setBotThinking(false);
              return;
            }
            const pool = (wide?.candidates ?? [])
              .map((candidate) => candidate.uci)
              .filter((uci) => !known.has(uci));
            const probe = reference
              ? await probeErrorMove(engineRef.current, fen, {
                  referenceScores: reference,
                  target,
                  elo,
                  pool,
                  exclude: [...known],
                })
              : null;
            if (statusRef.current !== 'playing' || gameIdRef.current !== searchGameId) {
              setBotThinking(false);
              return;
            }
            choice = probe
              ? {
                  ...choice,
                  uci: probe.uci,
                  kind: bucketFor(probe.winDrop),
                  cpLoss: probe.cpLoss,
                  winDrop: probe.winDrop,
                }
              : select(false, target);
          }

          uci = choice.uci ?? chooseCandidate(evaluation.candidates, elo, Math.random, fen);
          if (!uci) uci = evaluation.bestMove;
          humanWaitMs = humanSearch!.thinkTimeMs;
        }
      }
    } catch {
      setNotice('The engine is unavailable — the bot played a legal move instead.');
    }

    if (!uci) {
      /* Engine unavailable: fall back to a legal move, but still refuse the
         free-piece accidents the static guard can see. */
      uci = chooseRandomLegalMove(game, elo, Math.random);
    }

    /* The search (or the book lookup) is thinking time, but it is often far
       shorter than the plan allows. Wait out the rest of the deliberation floor
       so the bot never snaps a move back instantly — the floor is clock-capped
       in the plan, and re-checked below before committing. */
    if (style) {
      const target = plan?.deliberationMs ?? Math.max(1500, pauseMs);
      const elapsed = Date.now() - thinkStart;
      const remaining = clockRef.current?.snapshot(Date.now());
      const leftMs = remaining
        ? remaining.active === game.turn()
          ? game.turn() === 'w'
            ? remaining.whiteMs
            : remaining.blackMs
          : null
        : null;
      const safeTarget = leftMs === null ? target : Math.min(target, Math.max(0, leftMs - 250));
      await sleep(Math.max(0, safeTarget - elapsed));
    } else {
      /* The calibrated delays are human thinking time, so the search above
         counts towards them; the clock gets the last word in fast games. */
      const remaining = clockRef.current?.snapshot(Date.now());
      const leftMs = remaining
        ? remaining.active === game.turn()
          ? game.turn() === 'w'
            ? remaining.whiteMs
            : remaining.blackMs
          : null
        : null;
      const target =
        leftMs === null ? humanWaitMs : Math.min(humanWaitMs, Math.max(0, leftMs - 250));
      await sleep(Math.max(0, target - (Date.now() - thinkStart)));
    }

    if (statusRef.current !== 'playing' || gameIdRef.current !== searchGameId || !uci) {
      setBotThinking(false);
      return;
    }
    if (!viewVisibleRef.current) {
      setBotThinking(false);
      return;
    }

    const promotion = uci.length > 4 ? uci.substring(4, 5) : undefined;
    commitRef.current(uci.slice(0, 2), uci.slice(2, 4), promotion);
    setBotThinking(false);
  }, []);
  runBotRef.current = runBot;

  /* --------------------------------- moves --------------------------------- */

  /**
   * Applies one accepted move to the authoritative game, handles the clock,
   * then detects game end or hands the turn to the bot.
   */
  const commit = useCallback(
    (from: string, to: string, promotion?: string) => {
      if (statusRef.current !== 'playing') return false;
      const game = gameRef.current;
      const now = Date.now();
      const clock = clockRef.current;

      /* A move that lands after the flag is not a move: the game is over. */
      if (clock) {
        const before = clock.snapshot(now);
        if (before.flagged) {
          finishRef.current(before.flagged === 'w' ? '0-1' : '1-0', 'timeout');
          return false;
        }
      }

      const fenBefore = game.fen();
      let applied: Move | null = null;
      try {
        applied = game.move({ from, to, promotion });
      } catch {
        return false;
      }
      if (!applied) return false;
      const fenAfter = game.fen();

      if (clock) {
        clock.start(now);
        setClockView(clock.afterMove(applied.color, game.turn(), now));
      }

      sansRef.current = [...sansRef.current, applied.san];
      const current = sessionRef.current;
      if (current) {
        publish({
          ...current,
          fen: game.fen(),
          sans: sansRef.current,
          lastMove: { from: applied.from, to: applied.to },
          turn: game.turn(),
        });
      }

      /* A move and its completion are different cues; a mating move must not
         also play a capture or check sound. */
      const terminal =
        game.isCheckmate() ||
        game.isStalemate() ||
        game.isInsufficientMaterial() ||
        game.isThreefoldRepetition() ||
        game.isDraw();
      if (!terminal) {
        playSoundEvent(
          classifyMoveSound(
            moveSoundFacts(applied, {
              side: applied.color === playerColorRef.current ? 'self' : 'opponent',
              check: game.isCheck(),
              gameEnd: false,
            }),
          ),
        );
      }

      if (game.isCheckmate()) {
        finishRef.current(applied.color === 'w' ? '1-0' : '0-1', 'checkmate');
        return true;
      }
      if (game.isStalemate()) {
        finishRef.current('1/2-1/2', 'stalemate');
        return true;
      }
      if (game.isInsufficientMaterial()) {
        finishRef.current('1/2-1/2', 'insufficient-material');
        return true;
      }
      if (game.isThreefoldRepetition()) {
        finishRef.current('1/2-1/2', 'threefold-repetition');
        return true;
      }
      if (game.isDraw()) {
        finishRef.current('1/2-1/2', 'fifty-move');
        return true;
      }

      /* ---------------------------- personality ---------------------------- */

      const style = styleRef.current;
      if (style) {
        const ownSign = applied.color === 'w' ? 1 : -1;

        if (applied.color !== playerColorRef.current) {
          /* The bot has moved: narrate what it just did, then leave a cheap
             probe of the resulting position so the player's reply can be
             judged. The probe is skipped when the clock is short. */
          const decision = decisionRef.current;
          decisionRef.current = null;
          if (decision) {
            const materialDelta =
              (materialBalance(fenAfter) - materialBalance(fenBefore)) * ownSign;
            const events = botMoveEvents(
              {
                style,
                gap: decision.gap,
                best: decision.best,
                features: decision.features,
                botPov: decision.botPov,
                materialDelta,
              },
              narrativeRef.current,
            );
            if (decision.bookMove && !narrativeRef.current.bookSaid) events.unshift('book');
            if (forgotLineRef.current) {
              events.unshift('deviation');
              forgotLineRef.current = false;
            }
            react(events, sansRef.current.length);
            bookLineRef.current = decision.bookMove;

            const after = clockRef.current?.snapshot(Date.now());
            const left = after
              ? applied.color === 'w'
                ? after.whiteMs
                : after.blackMs
              : null;
            if (left === null || left > 4000) {
              const token = gameIdRef.current;
              void engineRef.current
                .evaluatePosition(fenAfter, 4, 1)
                .then((probe) => {
                  if (gameIdRef.current === token && statusRef.current === 'playing') {
                    probeRef.current = probe.scoreCp;
                  }
                })
                .catch(() => {
                  /* dialogue simply loses its baseline for the next move */
                });
            }
          }
        } else if (bookLineRef.current && !narrativeRef.current.deviationSaid) {
          /* The bot was still on its prepared line and the player's move leaves
             it: a real, contextual remark, said once. */
          const botColor = applied.color === 'w' ? 'b' : 'w';
          const botBook = personalityBookFor(style.id, botColor);
          if (legalBookMoves(botBook, new Chess(fenAfter)).length === 0) {
            react(['deviation'], sansRef.current.length);
          }
        }
      }

      /* ------------------------------ premove ------------------------------ */

      /* The bot's move is fully committed at this point: clock, SAN, session.
         Only now is the head of the premove queue re-checked against the real
         position and played through the normal commit path (so PGN, history
         and clock all see an ordinary move). One premove executes per opponent
         reply; a head that is no longer legal cancels the rest silently. */
      if (applied.color !== playerColorRef.current && premovesRef.current.length > 0) {
        const resolution = resolvePremoveQueue({
          fen: game.fen(),
          queue: premovesRef.current,
          playerColor: playerColorRef.current,
          turn: game.turn(),
          status: statusRef.current,
        });
        premovesRef.current = resolution.remaining;
        const latest = sessionRef.current;
        if (latest) publish({ ...latest, premoves: resolution.remaining });

        if (resolution.move) {
          premoveCommitRef.current = true;
          commitRef.current(
            resolution.move.from,
            resolution.move.to,
            resolution.move.promotion,
          );
          premoveCommitRef.current = false;
          return true;
        }
      }

      /* A move the player chose by hand while a chain was queued replaces it;
         the premove commit above must keep the rest of its own chain. */
      if (
        applied.color === playerColorRef.current &&
        premovesRef.current.length > 0 &&
        !premoveCommitRef.current
      ) {
        premovesRef.current = [];
        const latest = sessionRef.current;
        if (latest) publish({ ...latest, premoves: [] });
      }

      persistRef.current();
      if (game.turn() !== playerColorRef.current) scheduleBotRef.current(300);
      return true;
    },
    [publish, react],
  );
  commitRef.current = commit;

  /* --------------------------------- setup --------------------------------- */

  const startGame = useCallback(
    (opponent: OpponentProfile, config: GameConfig) => {
      clearTimers();
      const playerColor: PlayColor =
        config.color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : config.color;
      const game = new Chess();
      const clock = config.untimed
        ? null
        : new ChessClock(config.initialSeconds, config.incrementSeconds);

      gameRef.current = game;
      clockRef.current = clock;
      opponentRef.current = opponent;
      primePersonality(opponent);
      configRef.current = config;
      playerColorRef.current = playerColor;
      orientationRef.current = playerColor === 'w' ? 'white' : 'black';
      initialFenRef.current = STANDARD_START_FEN;
      gameIdRef.current = `game_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      statusRef.current = 'playing';
      savedRef.current = false;
      sansRef.current = [];
      startedAtRef.current = Date.now();
      viewVisibleRef.current = true;
      premovesRef.current = [];
      setBotThinking(false);
      setNotice(null);
      setResumable(null);
      setResumeError(null);
      setClockView(clock ? clock.snapshot(Date.now()) : ChessClock.empty());

      publish({
        id: gameIdRef.current,
        opponent,
        reaction: null,
        config,
        playerColor,
        orientation: orientationRef.current,
        initialFen: STANDARD_START_FEN,
        fen: game.fen(),
        sans: [],
        lastMove: null,
        premoves: [],
        turn: 'w',
        status: 'playing',
        result: null,
        reason: null,
        startedAt: startedAtRef.current,
        endedAt: null,
        saveError: null,
        savedGameId: null,
      });
      persistRef.current();

      if (playerColor === 'b') scheduleBotRef.current(650);
    },
    [clearTimers, publish, primePersonality],
  );

  /* -------------------------------- restore -------------------------------- */

  /**
   * Rebuilds a session from the stored row. Returns `false` (and leaves the row
   * untouched) when the record cannot be replayed.
   */
  const resumeGame = useCallback(
    (record: ActiveGameRecord): boolean => {
      setResumeError(null);

      if (!recordLooksConsistent(record)) {
        setResumeError('That unfinished game is incomplete and could not be restored.');
        return false;
      }

      let replay;
      try {
        replay = replaySans(record.initial_fen, record.sans);
      } catch (error) {
        setResumeError(`${(error as Error).message} The saved game was left untouched.`);
        return false;
      }

      const initialFen = record.initial_fen || STANDARD_START_FEN;
      const game = new Chess(initialFen);
      for (const san of record.sans) game.move(san);

      const opponent = profileFromRecord(record);
      primePersonality(opponent);
      const config: GameConfig = {
        color: record.player_color,
        timeControlId: record.time_control_id,
        initialSeconds: record.initial_seconds,
        incrementSeconds: record.increment_seconds,
        untimed: record.untimed,
      };

      clearTimers();

      const now = Date.now();
      let clock: ChessClock | null = null;
      let flagged: PlayColor | null = null;

      if (!record.untimed) {
        const recovered = recoverClock(
          {
            whiteMs: record.white_ms,
            blackMs: record.black_ms,
            active: record.active_clock,
            started: record.clock_started,
            paused: record.paused,
            savedAt: record.last_sync_at,
          },
          { now, chargeSide: record.player_color },
        );
        flagged = recovered.flagged;

        const wasPaused = record.paused || flagged !== null;
        clock = ChessClock.restore(
          {
            whiteMs: recovered.whiteMs,
            blackMs: recovered.blackMs,
            incrementMs: record.increment_seconds * 1000,
            active: wasPaused ? null : recovered.active,
            pausedSide: wasPaused ? record.active_clock : null,
            started: record.clock_started,
          },
          now,
        );
      }

      const last = replay.plies[replay.plies.length - 1];

      gameRef.current = game;
      clockRef.current = clock;
      opponentRef.current = opponent;
      configRef.current = config;
      playerColorRef.current = record.player_color;
      orientationRef.current = record.orientation === 'black' ? 'black' : 'white';
      initialFenRef.current = initialFen;
      gameIdRef.current = record.game_id;
      statusRef.current = 'playing';
      savedRef.current = false;
      sansRef.current = [...record.sans];
      startedAtRef.current = record.started_at;
      premovesRef.current = [];
      setBotThinking(false);
      setNotice(null);
      setResumable(null);
      setClockView(clock ? clock.snapshot(now) : ChessClock.empty());

      publish({
        id: record.game_id,
        opponent,
        reaction: null,
        config,
        playerColor: record.player_color,
        orientation: orientationRef.current,
        initialFen,
        fen: game.fen(),
        sans: [...record.sans],
        lastMove: last ? { from: last.from, to: last.to } : null,
        premoves: [],
        turn: game.turn(),
        status: 'playing',
        result: null,
        reason: null,
        startedAt: record.started_at,
        endedAt: null,
        saveError: null,
        savedGameId: null,
      });

      /* A player who flagged while away loses now, through the normal finish
         path, so the game is archived and removed from the active slot once. */
      if (flagged) {
        silentFinishRef.current = true;
        finishRef.current(flagged === 'w' ? '0-1' : '1-0', 'timeout');
        return true;
      }

      persistRef.current();

      if (game.turn() !== record.player_color) {
        scheduleBotRef.current(400);
      }

      return true;
    },
    [clearTimers, publish, primePersonality],
  );

  const abandonResumable = useCallback(async () => {
    const record = resumableRef.current;
    if (!record) return;
    try {
      await clearActiveGame(record.game_id);
      setResumable(null);
      setResumeError(null);
    } catch {
      setResumeError('That saved game could not be removed. It has been left in place.');
    }
  }, []);

  /* Restore offer on mount; finished rows are archived exactly once. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const record = await loadActiveGame();
        if (cancelled || !record) return;

        if (record.status === 'finished') {
          /* A completed game whose archive was interrupted: the write is keyed
             by game_id, so replaying it can never duplicate a history entry. */
          try {
            await finalizePlayedGame(activeToPlayedGame(record));
          } catch {
            /* keep the row for a later attempt */
          }
          return;
        }

        setResumable(record);
      } catch {
        if (!cancelled) setResumeError('The saved game could not be read from local storage.');
      } finally {
        if (!cancelled) setLoadingActive(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ------------------------------- controls -------------------------------- */

  const playMove = useCallback((move: Move) => {
    commitRef.current(move.from, move.to, move.promotion);
  }, []);

  /**
   * Appends to the premove chain, or clears it with `null`. Only while the
   * opponent is to move: queueing never touches the game, the move list or the
   * clock, and the engine keeps searching. The cue plays on a real change only.
   */
  const queuePremove = useCallback(
    (move: Premove | null) => {
      if (statusRef.current !== 'playing') return;
      const current = sessionRef.current;
      if (!current) return;

      if (!move) {
        if (premovesRef.current.length === 0) return;
        premovesRef.current = [];
        publish({ ...current, premoves: [] });
        return;
      }

      if (gameRef.current.turn() === playerColorRef.current) return;
      /* The chain is validated against the position the earlier premoves would
         reach, so a second premove can move the same piece again. */
      const preview = premoveQueueFen(
        gameRef.current.fen(),
        premovesRef.current,
        playerColorRef.current,
      );
      const piece = new Chess(preview).get(move.from as never);
      if (!piece || piece.color !== playerColorRef.current) return;

      const next = enqueuePremove(premovesRef.current, move);
      if (!next) return;

      premovesRef.current = next;
      publish({ ...current, premoves: next });
      playSoundEvent('premove');
    },
    [publish],
  );

  const resign = useCallback(() => {
    if (statusRef.current !== 'playing') return;
    finishRef.current(playerColorRef.current === 'w' ? '0-1' : '1-0', 'resignation');
  }, []);

  const offerDraw = useCallback(async () => {
    if (statusRef.current !== 'playing') return;
    const game = gameRef.current;
    const playerColor = playerColorRef.current;
    setNotice('Draw offered…');
    try {
      const evaluation = await engineRef.current.evaluatePosition(game.fen(), 6, 1);
      if (statusRef.current !== 'playing') return;
      const playerPov = playerColor === 'w' ? evaluation.scoreCp : -evaluation.scoreCp;
      if (Math.abs(playerPov) <= 120) {
        setNotice(null);
        finishRef.current('1/2-1/2', 'agreement');
      } else {
        setNotice('Draw declined — the opponent likes its position.');
      }
    } catch {
      setNotice('Draw offer could not be evaluated. Try again.');
    }
  }, []);

  const flipBoard = useCallback(() => {
    const current = sessionRef.current;
    if (!current) return;
    const next: PlayOrientation = orientationRef.current === 'white' ? 'black' : 'white';
    orientationRef.current = next;
    publish({ ...current, orientation: next });
    persistRef.current();
  }, [publish]);

  const rematch = useCallback(() => {
    const opponent = opponentRef.current;
    const config = configRef.current;
    if (opponent && config) startGame(opponent, config);
  }, [startGame]);

  /** Called by the playing section when the current-game view is entered/left. */
  const setVisible = useCallback(
    (visible: boolean) => {
      viewVisibleRef.current = visible;
      if (statusRef.current !== 'playing') return;

      const clock = clockRef.current;
      const botTurn = gameRef.current.turn() !== playerColorRef.current;

      if (!visible) {
        clearTimers();
        setBotThinking(false);
        /* Premoves are interaction state: leaving the board drops them rather
           than restoring them against a position they were not chosen for. */
        premovesRef.current = [];
        const current = sessionRef.current;
        if (current?.premoves.length) publish({ ...current, premoves: [] });
        /* The bot only moves while the board is mounted, so its clock is held.
           The player's clock keeps running: looking away is not free time. */
        if (clock && botTurn) setClockView(clock.pause(Date.now()));
        persistRef.current();
        return;
      }

      if (clock) setClockView(clock.resume(Date.now()));
      if (botTurn) scheduleBotRef.current(350);
      persistRef.current();
    },
    [clearTimers, publish],
  );

  /* ------------------------------- timeouts -------------------------------- */

  useEffect(() => {
    if (!session || session.status !== 'playing' || session.config.untimed) return;

    /* Runs even when another Play view is open: a clock that is running must be
       able to flag, otherwise leaving the board would stall the game. */
    const tick = setInterval(() => {
      const clock = clockRef.current;
      if (!clock) return;
      const snapshot = clock.snapshot(Date.now());
      setClockView(snapshot);
      if (snapshot.flagged && statusRef.current === 'playing') {
        finishRef.current(snapshot.flagged === 'w' ? '0-1' : '1-0', 'timeout');
      }
    }, 200);

    timersRef.current.tick = tick;
    return () => clearInterval(tick);
  }, [session?.id, session?.status, session?.config.untimed]);

  /* Persist the latest recoverable state and stop bot work on unmount. */
  useEffect(
    () => () => {
      if (timersRef.current.move) clearTimeout(timersRef.current.move);
      if (timersRef.current.tick) clearInterval(timersRef.current.tick);
      persistRef.current();
      clockRef.current?.stop();
    },
    [],
  );

  return {
    session,
    clock: clockView,
    botThinking,
    notice,
    resumable,
    resumeError,
    loadingActive,
    startGame,
    resumeGame,
    abandonResumable,
    playMove,
    queuePremove,
    resign,
    offerDraw,
    flipBoard,
    rematch,
    setVisible,
    clearNotice: () => setNotice(null),
    clearResumeError: () => setResumeError(null),
  };
}
