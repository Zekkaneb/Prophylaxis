import { Chess } from 'chess.js';
import type { StockfishController } from '../../engine/useStockfish.ts';
import {
  chooseCandidate,
  chooseBlunder,
  HOPELESS_EVAL_CP,
  ratedLossCap,
} from '../strength.ts';
import {
  HUMAN_MULTI_PV,
  lastCaptureOf,
  pickCategory,
  planHumanSearch,
  rollSub400RandomFloor,
  selectHumanBotMove,
  slipBand,
  timeControlCategory,
  type Bucket,
  type HumanSearchPlan,
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
import { hasPreparedOpening, openingSource } from './opening.ts';
import { legalBookMoves } from './repertoires/book.ts';
import { theoryWindow } from '../theory.ts';
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
import { traceBotMove } from '../botDebug.ts';

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

/**
 * One roll for this turn's slip, then a move from that band.
 *
 * The calibrated path gets its strength from `selectHumanBotMove`; a character
 * bot used to get it from `blunderChance`, a curve that only ever produced a
 * blunder and only when a five-line deep list happened to contain an 80 cp
 * worse move — which at depth 16 it usually does not. Rolling the rated quality
 * distribution instead means a 1400's turn is an inaccuracy, a mistake or a
 * blunder at the frequency its rating implies, and the chosen move really sits
 * in that band.
 */
/**
 * The mistakes this character would really make.
 *
 * Faadi does not hand over a free piece, Edward does not walk into the obvious
 * tactic, and the two Widjaja profiles and freshman Brandon have their own
 * blind spots. Applied inside the slip pool (not after the pick), so a vetoed
 * candidate costs the character a different error rather than a free best move.
 */
export function characterSlipGuard(
  fen: string,
  style: PersonalityStyle | null,
): (uci: string) => boolean {
  return (uci) =>
    faadiAllowsMistake(fen, uci, style) &&
    edwardAllowsMistake(fen, uci, style) &&
    bryanWidjajaAllowsMistake(fen, uci, style) &&
    brandonFreshmanAllowsMistake(fen, uci, style);
}

export function rollCharacterSlip(input: {
  style: PersonalityStyle;
  plan: HumanSearchPlan;
  source: ChosenBotMove['source'];
  botColor: PlayColor;
  elo: number;
  candidates: readonly PersonalityCandidate[];
  random: () => number;
  /** The position the mistake is being made in, for the character's guard. */
  fen: string;
}): { uci: string; kind: Bucket; band: { minGap: number; maxGap: number } } | null {
  const { style, plan, source, botColor, elo, candidates, random, fen } = input;
  if (hasPreparedOpening(source)) return null;

  /* A character with its own dial keeps it: `mistakeChance` expresses a
     difficulty the curve cannot (it floors out at 45%), so those characters
     roll their slip directly. Everyone else rolls the rated distribution. */
  const kind: Bucket =
    style.mistakeChance !== undefined
      ? random() < style.mistakeChance
        ? 'blunder'
        : 'best'
      : pickCategory(random(), plan.quality);
  /* The band itself is rated: a 2400's inaccuracy is a third of a beginner's. */
  const band = slipBand(kind, elo);
  if (!band) return null;

  const uci = chooseBlunder(candidates, botColor, elo, random, band, characterSlipGuard(fen, style));
  return uci ? { uci, kind, band } : null;
}

export interface CeilingCheck {
  /** The move to play instead: the engine's best line. */
  uci: string;
  /** Centipawns the original choice would have cost. */
  loss: number;
  /** The best line's score in the bot's own point of view. */
  bestPov: number;
  features: MoveFeatures;
}

/**
 * The one rule the strength model may not override.
 *
 * Everything else models how a rating errs; this is the line past which a move
 * is not an error but a lost piece. Given whatever the selection produced, it
 * returns the engine's best line when the choice would cost more than the
 * rating's ceiling (`ratedLossCap`) in a position that is not already lost, and
 * `null` when the move stands. Both move-selection paths apply it last, so a
 * new band, a character dial or an off-list probe cannot reopen the hole a 2000
 * fell through.
 */
export function enforceRatedCeiling(input: {
  uci: string;
  fen: string;
  candidates: readonly PersonalityCandidate[];
  botColor: PlayColor;
  elo: number;
}): CeilingCheck | null {
  const { uci, fen, candidates, botColor, elo } = input;
  if (candidates.length === 0) return null;
  const sign = botColor === 'w' ? 1 : -1;
  const best = candidates.reduce((a, b) => (sign * b.scoreCp > sign * a.scoreCp ? b : a));
  const chosen = candidates.find((candidate) => candidate.uci === uci);
  const cap = ratedLossCap(elo);
  const bestPov = sign * best.scoreCp;
  if (!chosen || cap === null || bestPov <= HOPELESS_EVAL_CP) return null;
  const loss = Math.max(0, Math.round(bestPov - sign * chosen.scoreCp));
  if (loss <= cap) return null;
  return {
    uci: best.uci,
    loss,
    bestPov,
    features: describeMove(fen, best.uci) ?? NEUTRAL_FEATURES,
  };
}

export async function chooseBotMove(input: ChooseBotMoveInput): Promise<ChosenBotMove | null> {
  const { game, fen, history, botColor, style, elo, engine } = input;
  const random = input.random ?? Math.random;
  const aborted = () => input.shouldAbort?.() ?? false;
  /* Where the character *plays*, not where its card says it plays: `styleFor`
     folds the per-character offset into one rating, so a neighbour's card 1600
     can play like a 1450 without the card lying about it. */
  const ratedElo = style?.planElo ?? elo;

  const thinking = {
    fen,
    clockMs: input.clockMs,
    incrementMs: input.incrementMs,
    initialMs: input.initialMs,
    ply: history.length,
  };

  let uci: string | null = null;
  /* The rated search plan, kept outside the engine branch so the dev trace can
     report the depth and effective rating the move was actually chosen at. */
  let searchPlan: HumanSearchPlan | null = null;
  /** The quality class the slip roll asked for, for the dev trace. */
  let slipKind: Bucket | null = null;
  /** The centipawn band that class covered this turn, for the dev trace. */
  let slipBandRolled: { minGap: number; maxGap: number } | null = null;
  let plan: ThinkingPlan | null = null;
  let decision: ChosenBotMove['decision'] = null;
  let bookMove = false;
  let forgotten = false;
  let candidates: readonly PersonalityCandidate[] = [];

  /* The sub-400 floor comes first, ahead of the book, the character sheet and
     the search: below 400 USCF the bot may simply not look at the board. A
     styled bot never reaches `selectHumanBotMove`, which is where that roll
     lives for the calibrated path, so without this guard a 150 would obey only
     his dials and never make the random move his rating implies. */
  if (style) {
    const floorMove = rollSub400RandomFloor(game, ratedElo, random);
    if (floorMove !== null) {
      return {
        uci: floorMove,
        plan: computeThinkingPlan({ ...thinking, style, bookMove: false }),
        decision: null,
        bookMove: false,
        forgotten: false,
        source: 'engine',
        candidates: [],
      };
    }
  }

  /* One window for every theory source, shared with regular Play: repertoire,
     Nina's skeleton and the King's Indian plan all stop at the same ply. */
  const theory = theoryWindow(elo, history.length);

  if (style) {
    /* Bryan's one stated preference outranks the shared book: 2.c3 against the
       Sicilian, where his borrowed White book would otherwise play Brandon's
       2.Ne2. Null for every other character and every other position. */
    const alapin = theory.open ? bryanAlapinPreference(fen, history, style) : null;
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
      const moves = theory.open
        ? legalBookMoves(personalityBookFor(style.id, botColor), game)
        : [];
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
    !uci && style && theory.open
      ? ninaPlan(fen, history, style, botColor, input.openingMemory?.forgotten)
      : null;
  const kid = !uci && style && theory.open ? kidPlan(fen, history, style, botColor) : null;
  const source = openingSource({
    bookMove: Boolean(uci),
    ninaPlan: Boolean(nina),
    kidPlan: Boolean(kid),
  });

  if (!uci) {
    if (style) plan = computeThinkingPlan({ ...thinking, style, bookMove: false });

    /* Every bot searches at the depth its rating earns, character or not: the
       rating's human plan is the strength dial, and a per-character `depthCap`
       can only shorten that look (Edward's beginner calculation). MultiPV is the
       same wide list for both paths, so the slip picker always has real
       alternatives — a five-line list at a deep search is all near-best moves,
       which is how a 1400 used to come out at engine strength. */
    const humanSearch = planHumanSearch({
      fen,
      elo: ratedElo,
      moveNumber: Math.floor(history.length / 2) + 1,
      timeControlCategory: timeControlCategory(input.initialMs),
      remainingTimeMs: input.clockMs,
      incrementMs: input.incrementMs,
      lastMove: lastCaptureOf(game),
      /* A character has its own deliberation curve (`computeThinkingPlan`), so
         only the plan's *quality* is read here. Handing it the shared random
         source would spend rolls on think-time the character never uses. */
      random: style ? () => 0.5 : random,
    });
    const searchDepth = Math.min(
      humanSearch.depth,
      style?.depthCap ?? Number.POSITIVE_INFINITY,
    );
    searchPlan = humanSearch;
    const evaluation = style
      ? await engine.evaluateWithin(fen, searchDepth, HUMAN_MULTI_PV, plan?.searchMs ?? 1200)
      : await engine.evaluateWithin(
          fen,
          searchDepth,
          HUMAN_MULTI_PV,
          humanSearch.thinkTimeMs,
          humanSearch.nodeCap ?? 0,
        );
    candidates = evaluation.candidates;

    if (aborted()) return null;

    /* A personality rolls the same quality distribution the calibrated path
       does — the rating's own error mass — and fills the rolled band from the
       engine's list. A character with an explicit `mistakeChance` keeps that
       dial instead, since it expresses difficulty the curve cannot (it floors
       out at 45%). The calibrated path carries the full model inside
       `selectHumanBotMove`, so it never reaches this roll. */
    const slip = style
      ? rollCharacterSlip({
          style,
          plan: humanSearch,
          source,
          botColor,
          elo: ratedElo,
          candidates: evaluation.candidates,
          random,
          fen,
        })
      : null;
    const blunder = slip?.uci ?? null;
    slipKind = slip?.kind ?? null;
    slipBandRolled = slip?.band ?? null;

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
            color: botColor,
            elo: ratedElo,
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
            Math.max(2, searchDepth - 2),
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
            color: botColor,
            elo: ratedElo,
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
        elo: ratedElo,
        random,
      });

      const selection =
        blunderSelection ??
        kidSelection ??
        ninaSelection ??
        funkSelection ??
        choosePersonalityMove({ fen, candidates: evaluation.candidates, style, elo: ratedElo });
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
        elo: ratedElo,
        candidates: evaluation.candidates,
        lastMove: lastCaptureOf(game),
        plan: humanSearch!,
        random,
      });
      uci = choice.uci ?? chooseCandidate(evaluation.candidates, ratedElo, random, fen);
      if (!uci) uci = evaluation.bestMove;
    }
  }

  if (!uci) {
    /* Engine unavailable: fall back to a legal move, but still refuse the
       free-piece accidents the static guard can see. */
    uci = chooseRandomLegalMove(game, ratedElo, random);
  }
  if (!uci) return null;

  /* The hard ceiling for the strong cards: a rolled slip, a character's idea, a
     plan move or an off-list probe can each end up costing a piece when the
     engine's list is unlucky, so the pick is checked one last time against the
     best line. Below 1800 the cap is null and nothing changes. */
  const ceiling =
    !bookMove && uci
      ? enforceRatedCeiling({ uci, fen, candidates, botColor, elo: ratedElo })
      : null;
  if (ceiling) {
    uci = ceiling.uci;
    decision = {
      uci,
      gap: ceiling.loss,
      best: false,
      features: ceiling.features,
      bookMove: false,
      botPov: ceiling.bestPov,
    };
  }

  /* Calibration trace: target rating, the search that was really run, where the
     move sat in the engine's list and what it cost. Answers "is the 1400 bot
     actually playing like a 1400" from data instead of impressions. */
  if (searchPlan) {
    const chosen = candidates.find((candidate) => candidate.uci === uci);
    /* Candidate scores are White's point of view, like the engine's. Comparing
       them raw made a Black bot's trace report the *worst* score as the best
       line, so a rank-1 move could print as a 918 cp blunder. */
    const traceSign = botColor === 'w' ? 1 : -1;
    const bestCp = candidates.reduce(
      (best, candidate) => Math.max(best, traceSign * candidate.scoreCp),
      Number.NEGATIVE_INFINITY,
    );
    traceBotMove({
      elo,
      effectiveElo: searchPlan.calibration.elo,
      depth: Math.min(searchPlan.depth, style?.depthCap ?? Number.POSITIVE_INFINITY),
      multiPv: HUMAN_MULTI_PV,
      source,
      bookMove,
      rank: candidates.findIndex((candidate) => candidate.uci === uci) + 1,
      cpLoss:
        chosen && Number.isFinite(bestCp)
          ? Math.max(0, Math.round(bestCp - traceSign * chosen.scoreCp))
          : 0,
      kind: slipKind,
      rolledBand: slipBandRolled,
      capCp: ratedLossCap(ratedElo),
    });
  }

  return { uci, plan, decision, bookMove, forgotten, source, candidates };
}
