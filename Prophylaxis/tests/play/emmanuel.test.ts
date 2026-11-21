/**
 * Emmanuel Domah (Senior) — the Reluctant Player, 400.
 *
 * Covers his catalogue entry and card identity, the Easy group, the strength
 * dials that make him genuinely weak (shallow search ceiling, lowest accuracy,
 * highest deliberate-slip rate), the absence of any opening book, legal play,
 * realistic beginner errors, his voice and cadence, Normal Play and Bot vs. Bot,
 * saved-game/PGN identity, and the regressions that keep every other opponent
 * and the shared strength curve unchanged.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { Chess } from 'chess.js';
import {
  ALL_OPPONENTS,
  GENERAL_BOT,
  OPPONENT_CATEGORIES,
  PERSONALITY_OPPONENTS,
  getOpponent,
  opponentFullName,
  opponentMeta,
  opponentStage,
  profileFromRecord,
} from '../../src/play/opponents.ts';
import {
  DIALOGUE_BANKS,
  DIALOGUE_TIMING,
  createDialogueState,
  maybeReact,
} from '../../src/play/personality/dialogue.ts';
import {
  PERSONALITY_STYLES,
  accuracyForElo,
  styleFor,
  type PersonalityStyle,
} from '../../src/play/personality/styles.ts';
import {
  PERSONALITY_REPERTOIRES,
  isRepertoireId,
  personalityBookFor,
  personalityBooks,
  repertoireIssues,
} from '../../src/play/personality/repertoires/index.ts';
import { legalBookMoves } from '../../src/play/personality/repertoires/book.ts';
import { chooseBotMove } from '../../src/play/personality/chooseMove.ts';
import {
  candidateGapForElo,
  choosePersonalityMove,
} from '../../src/play/personality/engine.ts';
import { computeThinkingPlan } from '../../src/play/personality/thinking.ts';
import { shouldTakeBlunder } from '../../src/play/personality/opening.ts';
import { chooseBlunder, blunderChance, depthForElo } from '../../src/play/strength.ts';
import { buildPgn } from '../../src/play/pgn.ts';
import type { StockfishController } from '../../src/engine/useStockfish.ts';

const EMMANUEL = getOpponent('emmanuel');
const STYLE = styleFor('emmanuel', 400) as PersonalityStyle;

function position(...san: string[]): Chess {
  const game = new Chess();
  for (const move of san) game.move(move);
  return game;
}

function assertLegal(fen: string, uci: string) {
  const game = new Chess(fen);
  game.move({
    from: uci.slice(0, 2) as never,
    to: uci.slice(2, 4) as never,
    promotion: uci.length > 4 ? uci.slice(4, 5) : undefined,
  });
}

const noEngine: StockfishController = {
  status: 'ready',
  error: null,
  evaluatePosition: () => {
    throw new Error('a book move should not search');
  },
  evaluateWithin: () => {
    throw new Error('a book move should not search');
  },
  stop: () => {},
  terminate: () => {},
};

interface StubCandidate {
  uci: string;
  scoreCp: number;
  mate?: number | null;
}

/** Engine stub that records the depth it was asked for. */
function engineWith(candidates: StubCandidate[], seen?: { depth: number; multipv: number }) {
  return {
    ...noEngine,
    evaluateWithin: async (fen: string, depth: number, multipv: number) => {
      if (seen) {
        seen.depth = depth;
        seen.multipv = multipv;
      }
      return {
        fen,
        depth,
        bestMove: candidates[0]?.uci ?? null,
        secondBestMove: candidates[1]?.uci ?? null,
        ponder: null,
        pv: candidates[0] ? [candidates[0].uci] : [],
        scoreCp: candidates[0]?.scoreCp ?? 0,
        mate: null,
        secondScoreCp: candidates[1]?.scoreCp ?? 0,
        secondMate: null,
        shallowScoreCp: candidates[0]?.scoreCp ?? 0,
        shallowMate: null,
        candidates: candidates.map((candidate, index) => ({
          rank: index + 1,
          uci: candidate.uci,
          scoreCp: candidate.scoreCp,
          mate: candidate.mate ?? null,
          pv: [candidate.uci],
        })),
      };
    },
  } as unknown as StockfishController;
}

/* ----------------------- 1-3. identity, name, rating ----------------------- */

