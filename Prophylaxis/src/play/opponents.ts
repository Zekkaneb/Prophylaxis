/**
 * Opponent catalogue: the Johnfer personalities, Brandon Tran, the three Bryan
 * Martinez-Hernandez strength profiles, Faadi Granillo Garcia, Edward Chen and
 * the General Bot.
 *
 * This is the single source of truth for names, target ratings, portraits and
 * playing-style copy. A future personality system (repertoires, dialogue,
 * tendencies) attaches to these ids instead of adding conditionals to the UI.
 *
 * Display follows Brandon Tran's card for every opponent: two separate fields.
 * `name` is the character ("Johnfer Quispe", "Bryan Martinez-Hernandez") and
 * `title` is the version or stage printed beneath it ("Freshman", "Prime",
 * "Junior"). No parenthetical suffix belongs in a name; `opponentFullName`
 * composes the single unambiguous string used by saved games and PGN headers.
 *
 * Portrait files live in `public/opponents/` and `OpponentAvatar` reads
 * `portraitPath`; a missing file falls back to the monogram in `initials`.
 */

export type OpponentKind = 'personality' | 'general';

/**
 * Ladder groups shown as headed sections in the Play setup screen, from the
 * friendliest option to the top of the ladder.
 *
 * Membership is explicit: an opponent's group is a field on its profile, not a
 * function of its rating. Senior and Bryan (Prime) both sit at 2000 and belong
 * to different groups on purpose.
 */
export type OpponentCategory =
  | 'beginner'
  | 'novice'
  | 'intermediate'
  | 'varsity'
  | 'big-4';

export interface OpponentCategoryGroup {
  id: OpponentCategory;
  label: string;
  hint: string;
}

export const OPPONENT_CATEGORIES: readonly OpponentCategoryGroup[] = [
  /* Bands of the ladder, from the first game that can be won without knowing an
     opening to the featured four. Each band is its own headed section in the
     Play screen, and the cards inside it read in the order listed here. */
  { id: 'beginner', label: 'Beginner', hint: '100–1000 Elo' },
  { id: 'novice', label: 'Novice', hint: '1001–1300 Elo' },
  { id: 'intermediate', label: 'Intermediate', hint: '1301–1600 Elo' },
  { id: 'varsity', label: 'Varsity', hint: '1601–2000 Elo' },
  { id: 'big-4', label: 'The Big 4', hint: 'Special designation' },
] as const;

export interface OpponentProfile {
  id: string;
  kind: OpponentKind;
  /** Ladder group used by the Play screen's headed sections. */
  category: OpponentCategory;
  /** Authoritative display name. */
  name: string;
  /** Short label for compact rows. */
  shortName: string;
  /** Stage/level label, printed below the name only when it adds information. */
  title?: string;
  /** Target rating. For the General Bot this is the default; the UI can override it. */
  elo: number;
  /** One or two sentences describing how the opponent plays. */
  style: string;
  /** Public path relative to `public/`; `null` = no portrait intended. */
  portraitPath: string | null;
  /**
   * Optical zoom applied to the portrait inside its square frame. Omit for the
   * default head-and-shoulders crop (1.2); a portrait already framed tight in
   * the source file uses 1 so the face is not cropped twice.
   */
  portraitScale?: number;
  /** Fallback monogram when the portrait is missing. */
  initials: string;
  /**
   * Legacy flag from when the General Bot followed the player's imported
   * courses. Live play never loads them: every bot opens from its own book, so
   * no opponent sets this to true any more.
   */
  usesRepertoire: boolean;
}

export const PLAYER_NAME = 'Johnfer Quispe';

/*
 * Order inside a group is the display order. Group order comes from
 * `OPPONENT_CATEGORIES`, so the ladder reads Beginner → Novice → Intermediate →
 * Varsity → The Big 4 however this array is arranged.
 *
 * `bryan` is the original Bryan profile (now "Junior") and keeps its id so saved
 * games and PGNs still resolve; `bryan-prime` and `bryan-sophomore` are the
 * stronger and earlier profiles, each with its own id so all three can appear in
 * one match and stay distinguishable in one history list.
 */
