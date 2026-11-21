import { Chess } from 'chess.js';
import type { StockfishController } from '../../engine/useStockfish.ts';
import { depthForElo, chooseCandidate, chooseBlunder } from '../strength.ts';
import {
  HUMAN_MULTI_PV,
  lastCaptureOf,
  planHumanSearch,
  selectHumanBotMove,
  timeControlCategory,
} from '../humanStrength.ts';
import { chooseRandomLegalMove } from '../blunders.ts';
import type { PlayColor } from '../types.ts';
import {
  choosePersonalityMove,
  describeMove,
  type MoveFeatures,
  type PersonalityCandidate,
  type SelectionResult,
} from './engine.ts';
import { bryanAlapinPreference } from './bryan.ts';
import { hasPreparedOpening, openingSource, shouldTakeBlunder } from './opening.ts';
import { legalBookMoves } from './repertoires/book.ts';
import { personalityBookFor } from './repertoires/index.ts';
import { chooseKidMove, kidPlan } from './repertoires/kid.ts';
import {
  chooseNinaBookMove,
  chooseNinaPlanMove,
  createOpeningMemory,
  ninaPlan,
  type OpeningMemoryState,
} from './nina.ts';
import { faadiAllowsMistake } from './faadi.ts';
import { edwardAllowsMistake } from './edward.ts';
import { bryanWidjajaAllowsMistake } from './bryanWidjaja.ts';
import {
  brandonFreshmanAllowsMistake,
  chooseBrandonFreshmanMove,
} from './brandonFreshman.ts';
import type { PersonalityStyle } from './styles.ts';
import { computeThinkingPlan, type ThinkingPlan } from './thinking.ts';

/**
 * Shared bot move selection.
 *
 * The human game hook and the bot-vs-bot controller both call this, so a
 * personality behaves identically in either mode: prepared book first, then the
 * King's Indian preference, then the same Stockfish search, candidate scoring
 * and Elo limits. It deliberately owns no React state, timers or dialogue —
 * callers decide how to present and narrate the chosen move.
 */

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

export interface ChooseBotMoveInput {
  game: Chess;
  fen: string;
  history: readonly string[];
  botColor: PlayColor;
  style: PersonalityStyle | null;
  elo: number;
  clockMs: number | null;
  incrementMs: number;
  initialMs: number;
  engine: StockfishController;
  random?: () => number;
  /** Returns true when the caller cancelled (paused, stopped, new match). */
  shouldAbort?: () => boolean;
  /** Per-game memory; only Nina reads it. */
  openingMemory?: OpeningMemoryState;
}

export interface ChosenBotMove {
  uci: string;
  plan: ThinkingPlan | null;
  decision: (SelectionResult & { bookMove: boolean; botPov: number }) | null;
  bookMove: boolean;
  /** True on the move where Nina loses her opening line. */
  forgotten: boolean;
  source: 'repertoire' | 'nina-principles' | 'kids-indian' | 'engine';
  candidates: readonly PersonalityCandidate[];
}

