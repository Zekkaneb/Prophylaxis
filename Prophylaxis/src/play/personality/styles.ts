/**
 * Personality tendency profiles.
 *
 * These are *inputs to move selection*, not decoration: every field is read by
 * `choosePersonalityMove` when it scores the engine's candidate moves, and the
 * opening bias is read when a repertoire position offers more than one move.
 *
 * The numbers are calibrated so that the profiles separate the four characters
 * on the same position while staying inside the range where an engine's own
 * evaluation still dominates. Accuracy is the exception: it is derived from the
 * target rating, never set by hand, because accuracy is the Elo dial.
 */

export type PersonalityId =
  | 'freshman'
  | 'sophomore'
  | 'junior'
  | 'senior'
  | 'brandon'
  | 'nina'
  | 'nina-freshman'
  | 'bryan'
  | 'bryan-sophomore'
  | 'bryan-prime'
  | 'faadi'
  | 'edward'
  | 'brandon-freshman'
  | 'mabinti'
  | 'emmanuel'
  | 'bryan-widjaja'
  | 'alex-tang'
  | 'erik-wiessmann'
  | 'jonah-pachikara'
  | 'sophia-kuan'
  | 'brandon-varsity';

export type OpeningTag = 'solid' | 'sharp' | 'positional' | 'developing' | 'initiative';

export interface PersonalityStyle {
  id: PersonalityId;
  /** Tendency values are 0–100. */
  aggression: number;
  risk: number;
  positional: number;
  tactical: number;
  defensive: number;
  initiative: number;
  simplification: number;
  complexity: number;
  kingSafety: number;
  material: number;
  sacrifice: number;
  activePieces: number;
  /** How strongly raw engine evaluation outranks taste. Set from Elo. */
  accuracy: number;
  /**
   * Optional search ceiling for a character who genuinely calculates less.
   *
   * Most profiles leave this unset and search at `depthForElo`, because the
   * rating's mistake curve is the strength dial. A beginner whose whole idea of
   * a calculation is "two moves ahead" can also see less of the board: this is
   * that ceiling, and it is deliberately a per-character property so no other
   * opponent's search changes.
   */
  depthCap?: number;
  /**
   * Optional per-character chance of the deliberate slip, replacing the rating's
   * own curve (`blunderChance(elo)`).
   *
   * The curve bottoms out at 45% for anything rated 800 or below, which is why a
   * character who genuinely cannot play needs to say so here: unset means "use
   * the rating's curve", so no other opponent's mistake rate moves.
   */
  mistakeChance?: number;
  /** Opening tags this character gravitates to (and away from). */
  openingBias: Partial<Record<OpeningTag, number>>;
}

const BASE = {
  sacrifice: 0,
  activePieces: 0,
  accuracy: 1,
} satisfies Pick<PersonalityStyle, 'sacrifice' | 'activePieces' | 'accuracy'>;