export const PERSONALITY_OPPONENTS: readonly OpponentProfile[] = [
  /* Emmanuel Domah (Senior), 400 — the Reluctant Player.

     The first card of the Beginner band: he is not a beginner who studies, he
     is someone who turned up. `emmanuel` is his own id, so a saved game can
     never resolve him to Edward Chen, the other "Senior". No repertoire at all:
     `PERSONALITY_REPERTOIRES` deliberately has no entry for him. */
  {
    id: 'emmanuel',
    kind: 'personality',
    category: 'beginner',
    name: 'Emmanuel Domah',
    shortName: 'Emmanuel',
    title: 'Senior',
    elo: 150,
    style:
      'The greatest player of all time.',
    portraitPath: 'opponents/emmanuel.webp',
    /* He is the one portrait framed taller than it is wide, and it is already
       painted tight: the shared 1.2 zoom would crop the beanie and the hood. */
    portraitScale: 1,
    initials: 'ED',
    usesRepertoire: false,
  },
  /* Edward Chen (Senior), 800 — the principled beginner. His id is `edward`,
     never a re-used `senior`, so saved games and PGNs can never resolve him to
     Johnfer Quispe (Senior) — the two share the word "Senior" and nothing else. */
  {
    id: 'edward',
    kind: 'personality',
    category: 'beginner',
    name: 'Edward Chen',
    shortName: 'Edward',
    title: 'Senior',
    elo: 800,
    style:
      'Very balanced but has slight oversights',
    portraitPath: 'opponents/edward.webp',
    initials: 'EC',
    usesRepertoire: false,
  },
  /* Faadi Granillo Garcia (Prime), 700 — the wildcard: loose, instinctive and
     happy to improvise. */
  {
    id: 'faadi',
    kind: 'personality',
    category: 'beginner',
    name: 'Faadi Granillo Garcia',
    shortName: 'Faadi',
    title: 'Prime',
    elo: 700,
    style:
      'The wildcard: loose, instinctive and happy to improvise. Chaotic tactics, sudden attacks, passive moments — and a comeback he is certain is coming.',
    portraitPath: 'opponents/faadi.webp',
    /* Painted tighter than the others, so the shared zoom pushed his hair and
       chin out of the frame. At 1 the whole square shows. */
    portraitScale: 1,
    initials: 'FG',
    usesRepertoire: false,
  },
  /* Nina before she found her confidence. Same character, an earlier profile:
     the Novice band's balanced opponent, so a first game meets someone who plays
     normally rather than a dedicated attacker or defender. */
  {
    id: 'nina-freshman',
    kind: 'personality',
    category: 'novice',
    name: 'Nina Yang',
    shortName: 'Nina Frosh',
    title: 'Freshman',
    elo: 1200,
    style:
      'The developing all-rounder: balanced, a little cautious, still learning where the pieces belong. Natural moves, basic tactics, the occasional passive choice.',
    portraitPath: 'opponents/nina-freshman.webp',
    initials: 'NY',
    usesRepertoire: false,
  },
  /* Johnfer Quispe (Freshman), 1250 — the Novice band's anchor: solid, natural
     moves, with room to recover from a mistake. */
  {
    id: 'freshman',
    kind: 'personality',
    category: 'novice',
    name: 'Johnfer Quispe',
    shortName: 'Freshman',
    title: 'Freshman',
    elo: 1250,
    style: 'Solid, natural moves. Punishes loose pieces but gives you room to recover.',
    portraitPath: 'opponents/freshman.webp',
    initials: 'F',
    usesRepertoire: false,
  },
  /* Alex Tang (Sophomore), 1100 — the energetic goofball.

     A different person from the Johnfer Sophomore and from Bryan (Sophomore):
     `alex-tang` is his own id, so a saved game can never resolve him to either
     of them. The loud, funny personality lives in his dialogue only. */
  {
    id: 'alex-tang',
    kind: 'personality',
    category: 'novice',
    name: 'Alex Tang',
    shortName: 'Alex',
    title: 'Sophomore',
    elo: 1100,
    style:
      'The energetic beginner: develops naturally, takes the centre and castles when he can — straightforward, understandable chess with the occasional tactical oversight.',
    portraitPath: 'opponents/alex-tang.webp',
    /* Painted tight in the source file, like Mabinti's and Bryan Widjaja's, so
       the shared 1.2 zoom would crop him twice. */
    portraitScale: 1,
    initials: 'AT',
    usesRepertoire: false,
  },
  /* The earlier Bryan. Same name and portrait, a defend-first game — the step
     where a player has to convert an advantage against someone who does not
     hand it back. */
  {
    id: 'bryan-sophomore',
    kind: 'personality',
    category: 'intermediate',
    name: 'Bryan Martinez-Hernandez',
    shortName: 'Bryan Soph',
    title: 'Sophomore',
    elo: 1350,
    style:
      'The defender: protects his king and his material far better than he spots a tactic of his own. Hard to break down, slow to punish you.',
    portraitPath: 'opponents/bryan-sophomore.webp',
    initials: 'BM',
    usesRepertoire: false,
  },
  /* Bryan Widjaja (Prime), 1400 — the Wall.

     A different Bryan and a different player from the three
     Martinez-Hernandez profiles: defence is his speciality. He sits in
     Intermediate by category, never by rating order, and `bryan-widjaja` is his
     own stable id, so a saved game can never resolve him to any other Bryan. */
  {
    id: 'bryan-widjaja',
    kind: 'personality',
    category: 'intermediate',
    name: 'Bryan Widjaja',
    shortName: 'Bryan W',
    title: 'Prime',
    elo: 1400,
    style:
      'The Wall: exceptionally hard to break down. Protects his king and his material, defends cramped positions calmly and refuses to hand you a weakness — but he misses tactics a stronger player would see.',
    portraitPath: 'opponents/bryan-widjaja.webp',
    /* Framed tight in the source file, like Mabinti's: at 1 the whole head
       shows instead of being cropped twice. */
    portraitScale: 1,
    initials: 'BW',
    usesRepertoire: false,
  },
  /* Johnfer Quispe (Sophomore), 1450 — sharper tactics and better conversion. */
  {
    id: 'sophomore',
    kind: 'personality',
    category: 'intermediate',
    name: 'Johnfer Quispe',
    shortName: 'Sophomore',
    title: 'Sophomore',
    elo: 1450,
    style: 'Sharper tactics and better conversion. Mistakes are punished more often.',
    portraitPath: 'opponents/sophomore.webp',
    initials: 'S',
    usesRepertoire: false,
  },
  /* Nina Yang (Sophomore), 1550 — charismatic, playful and initiative-first. */
  {
    id: 'nina',
    kind: 'personality',
    category: 'intermediate',
    name: 'Nina Yang',
    shortName: 'Nina',
    title: 'Sophomore',
    elo: 1550,
    style:
      'Charismatic, playful and outgoing. Initiative-focused, tactically capable, selectively cautious.',
    portraitPath: 'opponents/nina.webp',
    /* Painted close in, like Faadi's: the shared zoom would crop her hair, so
       the whole square shows and her face reads at the same size as theirs. */
    portraitScale: 1,
    initials: 'NY',
    usesRepertoire: false,
  },
  /* Brandon before Prime: the same person and the same portrait, one rung down
     the ladder at 1600. The shared portrait is deliberate — it is the same
     player at an earlier stage — and the subtext and rating tell the two cards
     apart. */
  {
    id: 'brandon-freshman',
    kind: 'personality',
    category: 'intermediate',
    name: 'Brandon Tran',
    shortName: 'Brandon Frosh',
    title: 'Freshman',
    elo: 1600,
    style:
      'The funky attacker: same ideas as Prime, less behind them. Checks, sacrifices and strange attacking moves, and not always the calculation to back it up.',
    portraitPath: 'opponents/brandon-freshman.webp',
    initials: 'BT',
    usesRepertoire: false,
  },
  /* Bryan Martinez-Hernandez (Junior), 1800 — the balanced all-rounder with
     intuitive decision-making. `bryan` is the original Bryan profile and keeps
     its id so saved games and PGNs still resolve. */
  {
    id: 'bryan',
    kind: 'personality',
    category: 'varsity',
    name: 'Bryan Martinez-Hernandez',
    shortName: 'Bryan Jr',
    title: 'Junior',
    elo: 1800,
    style:
      'Balanced all-rounder with intuitive decision-making. Reasonable in every phase, occasionally short on calculation or a long-term plan.',
    portraitPath: 'opponents/bryan-junior.webp',
    initials: 'BM',
    usesRepertoire: false,
  },
  /* Johnfer Quispe (Senior), 2000 — aggressive, dynamic and tactically
     ambitious. A different group from Bryan (Prime) at the same rating on
     purpose. */
  {
    id: 'senior',
    kind: 'personality',
    category: 'varsity',
    name: 'Johnfer Quispe',
    shortName: 'Senior',
    title: 'Senior',
    elo: 2000,
    style: 'Aggressive, dynamic and tactically ambitious. Comfortable in complex positions, with the calculation to back it up.',
    portraitPath: 'opponents/senior.webp',
    initials: 'S',
    usesRepertoire: false,
  },
  /* The Big 4, strongest first. Membership is a special designation, never a
     rating band: Mabinti's 1550 sits here by invitation, not by Elo. */
  {
    id: 'brandon',
    kind: 'personality',
    category: 'big-4',
    name: 'Brandon Tran',
    shortName: 'Brandon',
    title: 'Prime',
    elo: 2350,
    style: 'Aggressive, tactical, charismatic. Seeks complications, sacrifices and the initiative.',
    portraitPath: 'opponents/brandon.webp',
    initials: 'BT',
    usesRepertoire: false,
  },
  /* Johnfer Quispe (Junior), 2150. */
  {
    id: 'junior',
    kind: 'personality',
    category: 'big-4',
    name: 'Johnfer Quispe',
    shortName: 'Junior',
    title: 'Junior',
    elo: 2150,
    style: 'Deep, punishing calculation with very few concessions in the middlegame.',
    portraitPath: 'opponents/junior.webp',
    initials: 'J',
    usesRepertoire: false,
  },
  /* Bryan Martinez-Hernandez (Prime), 2000 — the polished Bryan. */
  {
    id: 'bryan-prime',
    kind: 'personality',
    category: 'big-4',
    name: 'Bryan Martinez-Hernandez',
    shortName: 'Bryan Prime',
    title: 'Prime',
    elo: 2000,
    style:
      'The polished Bryan: same relaxed feel at the board, far steadier calculation and a clearer eye for the long-term plan.',
    portraitPath: 'opponents/bryan-prime.webp',
    initials: 'BM',
    usesRepertoire: false,
  },
  /* Mabinti Mansaray (Junior), 1550 — the featured four's fourth card, by
     designation rather than by rating. */
  {
    id: 'mabinti',
    kind: 'personality',
    category: 'big-4',
    name: 'Mabinti Mansaray',
    shortName: 'Mabinti',
    title: 'Junior',
    elo: 1550,
    style:
      'The enthusiast: balanced, principled chess — sound development, a solid centre and sensible defence, with an initiative when one appears and no taste for unnecessary complications.',
    portraitPath: 'opponents/mabinti.webp',
    /* The portrait is painted close in the source file, so the shared 1.2 zoom
       would crop her braids twice. */
    portraitScale: 1,
    initials: 'MM',
    usesRepertoire: false,
  },
  /* Erik Wiessmann (Teacher), 1100 — the chill logician.

     The computer science teacher, and the roster's most principled card: sound
     development, central control, no speculation. `erik-wiessmann` is his own
     id, so a saved game can never resolve him to another 1100. */
  {
    id: 'erik-wiessmann',
    kind: 'personality',
    category: 'novice',
    name: 'Erik Wiessmann',
    shortName: 'Erik',
    title: 'Teacher',
    elo: 1100,
    style:
      'The chill logician: plays the principled move — develop, take the centre, castle, keep the pieces — and explains it only when the position is interesting.',
    portraitPath: 'opponents/erik-wiessmann.webp',
    /* Framed tight in the source file: the whole head shows at 1. */
    portraitScale: 1,
    initials: 'EW',
    usesRepertoire: false,
  },
  /* Jonah Pachikara, 1400 — the silent threat.

     No subtext has been specified for him, so the card follows the project's
     convention for an unspecified stage: no `title`, and a `shortName` that is
     already part of the name, which makes `opponentStage` return null instead
     of inventing a school-year label. His full stored label is therefore just
     "Jonah Pachikara". */
  {
    id: 'jonah-pachikara',
    kind: 'personality',
    category: 'intermediate',
    name: 'Jonah Pachikara',
    shortName: 'Jonah',
    elo: 1400,
    style:
      'The silent threat: quiet, improving positional moves that hide real tactical intent. Presses patiently, then strikes when the position allows it.',
    portraitPath: 'opponents/jonah-pachikara.webp',
    /* Framed tight in the source file: the whole head shows at 1. */
    portraitScale: 1,
    initials: 'JP',
    usesRepertoire: false,
  },
  /* Sophia Kuan, 1300 — the gentle defender. */
  {
    id: 'sophia-kuan',
    kind: 'personality',
    category: 'novice',
    name: 'Sophia Kuan',
    shortName: 'Sophia',
    title: 'Senior',
    elo: 1300,
    style:
      'The gentle defender: cautious, kind and happiest in a simple position. Trades into safety, protects her king and avoids unnecessary complications.',
    portraitPath: 'opponents/sophia-kuan.webp',
    /* Framed tight in the source file: the whole head shows at 1. */
    portraitScale: 1,
    initials: 'SK',
    usesRepertoire: false,
  },
  /* Brandon Tran (Sophomore), 1850 — the funky attacker, between Freshman and
     Prime. Same name and voice as the other two, its own id, rating and
     category, and its own portrait file. */
  {
    id: 'brandon-varsity',
    kind: 'personality',
    category: 'varsity',
    name: 'Brandon Tran',
    shortName: 'Brandon Sophomore',
    title: 'Sophomore',
    elo: 1850,
    style:
      'The funky attacker: sharp Vienna gambits, French counterattacks and a taste for complications, with more calculation than the Freshman and more patience with material than the Prime.',
    portraitPath: 'opponents/brandon-varsity.webp',
    /* Framed tight in the source file: the whole head shows at 1. */
    portraitScale: 1,
    initials: 'BT',
    usesRepertoire: false,
  },
] as const;