export async function chooseBotMove(input: ChooseBotMoveInput): Promise<ChosenBotMove | null> {
  const { game, fen, history, botColor, style, elo, engine } = input;
  const random = input.random ?? Math.random;
  const aborted = () => input.shouldAbort?.() ?? false;

  const thinking = {
    fen,
    clockMs: input.clockMs,
    incrementMs: input.incrementMs,
    initialMs: input.initialMs,
    ply: history.length,
  };

  let uci: string | null = null;
  let plan: ThinkingPlan | null = null;
  let decision: ChosenBotMove['decision'] = null;
  let bookMove = false;
  let forgotten = false;
  let candidates: readonly PersonalityCandidate[] = [];

  if (style) {
    /* Bryan's one stated preference outranks the shared book: 2.c3 against the
       Sicilian, where his borrowed White book would otherwise play Brandon's
       2.Ne2. Null for every other character and every other position. */
    const alapin = bryanAlapinPreference(fen, history, style);
    if (alapin) {
      uci = alapin;
      bookMove = true;
      plan = computeThinkingPlan({ ...thinking, style, bookMove: true });
      decision = {
        uci,
        gap: 0,
        best: true,
        bookMove: true,
        botPov: 0,
        features: describeMove(fen, uci) ?? NEUTRAL_FEATURES,
      };
    }

    if (!uci) {
      const moves = legalBookMoves(personalityBookFor(style.id, botColor), game);
      const chosen = chooseNinaBookMove({
        moves,
        style,
        history,
        memory: input.openingMemory ?? createOpeningMemory(),
        random,
      });
      forgotten = chosen.forgotten;
      if (chosen.move) {
        uci = chosen.move.uci;
        bookMove = true;
        plan = computeThinkingPlan({ ...thinking, style, bookMove: true });
        decision = {
          uci,
          gap: 0,
          best: true,
          bookMove: true,
          botPov: 0,
          features: describeMove(fen, uci) ?? NEUTRAL_FEATURES,
        };
      }
    }
  }

  const nina =
    !uci && style
      ? ninaPlan(fen, history, style, input.openingMemory?.forgotten)
      : null;
  const kid = !uci && style ? kidPlan(fen, history, style) : null;
  const source = openingSource({
    bookMove: Boolean(uci),
    ninaPlan: Boolean(nina),
    kidPlan: Boolean(kid),
  });

  if (!uci) {
    if (style) plan = computeThinkingPlan({ ...thinking, style, bookMove: false });

    /* Five lines: the personality layer and the blunder pick both choose from
       this list, so it needs real alternatives near the best move. A bot with
       no personality is calibrated to its USCF rating instead: six lines, the
       tier's depth, and a human deliberation the search spends itself. */
    const humanSearch = style
      ? null
      : planHumanSearch({
          fen,
          elo,
          moveNumber: Math.floor(history.length / 2) + 1,
          timeControlCategory: timeControlCategory(input.initialMs),
          remainingTimeMs: input.clockMs,
          incrementMs: input.incrementMs,
          lastMove: lastCaptureOf(game),
          random,
        });
    /* `depthCap` is a per-character ceiling (Edward's beginner calculation);
       every other profile still searches at the depth its rating earns. */
    const evaluation = style
      ? await engine.evaluateWithin(
          fen,
          Math.min(depthForElo(elo), style.depthCap ?? depthForElo(elo)),
          5,
          plan?.searchMs ?? 1200,
        )
      : await engine.evaluateWithin(
          fen,
          humanSearch!.depth,
          HUMAN_MULTI_PV,
          humanSearch!.thinkTimeMs,
          humanSearch!.nodeCap ?? 0,
        );
    candidates = evaluation.candidates;

    if (aborted()) return null;

    /* Personalities roll once per turn for a human-style mistake. The calibrated
       path carries its own mistake model inside `selectHumanBotMove`. */
    const rolled =
      style &&
      shouldTakeBlunder(elo, random, hasPreparedOpening(source), style.mistakeChance)
        ? chooseBlunder(evaluation.candidates, botColor, elo, random)
        : null;
    /* Faadi still sees a free piece: his wildcard error is an idea he missed,
       not a queen handed over in broad daylight. */
    const blunder =
      rolled &&
      faadiAllowsMistake(fen, rolled, style) &&
      edwardAllowsMistake(fen, rolled, style) &&
      bryanWidjajaAllowsMistake(fen, rolled, style) &&
      brandonFreshmanAllowsMistake(fen, rolled, style)
        ? rolled
        : null;

    if (style) {
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
            history,
            style,
            elo,
            candidates: evaluation.candidates,
          })
        : null;

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
          const childEval = await engine.evaluateWithin(
            child.fen(),
            Math.max(4, depthForElo(elo) - 2),
            1,
            300,
          );
          if (aborted()) return null;

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
                      : style.id === 'bryan-widjaja'
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
            history,
            style,
            elo,
            candidates: evaluation.candidates,
            forgotten: input.openingMemory?.forgotten,
          })
        : null;

      /* Freshman Brandon's funk re-ranks the same candidates his profile would
         see; every other character gets null here and keeps the shared scorer. */
      const funkSelection = chooseBrandonFreshmanMove({
        fen,
        candidates: evaluation.candidates,
        style,
        elo,
        random,
      });

      const selection =
        blunderSelection ??
        kidSelection ??
        ninaSelection ??
        funkSelection ??
        choosePersonalityMove({ fen, candidates: evaluation.candidates, style, elo });
      if (selection) {
        uci = selection.uci;
        decision = {
          ...selection,
          bookMove: false,
          botPov: (botColor === 'w' ? 1 : -1) * evaluation.scoreCp,
        };
      } else if (evaluation.bestMove) {
        uci = evaluation.bestMove;
      }
    } else {
      /* USCF-calibrated human selection: MultiPV weights, recapture and
         catastrophic-move heuristics, and a tier-specific mistake rate. */
      const choice = selectHumanBotMove({
        fen,
        elo,
        candidates: evaluation.candidates,
        lastMove: lastCaptureOf(game),
        plan: humanSearch!,
        random,
      });
      uci = choice.uci ?? chooseCandidate(evaluation.candidates, elo, random, fen);
      if (!uci) uci = evaluation.bestMove;
    }
  }

  if (!uci) {
    /* Engine unavailable: fall back to a legal move, but still refuse the
       free-piece accidents the static guard can see. */
    uci = chooseRandomLegalMove(game, elo, random);
  }
  if (!uci) return null;

  return { uci, plan, decision, bookMove, forgotten, source, candidates };
}
