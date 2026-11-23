import { useCallback, useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import type { StockfishController } from '../engine/useStockfish.ts';
import { ChessClock, type ClockSnapshot } from './clock.ts';
import { savePlayedGame } from './gameStore.ts';
import { opponentFullName, type OpponentProfile } from './opponents.ts';
import { buildPgn, STANDARD_START_FEN } from './pgn.ts';
import { playSoundEvent } from './audio/soundManager.ts';
import { classifyMoveSound, moveSoundFacts } from './audio/soundEvents.ts';
import {
  createDialogueState,
  maybeReact,
  type DialogueState,
} from './personality/dialogue.ts';
import {
  botMoveEvents,
  createNarrativeState,
  endingEvent,
  ungradedMoveEvents,
  type NarrativeState,
} from './personality/events.ts';
import { describeMove, materialBalance } from './personality/engine.ts';
import { chooseBotMove, type ChosenBotMove } from './personality/chooseMove.ts';
import { createOpeningMemory, type OpeningMemoryState } from './personality/nina.ts';
import { styleFor, type PersonalityStyle } from './personality/styles.ts';
import type {
  GameConfig,
  PlayColor,
  PlayResult,
  PlayedGameRecord,
  ResultReason,
} from './types.ts';
import { matchDelayMs, type MatchSpeed } from './botMatch.ts';

export type { MatchSpeed } from './botMatch.ts';
export { matchDelayMs } from './botMatch.ts';

export interface BotMatchConfig {
  white: OpponentProfile;
  black: OpponentProfile;
  game: GameConfig;
  speed: MatchSpeed;
}

export interface BotMatchSession {
  id: string;
  white: OpponentProfile;
  black: OpponentProfile;
  config: GameConfig;
  speed: MatchSpeed;
  fen: string;
  sans: string[];
  lastMove: { from: string; to: string } | null;
  turn: PlayColor;
  status: 'playing' | 'paused' | 'finished';
  result: PlayResult | null;
  reason: ResultReason | null;
  thinking: PlayColor | null;
  reactions: Partial<Record<PlayColor, { text: string; at: number }>>;
  startedAt: number;
  endedAt: number | null;
  saveError: string | null;
  savedGameId: string | null;
}

const PLAYER_RESERVE_MS = 250;

export function useBotMatch(engine: StockfishController) {
  const [session, setSession] = useState<BotMatchSession | null>(null);
  const [clockView, setClockView] = useState<ClockSnapshot>(() => ChessClock.empty());

  const sessionRef = useRef<BotMatchSession | null>(null);
  const configRef = useRef<BotMatchConfig | null>(null);
  const gameRef = useRef(new Chess());
  const clockRef = useRef<ChessClock | null>(null);
  const stylesRef = useRef<Partial<Record<PlayColor, PersonalityStyle>>>({});
  const openingMemoryRef = useRef<Record<PlayColor, OpeningMemoryState>>({
    w: createOpeningMemory(),
    b: createOpeningMemory(),
  });
  const forgotLineRef = useRef<Record<PlayColor, boolean>>({ w: false, b: false });
  const dialogueRef = useRef<Record<PlayColor, DialogueState>>({
    w: createDialogueState(),
    b: createDialogueState(),
  });
  const narrativeRef = useRef<Record<PlayColor, NarrativeState>>({
    w: createNarrativeState(),
    b: createNarrativeState(),
  });
  const sansRef = useRef<string[]>([]);
  const statusRef = useRef<'idle' | 'playing' | 'paused' | 'finished'>('idle');
  /* `engine` is a fresh object each render; keep the latest for unmount cleanup. */
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const tokenRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedRef = useRef(false);
  const speedRef = useRef<MatchSpeed>('normal');
  const decisionRef = useRef<ChosenBotMove['decision']>(null);
  /** Plies played from a prepared line, for Game Review's Book label. */
  const bookPliesRef = useRef<number[]>([]);
  /** Set by the turn about to be committed, when that move was prepared. */
  const preparedRef = useRef(false);
  const runTurnRef = useRef<() => Promise<void>>(async () => {});

  const publish = useCallback((next: BotMatchSession | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const schedule = useCallback(
    (delay: number) => {
      clearTimer();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void runTurnRef.current();
      }, delay);
    },
    [clearTimer],
  );

  const finish = useCallback(
    (result: PlayResult, reason: ResultReason) => {
      if (statusRef.current !== 'playing') return;
      statusRef.current = 'finished';
      tokenRef.current += 1;
      clearTimer();
      engine.stop();
      clockRef.current?.stop();
      playSoundEvent('game-end');

      const config = configRef.current;
      const current = sessionRef.current;
      if (!config || !current) return;
      const endedAt = Date.now();
      const finalFen = gameRef.current.fen();
      const sans = [...sansRef.current];

      const reactions: BotMatchSession['reactions'] = { ...current.reactions };
      for (const color of ['w', 'b'] as const) {
        const style = stylesRef.current[color];
        if (!style) continue;
        const line = maybeReact(style.id, endingEvent(result, color), {
          ply: sans.length,
          state: dialogueRef.current[color],
          force: true,
        });
        if (line) reactions[color] = { text: line.text, at: endedAt };
      }

      publish({
        ...current,
        status: 'finished',
        result,
        reason,
        endedAt,
        fen: finalFen,
        turn: gameRef.current.turn(),
        thinking: null,
        reactions,
      });
      setClockView(clockRef.current?.snapshot(endedAt) ?? ChessClock.empty());

      if (savedRef.current) return;
      savedRef.current = true;

      const pgn = buildPgn(
        {
          white: opponentFullName(config.white),
          black: opponentFullName(config.black),
          result,
          date: endedAt,
          timeControl: config.game.untimed
            ? '-'
            : `${config.game.initialSeconds}+${config.game.incrementSeconds}`,
          whiteElo: config.white.elo,
          blackElo: config.black.elo,
          startingFen: STANDARD_START_FEN,
          event: 'Bot vs. Bot',
          site: 'Johnfer Quispe — Playing Lab',
        },
        sans,
      );
      const id = current.id;
      const record: PlayedGameRecord = {
        game_id: id,
        mode: 'bot-vs-bot',
        white_opponent_id: config.white.id,
        black_opponent_id: config.black.id,
        white_name: opponentFullName(config.white),
        black_name: opponentFullName(config.black),
        white_elo: config.white.elo,
        black_elo: config.black.elo,
        opponent_id: config.black.id,
        opponent_name: opponentFullName(config.black),
        opponent_elo: config.black.elo,
        opponent_kind: config.black.kind,
        player_color: 'w',
        result,
        reason,
        pgn,
        sans,
        ...(bookPliesRef.current.length > 0 ? { book_plies: [...bookPliesRef.current] } : {}),
        initial_seconds: config.game.initialSeconds,
        increment_seconds: config.game.incrementSeconds,
        started_at: current.startedAt,
        ended_at: endedAt,
        duration_seconds: Math.max(1, Math.round((endedAt - current.startedAt) / 1000)),
        final_fen: finalFen,
        starting_fen: STANDARD_START_FEN,
        board_orientation: 'white',
        time_control_id: config.game.timeControlId,
      };

      void savePlayedGame(record)
        .then(() => {
          const latest = sessionRef.current;
          if (latest?.id === id) publish({ ...latest, savedGameId: id });
        })
        .catch(() => {
          const latest = sessionRef.current;
          if (latest?.id === id) publish({ ...latest, saveError: 'This match could not be saved.' });
        });
    },
    [clearTimer, engine, publish],
  );

  const commit = useCallback(
    (uci: string, token: number) => {
      if (statusRef.current !== 'playing' || tokenRef.current !== token) return;
      const game = gameRef.current;
      const now = Date.now();
      const clock = clockRef.current;
      if (clock?.snapshot(now).flagged) return;

      const before = game.fen();
      const mover = game.turn();
      let applied;
      try {
        applied = game.move({
          from: uci.slice(0, 2),
          to: uci.slice(2, 4),
          promotion: uci.length > 4 ? uci.slice(4, 5) : undefined,
        });
      } catch {
        return;
      }
      if (!applied) return;

      const after = game.fen();
      if (clock) setClockView(clock.afterMove(mover, game.turn(), now));
      if (preparedRef.current) bookPliesRef.current.push(sansRef.current.length);
      preparedRef.current = false;
      sansRef.current = [...sansRef.current, applied.san];

      const style = stylesRef.current[mover];
      const reactions = { ...sessionRef.current?.reactions };
      const decision = decisionRef.current;
      decisionRef.current = null;
      if (style) {
        const sign = mover === 'w' ? 1 : -1;
        const materialDelta = (materialBalance(after) - materialBalance(before)) * sign;
        /* A sub-400 random turn comes back ungraded, so there is no candidate
           list to narrate from; the board itself still has something to say. */
        const events = decision
          ? botMoveEvents(
              {
                style,
                gap: decision.gap,
                best: decision.best,
                features: decision.features,
                botPov: decision.botPov,
                materialDelta,
              },
              narrativeRef.current[mover],
            )
          : ungradedMoveEvents(
              describeMove(before, `${applied.from}${applied.to}${applied.promotion ?? ''}`),
              materialDelta,
            );
        if (decision?.bookMove && !narrativeRef.current[mover].bookSaid) events.unshift('book');
        if (forgotLineRef.current[mover]) {
          events.unshift('deviation');
          forgotLineRef.current[mover] = false;
        }
        for (const event of events) {
          const line = maybeReact(style.id, event, {
            ply: sansRef.current.length,
            state: dialogueRef.current[mover],
          });
          if (line) {
            reactions[mover] = { text: line.text, at: now };
            break;
          }
        }
      }

      const current = sessionRef.current;
      if (current) {
        publish({
          ...current,
          fen: after,
          sans: sansRef.current,
          lastMove: { from: applied.from, to: applied.to },
          turn: game.turn(),
          thinking: null,
          reactions,
        });
      }

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
              side: 'opponent',
              check: game.isCheck(),
              gameEnd: false,
            }),
          ),
        );
      }

      if (game.isCheckmate()) return finish(applied.color === 'w' ? '1-0' : '0-1', 'checkmate');
      if (game.isStalemate()) return finish('1/2-1/2', 'stalemate');
      if (game.isInsufficientMaterial()) return finish('1/2-1/2', 'insufficient-material');
      if (game.isThreefoldRepetition()) return finish('1/2-1/2', 'threefold-repetition');
      if (game.isDraw()) return finish('1/2-1/2', 'fifty-move');

      /* The next bot's clock is held while the viewer watches the last move;
         presentation speed must never charge either player. */
      clock?.pause(now);
      setClockView(clock?.snapshot(now) ?? ChessClock.empty());
      schedule(matchDelayMs(speedRef.current));
    },
    [finish, publish, schedule],
  );

  const runTurn = useCallback(async () => {
    if (statusRef.current !== 'playing') return;
    const game = gameRef.current;
    const token = tokenRef.current;
    const mover = game.turn();
    const style = stylesRef.current[mover] ?? null;
    const config = configRef.current;
    if (!config) return;

    const now = Date.now();
    const clock = clockRef.current;
    if (clock) {
      if (!clock.isStarted) clock.start(now);
      else clock.resume(now);
      setClockView(clock.snapshot(now));
    }
    const current = sessionRef.current;
    if (current) publish({ ...current, thinking: mover });

    const snapshot = clock?.snapshot(now);
    const remaining = snapshot ? (mover === 'w' ? snapshot.whiteMs : snapshot.blackMs) : null;
    const left =
      remaining === null ? null : Math.max(0, remaining - PLAYER_RESERVE_MS);

    let chosen;
    try {
      chosen = await chooseBotMove({
        game,
        fen: game.fen(),
        history: sansRef.current,
        botColor: mover,
        style,
        elo: mover === 'w' ? config.white.elo : config.black.elo,
        clockMs: left,
        incrementMs: config.game.incrementSeconds * 1000,
        initialMs: config.game.initialSeconds * 1000,
        engine,
        shouldAbort: () => token !== tokenRef.current || statusRef.current !== 'playing',
        openingMemory: openingMemoryRef.current[mover],
      });
    } catch (error) {
      /* Pausing aborts the search and is not a failure. */
      if (tokenRef.current !== token || statusRef.current !== 'playing') return;
      console.error('[botmatch] move selection failed', error);
      const latest = sessionRef.current;
      if (latest) publish({ ...latest, thinking: null });
      schedule(800);
      return;
    }

    if (!chosen || token !== tokenRef.current || statusRef.current !== 'playing') return;
    decisionRef.current = chosen.decision;
    forgotLineRef.current[mover] = chosen.forgotten;
    /* Prepared play is remembered per ply so review can label it Book. */
    preparedRef.current = chosen.source !== 'engine' || chosen.bookMove;
    commit(chosen.uci, token);
  }, [commit, engine, publish]);

  runTurnRef.current = runTurn;

  const start = useCallback(
    (config: BotMatchConfig) => {
      if (config.white.id === config.black.id) return;
      engine.stop();
      tokenRef.current += 1;
      clearTimer();

      const clock = config.game.untimed
        ? null
        : new ChessClock(config.game.initialSeconds, config.game.incrementSeconds);
      gameRef.current = new Chess();
      clockRef.current = clock;
      configRef.current = config;
      speedRef.current = config.speed;
      stylesRef.current = {
        w: styleFor(config.white.id, config.white.elo) ?? undefined,
        b: styleFor(config.black.id, config.black.elo) ?? undefined,
      };
      dialogueRef.current = { w: createDialogueState(), b: createDialogueState() };
      narrativeRef.current = { w: createNarrativeState(), b: createNarrativeState() };
      openingMemoryRef.current = { w: createOpeningMemory(), b: createOpeningMemory() };
      forgotLineRef.current = { w: false, b: false };
      sansRef.current = [];
      bookPliesRef.current = [];
      preparedRef.current = false;
      statusRef.current = 'playing';
      savedRef.current = false;
      decisionRef.current = null;
      setClockView(clock ? clock.snapshot(Date.now()) : ChessClock.empty());

      publish({
        id: `botmatch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        white: config.white,
        black: config.black,
        config: config.game,
        speed: config.speed,
        fen: gameRef.current.fen(),
        sans: [],
        lastMove: null,
        turn: 'w',
        status: 'playing',
        result: null,
        reason: null,
        thinking: null,
        reactions: {},
        startedAt: Date.now(),
        endedAt: null,
        saveError: null,
        savedGameId: null,
      });
      schedule(450);
    },
    [clearTimer, engine, publish, schedule],
  );

  const pause = useCallback(() => {
    if (statusRef.current !== 'playing') return;
    statusRef.current = 'paused';
    tokenRef.current += 1;
    clearTimer();
    engine.stop();
    const now = Date.now();
    clockRef.current?.pause(now);
    setClockView(clockRef.current?.snapshot(now) ?? ChessClock.empty());
    const current = sessionRef.current;
    if (current) publish({ ...current, status: 'paused', thinking: null });
  }, [clearTimer, engine, publish]);

  const resume = useCallback(() => {
    if (statusRef.current !== 'paused') return;
    statusRef.current = 'playing';
    const now = Date.now();
    clockRef.current?.resume(now);
    setClockView(clockRef.current?.snapshot(now) ?? ChessClock.empty());
    const current = sessionRef.current;
    if (current) publish({ ...current, status: 'playing' });
    schedule(120);
  }, [publish, schedule]);

  const stop = useCallback(() => {
    tokenRef.current += 1;
    clearTimer();
    engine.stop();
    clockRef.current?.stop();
    statusRef.current = 'idle';
    configRef.current = null;
    publish(null);
    setClockView(ChessClock.empty());
  }, [clearTimer, engine, publish]);

  const restart = useCallback(() => {
    const config = configRef.current;
    if (config) start(config);
  }, [start]);

  const setSpeed = useCallback(
    (speed: MatchSpeed) => {
      speedRef.current = speed;
      const current = sessionRef.current;
      if (current) publish({ ...current, speed });
    },
    [publish],
  );

  const setVisible = useCallback(
    (visible: boolean) => {
      if (!visible) pause();
    },
    [pause],
  );

  useEffect(() => {
    if (!session || session.status !== 'playing' || session.config.untimed) return;
    const tick = setInterval(() => {
      const clock = clockRef.current;
      if (!clock) return;
      const snapshot = clock.snapshot(Date.now());
      setClockView(snapshot);
      if (snapshot.flagged && statusRef.current === 'playing') {
        finish(snapshot.flagged === 'w' ? '0-1' : '1-0', 'timeout');
      }
    }, 200);
    return () => clearInterval(tick);
  }, [session?.id, session?.status, session?.config.untimed, finish]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      engineRef.current.stop();
    },
    [],
  );

  return {
    session,
    clock: clockView,
    start,
    pause,
    resume,
    stop,
    restart,
    setSpeed,
    setVisible,
  };
}