test('Emmanuel Domah is on the roster as Senior, 400, in the Beginner band', () => {
  assert.ok(EMMANUEL);
  assert.equal(EMMANUEL.id, 'emmanuel', 'his own stable id');
  assert.equal(EMMANUEL.kind, 'personality');
  assert.equal(EMMANUEL.name, 'Emmanuel Domah');
  assert.equal(EMMANUEL.title, 'Senior', 'the subtext is exactly Senior');
  assert.equal(EMMANUEL.elo, 400);
  assert.equal(EMMANUEL.category, 'beginner');
  assert.equal(EMMANUEL.initials, 'ED');
  assert.equal(EMMANUEL.usesRepertoire, false);

  /* Two display fields, never one combined name. */
  assert.doesNotMatch(EMMANUEL.name, /\(/, 'the name carries no parenthetical suffix');
  assert.doesNotMatch(EMMANUEL.name, /senior/i, 'the subtext lives in its own field');
  assert.equal(opponentStage(EMMANUEL), 'Senior');
  assert.equal(opponentMeta(EMMANUEL), 'Senior · 400 Elo');
  assert.equal(opponentFullName(EMMANUEL), 'Emmanuel Domah (Senior)');
  assert.ok(EMMANUEL.style.length > 0);
});

test('his id is unique across the roster and cannot resolve to another Senior', () => {
  assert.equal(PERSONALITY_OPPONENTS.filter((o) => o.id === 'emmanuel').length, 1);
  assert.equal(new Set(ALL_OPPONENTS.map((o) => o.id)).size, ALL_OPPONENTS.length);
  assert.equal(getOpponent('emmanuel'), EMMANUEL, 'the catalogue entry is the same object');
  assert.equal(PERSONALITY_OPPONENTS.filter((o) => o.name === 'Emmanuel Domah').length, 1);

  /* Edward Chen is the other "Senior": the two must never merge. */
  const edward = getOpponent('edward')!;
  assert.equal(edward.title, 'Senior');
  assert.notEqual(opponentFullName(edward), opponentFullName(EMMANUEL));
  assert.notEqual(edward.id, EMMANUEL.id);
  assert.equal(EMMANUEL.elo < edward.elo, true, 'he is the weaker of the two Seniors');
});

test('his portrait is his own file, with the monogram kept as the fallback', () => {
  assert.equal(EMMANUEL.portraitPath, 'opponents/emmanuel.webp');
  assert.equal(EMMANUEL.initials, 'ED');
  assert.equal(fs.existsSync('public/opponents/emmanuel.webp'), true);
  assert.equal(EMMANUEL.portraitScale, 1, 'the source is already framed tight');
  for (const other of PERSONALITY_OPPONENTS) {
    if (other.id === 'emmanuel') continue;
    assert.notEqual(other.portraitPath, EMMANUEL.portraitPath, `${other.id} keeps its own portrait`);
  }
});

/* ----------------------- 4. Beginner band integration --------------------- */

test('Beginner is the first ladder band and holds the lowest ratings', () => {
  assert.deepEqual(
    OPPONENT_CATEGORIES.map((group) => group.label),
    ['Beginner', 'Novice', 'Intermediate', 'Varsity', 'The Big 4'],
  );
  assert.equal(OPPONENT_CATEGORIES[0].id, 'beginner');
  assert.equal(OPPONENT_CATEGORIES[0].hint, '100–1000 Elo');
  assert.ok(OPPONENT_CATEGORIES.every((group) => group.hint.length > 0));

  const declared = new Set(OPPONENT_CATEGORIES.map((group) => group.id));
  for (const opponent of PERSONALITY_OPPONENTS) {
    assert.ok(declared.has(opponent.category), `${opponent.id} sits in a real group`);
  }

  assert.deepEqual(
    PERSONALITY_OPPONENTS.filter((o) => o.category === 'beginner').map((o) => o.id),
    ['emmanuel', 'edward', 'faadi'],
  );
  /* Every band above is unchanged by the roster rearrangement. */
  assert.deepEqual(
    PERSONALITY_OPPONENTS.filter((o) => o.category === 'novice').map((o) => o.id),
    ['nina-freshman', 'freshman', 'alex-tang', 'erik-wiessmann'],
  );
  assert.deepEqual(
    PERSONALITY_OPPONENTS.filter((o) => o.category === 'intermediate').map((o) => o.id),
    ['bryan-sophomore', 'bryan-widjaja', 'sophomore', 'nina', 'brandon-freshman'],
  );
  assert.deepEqual(
    PERSONALITY_OPPONENTS.filter((o) => o.category === 'varsity').map((o) => o.id),
    ['bryan', 'senior'],
  );
  assert.equal(
    PERSONALITY_OPPONENTS.filter((o) => o.category === 'big-4').length,
    4,
    'the featured row holds exactly four',
  );

  /* Membership is a field, never a rating range. */
  const groups = new Map(PERSONALITY_OPPONENTS.map((o) => [o.id, o.category]));
  assert.equal(groups.get('edward'), 'beginner');
  assert.equal(groups.get('faadi'), 'beginner');
  assert.equal(groups.get('nina'), 'intermediate');
  assert.equal(groups.get('senior'), 'varsity');
  assert.equal(groups.get('mabinti'), 'big-4');
  assert.equal(groups.get('bryan-prime'), 'big-4');
  assert.equal(GENERAL_BOT.kind, 'general', 'the General Bot is not a ladder member');
});

/* --------------------- 5. low-strength move selection --------------------- */

test('his strength dials are the weakest in the roster', () => {
  assert.equal(STYLE.id, 'emmanuel');
  assert.equal(STYLE.accuracy, accuracyForElo(400), 'accuracy still comes from the rating');
  assert.equal(STYLE.accuracy, 0.85, 'the floor of the accuracy scale');
  assert.equal(STYLE.depthCap, 6, 'the shallowest search in the roster');
  assert.ok(STYLE.depthCap! < (PERSONALITY_STYLES.edward.depthCap ?? 16));
  assert.ok(STYLE.depthCap! < depthForElo(400), 'strictly below the shared depth');
  assert.equal(STYLE.mistakeChance, 0.55, 'highest deliberate-slip rate in the roster');
  assert.ok(STYLE.mistakeChance! > blunderChance(400), 'above the shared curve at 400');
  assert.ok(STYLE.mistakeChance! > blunderChance(800), 'above the curve where it floors');
  assert.equal(candidateGapForElo(400), 140, 'he may drift further than a 1550');

  /* No speciality pretends to be strength: he is weak everywhere. */
  assert.ok(STYLE.tactical <= 20 && STYLE.positional <= 20);
  assert.ok(STYLE.kingSafety < 50 && STYLE.activePieces < 50);
  assert.ok(STYLE.aggression < 60, 'never triggers his own attack lines');
});

test('the slip rate is his alone: the shared rating curve continues to apply', () => {
  /* Same roll, same rating, different answer — the override is per character. */
  assert.equal(shouldTakeBlunder(400, () => 0.5, false), false, '400 by the curve: 0.45');
  assert.equal(shouldTakeBlunder(400, () => 0.5, false, STYLE.mistakeChance), true);

  /* Theory never rolls, even for him. */
  assert.equal(shouldTakeBlunder(400, () => 0, true, STYLE.mistakeChance), false);

  /* Nobody else gained the dial. */
  assert.equal(PERSONALITY_STYLES.edward.mistakeChance, undefined);
  assert.equal(PERSONALITY_STYLES.faadi.mistakeChance, undefined);
  assert.equal(PERSONALITY_STYLES.mabinti.mistakeChance, undefined);
  assert.equal(blunderChance(800), 0.45);
  assert.equal(blunderChance(400), 0.45, 'the shared curve is unchanged at 400');
});

test('his search is capped at six plies, however deep the calling rating asks', async () => {
  const seen = { depth: 0, multipv: 0 };
  const played = position('e4', 'e5');
  await chooseBotMove({
    game: played,
    fen: played.fen(),
    history: ['e4', 'e5'],
    botColor: 'w',
    style: STYLE,
    elo: 400,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: engineWith(
      [
        { uci: 'g1f3', scoreCp: 20 },
        { uci: 'b1c3', scoreCp: 15 },
        { uci: 'f1c4', scoreCp: 10 },
        { uci: 'd2d3', scoreCp: 0 },
        { uci: 'h2h3', scoreCp: -30 },
      ],
      seen,
    ),
    random: () => 0.99,
  });
  assert.equal(seen.depth, 6);
  assert.equal(seen.multipv, 5);
});

test('a slip replaces his good move with a visibly worse one from the same list', async () => {
  const played = position('d4', 'd5');
  const candidates: StubCandidate[] = [
    { uci: 'c2c4', scoreCp: 30 },
    { uci: 'g1f3', scoreCp: 20 },
    { uci: 'b1c3', scoreCp: 15 },
    { uci: 'a2a3', scoreCp: -60 },
    { uci: 'h2h4', scoreCp: -260 },
  ];
  const slump = await chooseBotMove({
    game: played,
    fen: played.fen(),
    history: ['d4', 'd5'],
    botColor: 'w',
    style: STYLE,
    elo: 400,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: engineWith(candidates),
    random: () => 0,
  });
  assert.ok(slump);
  assert.equal(slump.bookMove, false);
  assert.notEqual(slump.uci, 'c2c4', 'the best move is not the one he picks in a slump');
  assert.ok(slump.decision && slump.decision.gap >= 80, 'the slip costs real evaluation');
  assertLegal(played.fen(), slump.uci);
  assert.ok(
    candidates.some((candidate) => candidate.uci === slump.uci),
    'the mistake is still a move the engine listed, never a random one',
  );

  /* Same position, an ordinary turn: he keeps the good move. */
  const steady = await chooseBotMove({
    game: played,
    fen: played.fen(),
    history: ['d4', 'd5'],
    botColor: 'w',
    style: STYLE,
    elo: 400,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: engineWith(candidates),
    random: () => 0.99,
  });
  assert.ok(steady);
  assert.equal(steady.uci, 'c2c4');
  assert.ok((steady.decision?.gap ?? 999) <= candidateGapForElo(400) + 30);
});

test('a weak mover still takes something: he is not random legal moves', async () => {
  const sawMoves = new Set<string>();
  for (const roll of [0, 0.2, 0.4, 0.6, 0.8, 0.99]) {
    const played = position('e4', 'c5', 'Nf3');
    const chosen = await chooseBotMove({
      game: played,
      fen: played.fen(),
      history: ['e4', 'c5', 'Nf3'],
      botColor: 'b',
      style: STYLE,
      elo: 400,
      clockMs: null,
      incrementMs: 0,
      initialMs: 0,
      engine: engineWith([
        { uci: 'd7d6', scoreCp: -10 },
        { uci: 'b8c6', scoreCp: -18 },
        { uci: 'e7e6', scoreCp: -30 },
        { uci: 'g8f6', scoreCp: -55 },
        { uci: 'a7a6', scoreCp: -120 },
      ]),
      random: () => roll,
    });
    assert.ok(chosen);
    assertLegal(played.fen(), chosen.uci);
    sawMoves.add(chosen.uci);
  }
  assert.ok(sawMoves.size >= 3, 'the same roll does not always produce the same move');
});

/* ---------------------- 6. no opening repertoire at all ------------------- */

test('he has no repertoire: no White book, no Black answers, nothing from move one', () => {
  assert.equal(isRepertoireId('emmanuel'), false);
  assert.equal('emmanuel' in PERSONALITY_REPERTOIRES, false, 'no declared lines');
  assert.equal(
    repertoireIssues().some((entry) => entry.id === 'emmanuel'),
    false,
    'not part of the validated repertoire set',
  );

  for (const start of [
    position(),
    position('e4'),
    position('d4'),
    position('Nf3'),
    position('c4'),
  ]) {
    assert.deepEqual(
      legalBookMoves(personalityBookFor('emmanuel', 'w'), start),
      [],
      'no White book',
    );
    assert.deepEqual(
      legalBookMoves(personalityBookFor('emmanuel', 'b'), start),
      [],
      'no Black book',
    );
  }
  assert.equal(personalityBooks('emmanuel').w.book.size, 0);
  assert.equal(personalityBooks('emmanuel').b.book.size, 0);
  /* An empty opening bias is the same statement in the style table. */
  assert.deepEqual(STYLE.openingBias, {});
  assert.equal(EMMANUEL.usesRepertoire, false);
});

test('his first move comes from his own search, not from theory', async () => {
  const start = new Chess();
  const chosen = await chooseBotMove({
    game: start,
    fen: start.fen(),
    history: [],
    botColor: 'w',
    style: STYLE,
    elo: 400,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: engineWith([
      { uci: 'e2e4', scoreCp: 20 },
      { uci: 'd2d4', scoreCp: 18 },
      { uci: 'g1f3', scoreCp: 16 },
      { uci: 'c2c4', scoreCp: 12 },
      { uci: 'b2b3', scoreCp: 5 },
    ]),
    random: () => 0.99,
  });
  assert.ok(chosen);
  assert.equal(chosen.bookMove, false);
  assert.equal(chosen.forgotten, false);
  assert.equal(chosen.source, 'engine', 'never repertoire or a principle plan');
  assert.equal(chosen.plan?.reason, 'opening', 'still the opening phase, played ad hoc');
  assertLegal(start.fen(), chosen.uci);
});

/* ------------------------- 7. legal move generation ---------------------- */

test('every move he picks in a real game is legal, in both colours', async () => {
  const game = new Chess();
  const history: string[] = [];
  const roll = () => 0.3;
  for (let ply = 0; ply < 24; ply += 1) {
    if (game.isGameOver()) break;
    const botColor = game.turn();
    const candidates = game.moves({ verbose: true }).map((move, index) => ({
      uci: `${move.from}${move.to}${move.promotion ?? ''}`,
      scoreCp: 30 - index * 12,
    }));
    const chosen = await chooseBotMove({
      game,
      fen: game.fen(),
      history: [...history],
      botColor,
      style: STYLE,
      elo: 400,
      clockMs: null,
      incrementMs: 0,
      initialMs: 0,
      engine: engineWith(candidates.slice(0, 5)),
      random: roll,
    });
    assert.ok(chosen, `ply ${ply} produced a move`);
    assertLegal(game.fen(), chosen.uci);
    const applied = game.move({
      from: chosen.uci.slice(0, 2) as never,
      to: chosen.uci.slice(2, 4) as never,
      promotion: chosen.uci.length > 4 ? chosen.uci.slice(4, 5) : undefined,
    });
    history.push(applied.san);
  }
  assert.ok(history.length >= 12, 'a real game was played out legally');
});

/* ---------------------- 8. realistic beginner mistakes ------------------- */

test('his errors are cheap beginner errors, never a walk into mate', () => {
  const candidates = [
    { uci: 'e2e4', scoreCp: 20 },
    { uci: 'g1f3', scoreCp: 10 },
    { uci: 'h2h4', scoreCp: -400 },
    { uci: 'd2d4', scoreCp: 0, mate: -3 },
  ];
  /* A mated line is never the mistake, and the permitted loss is the beginner
     severity (700cp below 1100 Elo), not the worst line in the list. */
  const seen = new Set<string | null>();
  for (const roll of [0, 0.25, 0.5, 0.75, 0.99]) {
    const slip = chooseBlunder(candidates, 'w', 400, () => roll);
    assert.notEqual(slip, 'd2d4', 'a forced mate is never the chosen error');
    if (slip) {
      const entry = candidates.find((candidate) => candidate.uci === slip)!;
      assert.ok(20 - entry.scoreCp <= 700, 'the slip stays inside beginner severity');
      assert.ok(20 - entry.scoreCp >= 80, 'and it is a real error, not noise');
    }
    seen.add(slip);
  }
  assert.ok(seen.size > 0, 'at least one roll takes a mistake');
});

test('he is not losing a piece on every single move', async () => {
  /* With no bad candidate on the list, the roll simply cannot produce one: the
     quiet move stands instead of an invented blunder. */
  const played = position('e4', 'e5', 'Nf3', 'Nc6');
  const chosen = await chooseBotMove({
    game: played,
    fen: played.fen(),
    history: ['e4', 'e5', 'Nf3', 'Nc6'],
    botColor: 'w',
    style: STYLE,
    elo: 400,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: engineWith([
      { uci: 'f1b5', scoreCp: 25 },
      { uci: 'f1c4', scoreCp: 22 },
      { uci: 'd2d4', scoreCp: 18 },
      { uci: 'b1c3', scoreCp: 16 },
      { uci: 'd2d3', scoreCp: 12 },
    ]),
    random: () => 0,
  });
  assert.ok(chosen);
  assert.ok((chosen.decision?.gap ?? 999) <= candidateGapForElo(400) + 30);
  assertLegal(played.fen(), chosen.uci);
});

/* ------------------------- 9-10. dialogue system ------------------------- */

test('his voice is relaxed, funny and free of theory talk', () => {
  const bank = DIALOGUE_BANKS.emmanuel;
  assert.deepEqual(
    Object.keys(bank).sort(),
    Object.keys(DIALOGUE_BANKS.freshman).sort(),
    'every dialogue event has something to say',
  );
  for (const lines of Object.values(bank)) {
    assert.ok(lines.length > 0);
    for (const line of lines) {
      assert.ok(line.length > 0 && line.length <= 80, line);
      assert.ok(!/[0-9]/.test(line), line);
      assert.ok(
        !/\b(eval|evaluation|centipawn|engine|stockfish|depth|variant|pv|score)\b/i.test(line),
        `no engine vocabulary: ${line}`,
      );
      assert.ok(
        !/\b(gambit|sicilian|ruy|fianchetto|zugzwang|tempo|variation|theory)\b/i.test(line),
        `no theory he could not know: ${line}`,
      );
      /* Casual English, not caricature: no phonetic spelling. */
      assert.doesNotMatch(line, /\b(ya|dont|dat|dem|ze|ain't going)\b/i, line);
    }
  }

  const spoken = Object.values(bank).flat().join(' | ');
  for (const line of [
    'Alright, let’s get this over with.',
    'I have no idea what I’m doing, by the way.',
    'Bro this is abuse.',
    'Bro, relax.',
    'Wait, what did I just do?',
    'Yeah, I’m not winning this.',
    'Wait, I’m actually cooking?',
    'Yeah, never playing this again.',
  ]) {
    assert.ok(spoken.includes(line), `missing his voice: ${line}`);
  }

  /* Understated, not shouty: almost nothing ends in an exclamation mark. */
  const all = Object.values(bank).flat();
  assert.ok(all.filter((line) => line.includes('!')).length <= 1);
});

test('his lines are his own and he does not borrow another register', () => {
  const mine = Object.values(DIALOGUE_BANKS.emmanuel).flat().join(' ').toLowerCase();
  for (const phrase of ['chat', 'lowkey', 'walahi', 'light work', 'right guys', 'blundereddd']) {
    assert.equal(mine.includes(phrase), false, `no borrowed slang: ${phrase}`);
  }
  assert.notEqual(DIALOGUE_BANKS.emmanuel, DIALOGUE_BANKS.faadi);
  assert.notEqual(DIALOGUE_BANKS.emmanuel, DIALOGUE_BANKS.bryan);
  assert.notEqual(DIALOGUE_BANKS.emmanuel, DIALOGUE_BANKS.mabinti);
  /* A lost position gets a shrug, not panic. */
  assert.ok(DIALOGUE_BANKS.emmanuel.losing.length >= 3);
  assert.ok(DIALOGUE_BANKS.emmanuel.loss.length >= 3);
});

test('he speaks rarely and never repeats a line until his bank runs out', () => {
  const state = createDialogueState();
  const first = maybeReact('emmanuel', 'mistake', { ply: 30, state, random: () => 0 });
  assert.ok(first);

  /* His quiet gap is eight plies: longer than the default, because he is not a
     talker. */
  assert.equal(maybeReact('emmanuel', 'defense', { ply: 34, state, random: () => 0 }), null);
  assert.equal(maybeReact('emmanuel', 'mistake', { ply: 37, state, random: () => 0 }), null);
  assert.ok(maybeReact('emmanuel', 'defense', { ply: 39, state, random: () => 0 }));
  /* The same kind of remark waits for the repeat gap. */
  assert.equal(maybeReact('emmanuel', 'mistake', { ply: 46, state, random: () => 0 }), null);
  assert.ok(maybeReact('emmanuel', 'mistake', { ply: 49, state, random: () => 0 }));

  /* Used lines are held back while the bank lasts. */
  const fresh = createDialogueState();
  const seen = new Set<string>();
  let ply = 40;
  while (seen.size < DIALOGUE_BANKS.emmanuel.mistake.length) {
    ply += 20;
    const line = maybeReact('emmanuel', 'mistake', { ply, state: fresh, random: () => 0.99 });
    assert.ok(line);
    assert.equal(seen.has(line.text), false, 'a line is not repeated while unused ones remain');
    seen.add(line.text);
  }

  /* Once-per-game remarks stay once per game. */
  const once = createDialogueState();
  assert.ok(maybeReact('emmanuel', 'losing', { ply: 10, state: once, random: () => 0 }));
  assert.equal(
    maybeReact('emmanuel', 'losing', { ply: 60, state: once, random: () => 0 }),
    null,
    'losing is announced once',
  );

  /* A finished game always gets a line. */
  const closing = createDialogueState();
  const loss = maybeReact('emmanuel', 'loss', { ply: 2, state: closing, force: true, random: () => 0 });
  assert.ok(loss);
  assert.ok(DIALOGUE_BANKS.emmanuel.loss.includes(loss.text));

  /* His cadence is his own and slower than the default. */
  assert.ok(DIALOGUE_TIMING.ordinaryGap < 8);
});

test('dialogue cannot change a move: the same position and roll pick the same move', () => {
  const fen = position('e4', 'e5', 'Nf3', 'Nc6').fen();
  const candidates = [
    { uci: 'f1b5', scoreCp: 25, mate: null },
    { uci: 'f1c4', scoreCp: 20, mate: null },
    { uci: 'd2d4', scoreCp: 18, mate: null },
  ];
  const one = choosePersonalityMove({ fen, candidates, style: STYLE, elo: 400, random: () => 0.3 });
  const two = choosePersonalityMove({ fen, candidates, style: STYLE, elo: 400, random: () => 0.3 });
  assert.equal(one?.uci, two?.uci);
  assert.ok(candidates.some((candidate) => candidate.uci === one?.uci));
});

/* ------------------- 11-12. Normal Play and Bot vs. Bot ------------------ */

test('Normal Play: he plays both colours from the same ad-hoc selection', async () => {
  const asBlack = position('e4');
  const black = await chooseBotMove({
    game: asBlack,
    fen: asBlack.fen(),
    history: ['e4'],
    botColor: 'b',
    style: STYLE,
    elo: 400,
    clockMs: 300_000,
    incrementMs: 2_000,
    initialMs: 300_000,
    engine: engineWith([
      { uci: 'e7e5', scoreCp: -15 },
      { uci: 'c7c5', scoreCp: -20 },
      { uci: 'e7e6', scoreCp: -25 },
      { uci: 'd7d5', scoreCp: -30 },
      { uci: 'g8f6', scoreCp: -40 },
    ]),
    random: () => 0.99,
  });
  assert.ok(black);
  assert.equal(black.bookMove, false);
  assertLegal(asBlack.fen(), black.uci);
  assert.ok(black.plan && black.plan.searchMs > 0, 'the engine still gets the turn');

  const asWhite = position();
  const white = await chooseBotMove({
    game: asWhite,
    fen: asWhite.fen(),
    history: [],
    botColor: 'w',
    style: STYLE,
    elo: 400,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    engine: engineWith([
      { uci: 'e2e4', scoreCp: 20 },
      { uci: 'd2d4', scoreCp: 18 },
      { uci: 'g1f3', scoreCp: 15 },
      { uci: 'c2c4', scoreCp: 10 },
      { uci: 'b2b3', scoreCp: 0 },
    ]),
    random: () => 0.99,
  });
  assert.ok(white);
  assert.equal(white.bookMove, false);
  assertLegal(asWhite.fen(), white.uci);
});

test('Bot vs. Bot: the same selection drives both sides of a match', async () => {
  const game = new Chess();
  const history: string[] = [];
  for (let ply = 0; ply < 12; ply += 1) {
    if (game.isGameOver()) break;
    const botColor = game.turn();
    const candidates = game.moves({ verbose: true }).slice(0, 5).map((move, index) => ({
      uci: `${move.from}${move.to}${move.promotion ?? ''}`,
      scoreCp: 25 - index * 15,
    }));
    const chosen = await chooseBotMove({
      game,
      fen: game.fen(),
      history: [...history],
      botColor,
      style: styleFor('emmanuel', 400),
      elo: 400,
      clockMs: 180_000,
      incrementMs: 0,
      initialMs: 180_000,
      engine: engineWith(candidates),
      random: () => 0.7,
    });
    assert.ok(chosen);
    /* Both sides are the same personality, and neither ever claims the book. */
    assert.equal(chosen.bookMove, false);
    assert.equal(chosen.source, 'engine');
    const applied = game.move({
      from: chosen.uci.slice(0, 2) as never,
      to: chosen.uci.slice(2, 4) as never,
      promotion: chosen.uci.length > 4 ? chosen.uci.slice(4, 5) : undefined,
    });
    history.push(applied.san);
  }
  assert.ok(history.length >= 6, 'both sides moved through the same selector');

  /* He thinks quickly: no long calculation to present. */
  const plan = computeThinkingPlan({
    fen: new Chess().fen(),
    style: STYLE,
    clockMs: 300_000,
    incrementMs: 0,
    initialMs: 300_000,
    ply: 6,
    bookMove: false,
  });
  assert.ok(plan.searchMs > 0);
  assert.ok(plan.deliberationMs <= 6000);
  assert.ok(plan.deliberationMs < 4000, 'a quick glance, not a think');
});

/* --------------------- 13. history and PGN identity --------------------- */

test('a saved game and its PGN keep his name, subtext, colour and rating', () => {
  const pgn = buildPgn(
    {
      white: opponentFullName(EMMANUEL),
      black: opponentFullName(getOpponent('mabinti')!),
      result: '1-0',
      date: Date.UTC(2026, 10, 20),
      timeControl: '300+0',
      whiteElo: EMMANUEL.elo,
      blackElo: getOpponent('mabinti')!.elo,
      event: 'Bot vs. Bot',
    },
    ['e4', 'e5', 'Nf3', 'Nc6'],
  );
  assert.match(pgn, /\[White "Emmanuel Domah \(Senior\)"\]/);
  assert.match(pgn, /\[WhiteElo "400"\]/);
  assert.doesNotMatch(pgn, /\[White "Emmanuel Domah"\]/, 'the stage is never dropped');
  assert.doesNotMatch(pgn, /"emmanuel"/i, 'no internal id leaks into the PGN');

  /* History rebuilds his live card from the stored fields, so a refresh keeps
     the same opponent. */
  const profile = profileFromRecord({
    opponent_id: EMMANUEL.id,
    opponent_name: opponentFullName(EMMANUEL),
    opponent_elo: EMMANUEL.elo,
    opponent_kind: EMMANUEL.kind,
  });
  assert.equal(profile.id, 'emmanuel');
  assert.equal(profile.name, 'Emmanuel Domah');
  assert.equal(profile.title, 'Senior');
  assert.equal(profile.elo, 400);
  assert.equal(profile.category, 'beginner');
  assert.equal(opponentMeta(profile), 'Senior · 400 Elo');

  /* A dropped record still shows a name and a rating, never a crash. */
  const unknown = profileFromRecord({
    opponent_id: 'emmanuel',
    opponent_name: 'Emmanuel Domah (Senior)',
    opponent_elo: 400,
    opponent_kind: 'personality',
  });
  assert.equal(unknown.id, 'emmanuel');

  /* And the two Seniors stay distinct in a history list. */
  const edward = getOpponent('edward')!;
  assert.notEqual(opponentFullName(edward), opponentFullName(EMMANUEL));
});

/* --------------------------- 14. regressions --------------------------- */

test('every other opponent and the General Bot are untouched', () => {
  assert.equal(PERSONALITY_OPPONENTS.length, 18);
  assert.equal(ALL_OPPONENTS.length, 19);

  const expected: Array<[string, string, string, number, string]> = [
    ['freshman', 'Johnfer Quispe', 'Freshman', 1250, 'novice'],
    ['sophomore', 'Johnfer Quispe', 'Sophomore', 1450, 'intermediate'],
    ['faadi', 'Faadi Granillo Garcia', 'Prime', 700, 'beginner'],
    ['nina-freshman', 'Nina Yang', 'Freshman', 1200, 'novice'],
    ['bryan-sophomore', 'Bryan Martinez-Hernandez', 'Sophomore', 1350, 'intermediate'],
    ['nina', 'Nina Yang', 'Sophomore', 1550, 'intermediate'],
    ['mabinti', 'Mabinti Mansaray', 'Junior', 1550, 'big-4'],
    ['brandon-freshman', 'Brandon Tran', 'Freshman', 1600, 'intermediate'],
    ['bryan', 'Bryan Martinez-Hernandez', 'Junior', 1800, 'varsity'],
    ['senior', 'Johnfer Quispe', 'Senior', 2000, 'varsity'],
    ['brandon', 'Brandon Tran', 'Prime', 2350, 'big-4'],
    ['junior', 'Johnfer Quispe', 'Junior', 2150, 'big-4'],
    ['bryan-prime', 'Bryan Martinez-Hernandez', 'Prime', 2000, 'big-4'],
    ['edward', 'Edward Chen', 'Senior', 800, 'beginner'],
  ];
  for (const [id, name, title, elo, category] of expected) {
    const opponent = getOpponent(id);
    assert.ok(opponent, `${id} is still on the roster`);
    assert.equal(opponent.name, name);
    assert.equal(opponent.title, title);
    assert.equal(opponent.elo, elo);
    assert.equal(opponent.category, category, `${id} kept its group`);
  }

  assert.equal(GENERAL_BOT.id, 'general');
  assert.equal(GENERAL_BOT.kind, 'general');
  assert.equal(GENERAL_BOT.usesRepertoire, false);

  /* Strength dials elsewhere are exactly as they were: no shared curve moved. */
  assert.equal(PERSONALITY_STYLES.edward.depthCap, 10);
  assert.equal(PERSONALITY_STYLES.mabinti.depthCap, undefined);
  assert.equal(PERSONALITY_STYLES.faadi.complexity, 85);
  assert.equal(PERSONALITY_STYLES['bryan-sophomore'].defensive, 95);
  assert.equal(PERSONALITY_STYLES.brandon.sacrifice, 95);
  assert.equal(PERSONALITY_STYLES.freshman.aggression, 25);
  assert.equal(PERSONALITY_STYLES.mabinti.positional, 70);
  assert.equal(blunderChance(800), 0.45, 'the curve is untouched at its anchor');
  assert.equal(depthForElo(400), 16, 'the shared depth is untouched');
  assert.equal(chooseBlunder([], 'w', 400), null);
});
