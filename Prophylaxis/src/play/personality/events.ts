import type { PlayColor, PlayResult } from '../types.ts';
import type { DialogueEvent } from './dialogue.ts';
import type { MoveFeatures } from './engine.ts';
import type { PersonalityStyle } from './styles.ts';

/**
 * Turns chess facts into candidate dialogue events.
 *
 * Nothing here decides whether a line is spoken — that is `maybeReact` and its
 * cooldowns. This layer only answers "what just happened, from the bot's point
 * of view", using the engine's own candidate scores plus material counts and
 * simple move features. Every opinion is expressed in centipawns relative to
 * the bot, and only big, reliable differences become events.
 */

export interface NarrativeState {
  announcedWinning: boolean;
  announcedLosing: boolean;
  /** Evaluation (bot POV) when the current attack began, null when none. */
  attackEval: number | null;
  deviationSaid: boolean;
  bookSaid: boolean;
}

export function createNarrativeState(): NarrativeState {
  return {
    announcedWinning: false,
    announcedLosing: false,
    attackEval: null,
    deviationSaid: false,
    bookSaid: false,
  };
}

export interface BotMoveFacts {
  style: PersonalityStyle;
  /** Centipawns given up against the engine's best move. */
  gap: number;
  best: boolean;
  features: MoveFeatures;
  /** Bot's own evaluation of the position it moved from, in centipawns. */
  botPov: number;
  /** Change in own material caused by the move. */
  materialDelta: number;
}

/**
 * Ordered by how much the character would care. The caller takes the first
 * event that survives the dialogue cooldown, so a material loss outranks a
 * "strong move" in the same ply.
 */
/**
 * Events for a move nobody graded.
 *
 * The sub-400 random floor picks a legal move without running a search, so the
 * caller has no candidate list, no gap and no evaluation to narrate from. A
 * low-rated character used to say nothing at all on those turns — most of a 150
 * bot's game. Only what is visible on the board is used here: material taken or
 * given, a check, then the move itself as an ordinary remark. Cooldowns in
 * `maybeReact` still decide whether any of it is spoken.
 */
export function ungradedMoveEvents(
  features: MoveFeatures | null,
  materialDelta: number,
): DialogueEvent[] {
  const events: DialogueEvent[] = [];
  if (materialDelta >= 100) events.push('material-won');
  if (materialDelta <= -100) events.push('material-lost');
  if (features?.sacrifices) events.push('sacrifice');
  if (features?.check) events.push('attack');
  /* Every move is worth a shrug, so a quiet random turn is still a chance to
     speak rather than a silence. */
  events.push('strong');
  return events;
}

export function botMoveEvents(facts: BotMoveFacts, state: NarrativeState): DialogueEvent[] {
  const events: DialogueEvent[] = [];

  if (state.attackEval !== null && facts.botPov < state.attackEval - 180) {
    events.push('attack-fail');
    state.attackEval = null;
  }

  /* A justified sacrifice is a talking point, not a blunder: it only becomes
     'material-lost' when the engine also dislikes the position. */
  if (facts.features.sacrifices && facts.materialDelta <= -200 && facts.botPov > -120) {
    events.push('sacrifice');
  } else if (facts.materialDelta <= -300) {
    events.push('material-lost');
  }
  if (facts.gap >= 90) events.push('mistake');

  if (!state.announcedWinning && facts.botPov >= 250) events.push('winning');
  if (!state.announcedLosing && facts.botPov <= -250) events.push('losing');

  if (facts.botPov < -60 && facts.best && !facts.features.capture) events.push('defense');

  const active =
    facts.style.aggression >= 60 &&
    facts.botPov > -100 &&
    (facts.features.check || facts.features.attacksKing || facts.features.toEnemyHalf);
  if (active) {
    events.push('attack');
    state.attackEval = facts.botPov;
  }

  if (facts.materialDelta >= 300) events.push('material-won');
  if (facts.best && facts.botPov > 50 && (facts.features.check || facts.features.capture || facts.features.promotion)) {
    events.push('strong');
  }

  return events;
}

/**
 * A player move that gains at least ~3.2 pawns against the bot's own reading of
 * the position is "brilliant" for dialogue purposes. Below that it is just a
 * good move and the character stays quiet.
 */
export function playerMoveEvents(playerGainCp: number): DialogueEvent[] {
  return playerGainCp >= 320 ? ['brilliant'] : [];
}

/** The closing line, from the bot's point of view. */
export function endingEvent(result: PlayResult, playerColor: PlayColor): DialogueEvent {
  if (result === '1/2-1/2') return 'draw';
  const whiteWon = result === '1-0';
  const playerWon = playerColor === 'w' ? whiteWon : !whiteWon;
  return playerWon ? 'loss' : 'win';
}