export const GENERAL_BOT: OpponentProfile = {
  id: 'general',
  kind: 'general',
  /* Not part of the ladder: the general bot has its own strength slider below
     the personality grid, so this group is only used when nothing else fits. */
  category: 'intermediate',
  name: 'General Bot',
  shortName: 'General',
  elo: 1500,
  style:
    'Ordinary engine chess, with a short standard opening book at beginner ratings.',
  portraitPath: null,
  initials: 'GB',
  usesRepertoire: false,
};

export const ALL_OPPONENTS: readonly OpponentProfile[] = [
  ...PERSONALITY_OPPONENTS,
  GENERAL_BOT,
];

export const GENERAL_BOT_ELO = { min: 100, max: 2800, step: 50 } as const;

export function getOpponent(id: string): OpponentProfile | undefined {
  return ALL_OPPONENTS.find((opponent) => opponent.id === id);
}

/**
 * The subtext printed beneath the name: the version, grade or tier.
 *
 * Returns null only if a future profile's name already contains its stage, so
 * the card can never print the same word twice.
 */
export function opponentStage(opponent: OpponentProfile): string | null {
  const stage = opponent.title ?? opponent.shortName;
  if (!stage) return null;
  return opponent.name.toLowerCase().includes(stage.toLowerCase()) ? null : stage;
}