export const PERSONALITY_STYLES: Record<PersonalityId, PersonalityStyle> = {
  freshman: {
    ...BASE,
    id: 'freshman',
    aggression: 25,
    risk: 20,
    positional: 60,
    tactical: 45,
    defensive: 85,
    initiative: 30,
    simplification: 75,
    complexity: 20,
    kingSafety: 85,
    material: 85,
    sacrifice: 15,
    activePieces: 45,
    openingBias: { solid: 26, developing: 18, positional: 10, sharp: -22, initiative: -12 },
  },
  sophomore: {
    ...BASE,
    id: 'sophomore',
    aggression: 45,
    risk: 45,
    positional: 75,
    tactical: 65,
    defensive: 70,
    initiative: 70,
    simplification: 50,
    complexity: 55,
    kingSafety: 75,
    material: 65,
    sacrifice: 35,
    activePieces: 72,
    openingBias: { initiative: 22, positional: 14, solid: 6, sharp: 4, developing: 6 },
  },
  junior: {
    ...BASE,
    id: 'junior',
    aggression: 30,
    risk: 25,
    positional: 95,
    tactical: 75,
    defensive: 95,
    initiative: 50,
    simplification: 80,
    complexity: 35,
    kingSafety: 95,
    material: 90,
    sacrifice: 18,
    activePieces: 55,
    openingBias: { positional: 26, solid: 16, developing: 8, sharp: -18, initiative: -4 },
  },
  senior: {
    ...BASE,
    id: 'senior',
    aggression: 85,
    risk: 85,
    positional: 55,
    tactical: 95,
    defensive: 45,
    initiative: 90,
    simplification: 30,
    complexity: 90,
    kingSafety: 55,
    material: 45,
    sacrifice: 85,
    activePieces: 85,
    openingBias: { sharp: 26, initiative: 18, developing: 6, solid: -14, positional: -4 },
  },
  brandon: {
    ...BASE,
    id: 'brandon',
    aggression: 95,
    risk: 90,
    positional: 55,
    tactical: 98,
    defensive: 65,
    initiative: 98,
    simplification: 20,
    complexity: 100,
    kingSafety: 60,
    material: 25,
    sacrifice: 95,
    activePieces: 90,
    openingBias: { sharp: 30, initiative: 22, developing: 4, solid: -18, positional: -6 },
  },
  bryan: {
    ...BASE,
    id: 'bryan',
    /* The balanced one: no single number leads. Tactical and positional sit at
       45 on purpose — his taste leans on neither, which is how weaker
       calculation and weaker planning show up: as inconsistency, not absence. */
    aggression: 55,
    risk: 50,
    positional: 45,
    tactical: 45,
    defensive: 55,
    initiative: 55,
    simplification: 50,
    complexity: 45,
    kingSafety: 60,
    material: 55,
    sacrifice: 40,
    activePieces: 60,
    openingBias: { developing: 10, initiative: 6, solid: 6, positional: 4, sharp: 0 },
  },
  /* The earlier Bryan, and the only one built around one idea: defence.
     King safety, material and defensive awareness sit at the top of the table
     while tactics sit far below them, so on near-equal candidates he keeps the
     king home, holds the material and takes the safe square. The weakness is
     taste plus a 1350 accuracy dial, not a random blunder or a shallow search:
     he still sees the board, he just does not look for his own tactics. */
  'bryan-sophomore': {
    ...BASE,
    id: 'bryan-sophomore',
    aggression: 35,
    risk: 30,
    positional: 50,
    tactical: 30,
    defensive: 95,
    initiative: 35,
    simplification: 75,
    complexity: 25,
    kingSafety: 95,
    material: 90,
    sacrifice: 10,
    activePieces: 35,
    openingBias: { solid: 18, positional: 10, developing: 8, sharp: -16, initiative: -12 },
  },
  /* The same character, rated 200 points higher. Nothing here is emphasised:
     every primary tendency sits at the neutral midpoint, so his move choice is
     decided by the evaluation and his rating rather than by a taste for
     tactics, quiet positions, trades or complications. That is what makes him
     the polished Bryan instead of a second, differently flavoured one. */
  'bryan-prime': {
    ...BASE,
    id: 'bryan-prime',
    aggression: 50,
    risk: 50,
    positional: 50,
    tactical: 50,
    defensive: 50,
    initiative: 50,
    simplification: 50,
    complexity: 50,
    kingSafety: 50,
    material: 50,
    sacrifice: 40,
    activePieces: 50,
    openingBias: { solid: 8, developing: 8, positional: 8, initiative: 8, sharp: 8 },
  },
  /* Nina at fifteen: the same sociable, balanced player before any of it has
     sharpened. Every dial sits below her Sophomore profile — nothing is a
     speciality here, least of all defence or attack — so she plays natural,
     slightly cautious chess and misses what a 1550 sees. */
  'nina-freshman': {
    ...BASE,
    id: 'nina-freshman',
    aggression: 35,
    risk: 30,
    positional: 40,
    tactical: 40,
    defensive: 45,
    initiative: 35,
    simplification: 55,
    complexity: 35,
    kingSafety: 60,
    material: 65,
    sacrifice: 30,
    activePieces: 40,
    openingBias: { solid: 10, developing: 8, positional: 4, sharp: -6, initiative: -8 },
  },
  nina: {
    ...BASE,
    id: 'nina',
    aggression: 80,
    risk: 45,
    positional: 80,
    tactical: 90,
    defensive: 80,
    initiative: 95,
    simplification: 70,
    complexity: 45,
    kingSafety: 90,
    material: 80,
    sacrifice: 45,
    activePieces: 88,
    openingBias: { initiative: 26, positional: 16, developing: 10, sharp: 8, solid: 8 },
  },
  /* Faadi Granillo Garcia: the wildcard. High complexity and risk with low
     positional patience and loose material, so the same profile produces an
     attacking move in one position and a passive one in another instead of a
     fixed pattern. Tactical awareness sits low but not at zero: he sees the
     obvious capture, not the long tactic. */
  faadi: {
    ...BASE,
    id: 'faadi',
    aggression: 70,
    risk: 75,
    positional: 35,
    tactical: 45,
    defensive: 35,
    initiative: 75,
    simplification: 35,
    complexity: 85,
    kingSafety: 45,
    material: 40,
    sacrifice: 70,
    activePieces: 78,
    openingBias: { sharp: 20, initiative: 18, developing: 12, solid: -10, positional: -8 },
  },
  /* Edward Chen — the principled beginner, 800.
     Every dial is low except the ones a beginner is *taught* to care about:
     material, king safety and simplification. He wants to develop, castle and
     keep his pieces, and he is uncomfortable in complications — which, combined
     with a 800 accuracy dial and a 10-ply search ceiling, is what makes a
     natural-looking move that simply is not good. Nothing here is an attempt to
     make him play absurdly: he has a plan, it is just a small one. */
  edward: {
    ...BASE,
    id: 'edward',
    aggression: 25,
    risk: 20,
    positional: 30,
    tactical: 20,
    defensive: 45,
    initiative: 25,
    simplification: 65,
    complexity: 20,
    kingSafety: 65,
    material: 75,
    sacrifice: 10,
    activePieces: 40,
    depthCap: 10,
    openingBias: { solid: 22, developing: 20, positional: 8, sharp: -20, initiative: -14 },
  },
  /* Mabinti Mansaray (Junior), 1550 — the enthusiast.

     Balanced and principled: no dial is a speciality and none is a weakness.
     Positional understanding, defence, king safety and material care all sit
     above the midpoint, aggression and risk just below it, and complexity sits
     at 45 because she would rather keep the position clean than sharp. She
     takes an initiative when one is there (initiative 50) without forcing it.
     Her strength is not here: accuracy comes from the 1550 rating like every
     other profile, so she neither underestimates tactics nor plays above the
     rating she is advertised at. */
  mabinti: {
    ...BASE,
    id: 'mabinti',
    aggression: 50,
    risk: 45,
    positional: 70,
    tactical: 65,
    defensive: 65,
    initiative: 50,
    simplification: 55,
    complexity: 45,
    kingSafety: 75,
    material: 65,
    /* She will give material for something she has counted, never as a habit. */
    sacrifice: 35,
    activePieces: 65,
    openingBias: { positional: 18, solid: 16, developing: 12, initiative: 8, sharp: -8 },
  },
  /* Emmanuel Domah (Senior), 400 — the Reluctant Player.

     The weakest profile in the roster, and honest about why. Nothing here is a
     speciality: positional and tactical awareness are both 15, king safety 35
     because he does not look at his own king, material 45 because he takes a
     piece when it is obviously there and forgets the rest. Three things make
     him weak, and all of them are strength dials rather than flavour:
     `depthCap: 6` (he sees a couple of moves and not the reply), an accuracy at
     the floor of the rating scale (so evaluation barely outranks whatever looks
     natural to him), and `mistakeChance: 0.55` — the highest deliberate-slip
     rate the shared mistake pool is designed to allow, where the 800-rated
     beginner sits at 0.45. His slips are still engine-priced moves capped by
     the beginner severity, never random legal moves.

     He has no opening bias because he has no opening book: `openingBias` is
     empty on purpose, and every first move comes from the same search-and-slip
     path as move forty. */
  emmanuel: {
    ...BASE,
    id: 'emmanuel',
    aggression: 40,
    risk: 35,
    positional: 15,
    tactical: 15,
    defensive: 30,
    initiative: 30,
    simplification: 40,
    complexity: 30,
    kingSafety: 35,
    material: 45,
    sacrifice: 15,
    activePieces: 25,
    depthCap: 6,
    mistakeChance: 0.55,
    openingBias: {},
  },
  /* Brandon Tran before Prime, 1600: the same funky attacker with less behind
     it. Ambition stays near Prime's ceiling (initiative 95, complexity 95, a
     sacrifice lust of 80) while positional care, defence, king safety and
     material sit lower than any other strong profile — he would rather have an
     attack than a sound one.

     Tactical *ambition* is the `tactical` number below: how often he looks for
     a shot. Tactical *accuracy* is not here at all — it is `accuracyForElo`,
     which gives a 1600 far less trust in the engine's evaluation than Prime's
     2350 gets. That is the distinction between the two Brandons: he sees the
     same kinds of ideas, he judges them worse. */
  'brandon-freshman': {
    ...BASE,
    id: 'brandon-freshman',
    aggression: 90,
    risk: 85,
    positional: 40,
    tactical: 75,
    defensive: 35,
    initiative: 95,
    simplification: 20,
    complexity: 95,
    kingSafety: 45,
    material: 30,
    sacrifice: 80,
    activePieces: 85,
    openingBias: { sharp: 28, initiative: 24, developing: 8, solid: -16, positional: -8 },
  },
  /* Bryan Widjaja (Prime), 1400 — the Wall.

     The strongest defensive profile on the roster, and deliberately not the
     strongest player. Defence, king safety and material sit at the top of the
     table (98/98/90), positional understanding above the midpoint (75),
     aggression, risk and complexity at the bottom (30/20/25), and tactical
     awareness at 35 — well below what a 1400 usually gets from this table.

     That last number is the distinction the character is built on: `tactical`
     is how often he *looks* for a shot, and it is low. His defensive numbers
     only reorder near-equal candidates — the engine's evaluation, the 1400
     candidate gap and the rating's own slip curve still decide how strong he
     is. Nothing here can make him calculate like a 2000; what it does is make
     him very hard to break down with a straightforward attack. `accuracy` is
     left to `accuracyForElo(1400)`, exactly like every other profile. */
  'bryan-widjaja': {
    ...BASE,
    id: 'bryan-widjaja',
    aggression: 30,
    risk: 20,
    positional: 75,
    tactical: 35,
    defensive: 98,
    initiative: 40,
    simplification: 80,
    complexity: 25,
    kingSafety: 98,
    material: 90,
    /* He will give a pawn for a concrete defensive resource, never a piece on
       speculation. */
    sacrifice: 10,
    activePieces: 55,
    openingBias: { solid: 26, positional: 20, developing: 14, sharp: -24, initiative: -14 },
  },
  /* Alex Tang (Sophomore), 1100 — the energetic goofball.

     A straightforward beginner's table: develop, fight for the centre, castle,
     keep the pieces, avoid a mess. Nothing is maxed out and nothing is a
     speciality; positional and tactical understanding both sit below the
     midpoint because he is still learning them, while simplification (60) and
     material care (70) are what he has actually been taught.

     The personality lives in the dialogue, not here: `risk` stays at 30 and
     `complexity` at 30, so his humour can never turn into chaotic moves.
     `accuracy` is left to `accuracyForElo(1100)` and there is no `depthCap` or
     `mistakeChance`, exactly like the other rating-driven profiles. */
  'alex-tang': {
    ...BASE,
    id: 'alex-tang',
    aggression: 35,
    risk: 30,
    positional: 45,
    tactical: 40,
    defensive: 50,
    initiative: 40,
    simplification: 60,
    complexity: 30,
    kingSafety: 65,
    material: 70,
    /* A beginner will give a pawn for an idea, never a piece on speculation. */
    sacrifice: 15,
    activePieces: 50,
    openingBias: { developing: 20, solid: 16, positional: 10, sharp: -18, initiative: -10 },
  },
  /* Erik Wiessmann (Teacher), 1100 — the chill logician.

     The most principled table on the roster: positional 75, king safety 75 and
     material 75 all point at sound, purposeful moves, while risk 25, complexity
     25 and aggression 35 keep him away from speculative play. Nothing here is
     strength: `accuracy` still comes from `accuracyForElo(1100)`, there is no
     search cap and no custom slip rate, so his logic is a preference among
     near-equal candidates rather than better calculation. */
  'erik-wiessmann': {
    ...BASE,
    id: 'erik-wiessmann',
    aggression: 35,
    risk: 25,
    positional: 75,
    tactical: 45,
    defensive: 65,
    initiative: 40,
    simplification: 65,
    complexity: 25,
    kingSafety: 75,
    material: 75,
    /* A principled player gives material only for something concrete. */
    sacrifice: 10,
    activePieces: 55,
    openingBias: { developing: 20, solid: 18, positional: 14, sharp: -22, initiative: -12 },
  },
  /* Jonah Pachikara, 1400 — the silent threat.

     Positional 90 and tactical 85 together are the whole character: he builds
     with quiet, improving moves, and the same profile makes him notice the
     tactics that appear once the pieces are placed. Defence 75 and king safety
     80 keep the pressure sound, simplification stays at 60 and sacrifice at 20,
     so he is not a speculative attacker. `accuracy` is still
     `accuracyForElo(1400)`: tactical ambition is how often he looks, never how
     well he calculates. */
  'jonah-pachikara': {
    ...BASE,
    id: 'jonah-pachikara',
    aggression: 55,
    risk: 40,
    positional: 90,
    tactical: 85,
    defensive: 75,
    initiative: 55,
    simplification: 60,
    complexity: 55,
    kingSafety: 80,
    material: 70,
    /* He will give a pawn for a concrete initiative, not a piece on a hunch. */
    sacrifice: 20,
    activePieces: 65,
    openingBias: { positional: 24, developing: 16, solid: 10, initiative: 6, sharp: 4 },
  },
  /* Sophia Kuan, 1300 — the gentle defender.

     Simplification 95 is the signature: the trade term in
     `choosePersonalityMove` weighs heavily, so among near-equal moves she takes
     the one that reduces the position. Defence 85, king safety 90, material 90,
     aggression 20 and risk 15 keep her safe and unhurried, and complexity 10
     turns her away from sharpening. Nothing here outvotes the engine's own
     evaluation, so a trade that loses material or a tactic that wins is still
     found (or missed) at `accuracyForElo(1300)`. */
  'sophia-kuan': {
    ...BASE,
    id: 'sophia-kuan',
    aggression: 20,
    risk: 15,
    positional: 55,
    tactical: 35,
    defensive: 85,
    initiative: 20,
    simplification: 95,
    complexity: 10,
    kingSafety: 90,
    material: 90,
    /* She gives material only when the tactic is concrete. */
    sacrifice: 8,
    activePieces: 40,
    openingBias: { solid: 24, positional: 12, developing: 10, sharp: -26, initiative: -16 },
  },
  /* Brandon Tran (Sophomore), 1850 — the funky attacker, between Freshman and
     Prime.

     He keeps Brandon's aggression (90) and initiative (90) and his taste for
     complexity (85), but he is more developed than Freshman: positional 65 instead
     of 40, tactical 85 instead of 75, defence 45 instead of 35, and a little more
     patience with material (40 instead of 30). He is not Prime: 95 aggression,
     98 tactical and 100 complexity stay his alone, and his sacrifice appetite
     (88) sits between Freshman's 80 and Prime's 95. `accuracy` is still set from
     the rating by `styleFor`, so the extra chess strength is real development,
     not a curve override. */
  'brandon-varsity': {
    ...BASE,
    id: 'brandon-varsity',
    aggression: 90,
    risk: 80,
    positional: 65,
    tactical: 85,
    defensive: 45,
    initiative: 90,
    simplification: 30,
    complexity: 85,
    kingSafety: 55,
    material: 40,
    sacrifice: 88,
    activePieces: 88,
    openingBias: { sharp: 27, initiative: 21, developing: 6, solid: -17, positional: -7 },
  },
};

/**
 * Accuracy is a function of strength, not character: a tactical 2250 still
 * trusts the engine less than a positional 2150.
 */
const ACCURACY_BY_ELO: Array<[number, number]> = [
  [1300, 0.85],
  [1500, 1.05],
  [1800, 1.45],
  [2050, 1.7],
  [2200, 2.05],
  [2325, 2.35],
];

export function accuracyForElo(elo: number): number {
  for (const [limit, value] of ACCURACY_BY_ELO) {
    if (elo < limit) return value;
  }
  return 2.45;
}

/** The profile with its accuracy resolved from the opponent's target rating. */
export function styleFor(id: string, elo: number): PersonalityStyle | null {
  if (!(id in PERSONALITY_STYLES)) return null;
  const style = PERSONALITY_STYLES[id as PersonalityId];
  return { ...style, accuracy: accuracyForElo(elo) };
}

export function isPersonalityId(id: string): id is PersonalityId {
  return id in PERSONALITY_STYLES;
}