/**
 * Full label for stored games and PGN headers.
 *
 * One unambiguous string per opponent, because several personalities share a
 * surname. A name that already carries its stage ("Johnfer Quispe (Junior)") is
 * used as it stands rather than gaining a second parenthetical.
 */
export function opponentFullName(opponent: OpponentProfile): string {
  const stage = opponentStage(opponent);
  return stage ? `${opponent.name} (${stage})` : opponent.name;
}

/**
 * Secondary line for nameplates and cards: "Prime · 2350 Elo", or just the
 * rating when the name already says the stage.
 */
export function opponentMeta(opponent: OpponentProfile): string {
  const stage = opponentStage(opponent);
  return stage ? `${stage} · ${opponent.elo} Elo` : `${opponent.elo} Elo`;
}

/**
 * Profile for a stored game or an unfinished session.
 *
 * Uses the live catalogue when the opponent still exists (so a re-portrait or a
 * style edit reaches old games too) and otherwise rebuilds a minimal profile
 * from the saved fields instead of dropping the row.
 */
export function profileFromRecord(input: {
  opponent_id: string;
  opponent_name: string;
  opponent_elo: number;
  opponent_kind: OpponentKind;
}): OpponentProfile {
  const known = getOpponent(input.opponent_id);
  if (known) return known;

  const elo = input.opponent_elo;
  return {
    id: input.opponent_id,
    kind: input.opponent_kind,
    /* A dropped catalogue entry has no group of its own; park it on the ladder
       band its rating belongs to. */
    category:
      elo <= 1000
        ? 'beginner'
        : elo <= 1300
          ? 'novice'
          : elo <= 1600
            ? 'intermediate'
            : elo <= 2000
              ? 'varsity'
              : 'big-4',
    name: input.opponent_name,
    shortName: input.opponent_name,
    elo: input.opponent_elo,
    style: '',
    portraitPath: null,
    initials: input.opponent_name.slice(0, 2).toUpperCase(),
    usesRepertoire: false,
  };
}

/** Returns a copy with a different target rating (General Bot uses this). */
export function withElo(opponent: OpponentProfile, elo: number): OpponentProfile {
  const clamped = Math.min(
    GENERAL_BOT_ELO.max,
    Math.max(GENERAL_BOT_ELO.min, Math.round(elo)),
  );
  return { ...opponent, elo: clamped };
}
