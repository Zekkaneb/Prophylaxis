/**
 * Opponent catalogue: the final nine-opponent roster, explicit category
 * membership, display labels and the saved-game compatibility rules.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALL_OPPONENTS,
  GENERAL_BOT,
  GENERAL_BOT_ELO,
  OPPONENT_CATEGORIES,
  PERSONALITY_OPPONENTS,
  getOpponent,
  opponentFullName,
  opponentMeta,
  opponentStage,
  profileFromRecord,
  withElo,
} from '../../src/play/opponents.ts';

test('the roster is the agreed line-up, named like Brandon’s card', () => {
  assert.deepEqual(
    PERSONALITY_OPPONENTS.map((opponent) => [
      opponent.id,
      opponent.name,
      opponent.title,
      opponent.elo,
    ]),
    [
      ['freshman', 'Johnfer Quispe', 'Freshman', 1250],
      ['sophomore', 'Johnfer Quispe', 'Sophomore', 1450],
      ['faadi', 'Faadi Granillo Garcia', 'Prime', 1100],
      ['nina-freshman', 'Nina Yang', 'Freshman', 1150],
      ['bryan-sophomore', 'Bryan Martinez-Hernandez', 'Sophomore', 1350],
      ['nina', 'Nina Yang', 'Sophomore', 1550],
      ['brandon-freshman', 'Brandon Tran', 'Freshman', 1600],
      ['bryan', 'Bryan Martinez-Hernandez', 'Junior', 1800],
      ['senior', 'Johnfer Quispe', 'Senior', 2000],
      ['brandon', 'Brandon Tran', 'Prime', 2350],
      ['junior', 'Johnfer Quispe', 'Junior', 2150],
      ['bryan-prime', 'Bryan Martinez-Hernandez', 'Prime', 2000],
      ['edward', 'Edward Chen', 'Senior', 800],
    ],
  );

  assert.equal(new Set(PERSONALITY_OPPONENTS.map((opponent) => opponent.id)).size, 14);
  for (const opponent of PERSONALITY_OPPONENTS) {
    assert.doesNotMatch(opponent.name, /\(/, 'the name carries no parenthetical suffix');
    assert.ok(opponent.title, `${opponent.id} has a subtext`);
    assert.notEqual(opponent.title, undefined);
    assert.equal(
      opponent.name.toLowerCase().includes((opponent.title as string).toLowerCase()),
      false,
      'the name does not repeat its subtext',
    );
  }

  /* Shared names are fine: id plus stage still tells the four Johnfers and the
     two Bryans apart, which is how saved games are labelled. */
  assert.equal(
    new Set(PERSONALITY_OPPONENTS.map((opponent) => opponentFullName(opponent))).size,
    13,
  );
});

test('categories are explicitly configured, complete and free of Big 4', () => {
  assert.deepEqual(
    OPPONENT_CATEGORIES.map((group) => group.label),
    ['Beginners', 'Intermediate', 'Strong', 'The Big 3'],
  );
  assert.ok(
    !OPPONENT_CATEGORIES.some((group) => /big\s*4/i.test(group.label)),
    'the old label is gone',
  );

  const declared = new Set(OPPONENT_CATEGORIES.map((group) => group.id));
  for (const opponent of PERSONALITY_OPPONENTS) {
    assert.ok(declared.has(opponent.category), `${opponent.id} sits in a real group`);
  }

  assert.deepEqual(
    PERSONALITY_OPPONENTS.filter((opponent) => opponent.category === 'beginners').map(
      (opponent) => opponent.id,
    ),
    ['freshman', 'faadi', 'nina-freshman', 'edward'],
  );
  assert.deepEqual(
    PERSONALITY_OPPONENTS.filter((opponent) => opponent.category === 'intermediate').map(
      (opponent) => opponent.id,
    ),
    ['sophomore', 'bryan-sophomore'],
  );
  assert.deepEqual(
    PERSONALITY_OPPONENTS.filter((opponent) => opponent.category === 'strong').map(
      (opponent) => opponent.id,
    ),
    ['nina', 'mabinti', 'brandon-freshman', 'bryan', 'senior'],
  );

  /* Two 2000s, two different groups: membership is a field, never the rating. */
  assert.equal(getOpponent('senior')?.elo, 2000);
  assert.equal(getOpponent('bryan-prime')?.elo, 2000);
  assert.notEqual(getOpponent('senior')?.category, getOpponent('bryan-prime')?.category);
});

test('The Big 3 holds exactly Brandon, Johnfer and Bryan Prime', () => {
  const big = PERSONALITY_OPPONENTS.filter((opponent) => opponent.category === 'big-3');
  assert.equal(big.length, 3, 'no fourth card');
  assert.deepEqual(
    big.map((opponent) => [opponent.name, opponent.title, opponent.elo]),
    [
      ['Brandon Tran', 'Prime', 2350],
      ['Johnfer Quispe', 'Junior', 2150],
      ['Bryan Martinez-Hernandez', 'Prime', 2000],
    ],
    'the featured row reads strongest first',
  );
  assert.equal(new Set(big.map((opponent) => opponent.id)).size, 3);
  assert.ok(!big.some((opponent) => opponent.id === 'senior'), 'Senior is not featured');
  assert.equal(
    big.filter((opponent) => opponent.id === 'bryan-prime').length,
    1,
    'no duplicate Bryan Prime',
  );
  for (const opponent of big) {
    assert.ok(opponent.style.length > 0);
    assert.ok(opponent.portraitPath);
    assert.ok(opponent.initials.length > 0);
  }
});

test('maps each personality to its portrait and keeps a monogram fallback', () => {
  assert.deepEqual(
    PERSONALITY_OPPONENTS.map((opponent) => opponent.portraitPath),
    [
      'opponents/freshman.webp',
      'opponents/sophomore.webp',
      'opponents/faadi.webp',
      'opponents/nina-freshman.webp',
      'opponents/bryan-sophomore.webp',
      'opponents/nina.webp',
      'opponents/mabinti.webp',
      'opponents/brandon-freshman.webp',
      'opponents/bryan-junior.webp',
      'opponents/senior.webp',
      'opponents/brandon.webp',
      'opponents/junior.webp',
      'opponents/bryan-prime.webp',
      'opponents/edward.webp',
    ],
  );

  for (const opponent of PERSONALITY_OPPONENTS) {
    assert.equal(opponent.kind, 'personality');
    assert.equal(opponent.usesRepertoire, false);
    assert.ok(opponent.initials.length >= 1, `${opponent.id} has a fallback monogram`);
    assert.ok(opponent.style.length > 0);
  }

  const senior = getOpponent('senior');
  assert.ok(senior);
  assert.equal(senior.elo, 2000, 'Senior dropped from 2250 to 2000');
  assert.match(senior.style, /tactically ambitious/i, 'Senior is still the tactician');

  const brandon = getOpponent('brandon');
  assert.ok(brandon);
  assert.equal(brandon.elo, 2350);
  assert.equal(brandon.title, 'Prime');
  assert.ok(brandon.elo > getOpponent('junior')!.elo, 'Brandon is still the strongest');

  const nina = getOpponent('nina');
  assert.ok(nina);
  assert.equal(nina.name, 'Nina Yang');
  assert.equal(nina.title, 'Sophomore', 'her stage is the card subtext');
  assert.equal(nina.elo, 1550);
  assert.equal(nina.initials, 'NY');
  assert.match(nina.style, /charismatic/i);
  assert.match(nina.style, /playful/i);
  assert.match(nina.style, /initiative/i);
  assert.match(nina.style, /selectively cautious/i);
});

test('cards show name over subtext; stored games stay unambiguous', () => {
  /* Card: two fields, exactly like Brandon's. */
  for (const [id, name, stage] of [
    ['brandon', 'Brandon Tran', 'Prime'],
    ['junior', 'Johnfer Quispe', 'Junior'],
    ['bryan-prime', 'Bryan Martinez-Hernandez', 'Prime'],
    ['nina', 'Nina Yang', 'Sophomore'],
  ] as const) {
    assert.equal(getOpponent(id)!.name, name);
    assert.equal(opponentStage(getOpponent(id)!), stage);
  }

  /* Stored games and PGN keep the one-string form so versions do not merge. */
  assert.equal(opponentFullName(getOpponent('brandon')!), 'Brandon Tran (Prime)');
  assert.equal(opponentFullName(getOpponent('junior')!), 'Johnfer Quispe (Junior)');
  assert.equal(opponentFullName(getOpponent('freshman')!), 'Johnfer Quispe (Freshman)');
  assert.equal(opponentFullName(getOpponent('nina')!), 'Nina Yang (Sophomore)');
  assert.equal(
    opponentFullName(getOpponent('bryan')!),
    'Bryan Martinez-Hernandez (Junior)',
  );
  assert.equal(
    opponentFullName(getOpponent('bryan-prime')!),
    'Bryan Martinez-Hernandez (Prime)',
  );

  assert.equal(opponentMeta(getOpponent('brandon')!), 'Prime · 2350 Elo');
  assert.equal(opponentMeta(getOpponent('nina')!), 'Sophomore · 1550 Elo');
  assert.equal(opponentMeta(getOpponent('freshman')!), 'Freshman · 1250 Elo');
});

test('saved games keep resolving after the restructure', () => {
  /* The original Bryan id must still load; it is now the Junior profile. */
  const legacyBryan = profileFromRecord({
    opponent_id: 'bryan',
    opponent_name: 'Bryan Martinez-Hernandez',
    opponent_elo: 1850,
    opponent_kind: 'personality',
  });
  assert.equal(legacyBryan.id, 'bryan');
  assert.equal(legacyBryan.elo, 1800, 'the live catalogue wins for a known id');
  assert.equal(legacyBryan.name, 'Bryan Martinez-Hernandez');
  assert.equal(legacyBryan.title, 'Junior');

  const legacySenior = profileFromRecord({
    opponent_id: 'senior',
    opponent_name: 'Johnfer Quispe (Senior)',
    opponent_elo: 2250,
    opponent_kind: 'personality',
  });
  assert.equal(legacySenior.id, 'senior');
  assert.equal(legacySenior.elo, 2000);

  const prime = profileFromRecord({
    opponent_id: 'bryan-prime',
    opponent_name: 'Bryan Martinez-Hernandez (Prime)',
    opponent_elo: 2000,
    opponent_kind: 'personality',
  });
  assert.equal(prime.id, 'bryan-prime');
  assert.equal(prime.category, 'big-3');

  /* A record for an opponent that no longer exists is rebuilt, not dropped. */
  const dropped = profileFromRecord({
    opponent_id: 'retired-bot',
    opponent_name: 'Retired Bot',
    opponent_elo: 1900,
    opponent_kind: 'personality',
  });
  assert.equal(dropped.id, 'retired-bot');
  assert.equal(dropped.elo, 1900);
  assert.equal(dropped.category, 'strong');
  assert.equal(dropped.initials, 'RE');
});

test('keeps the General Bot separate and configurable', () => {
  assert.equal(GENERAL_BOT.name, 'General Bot');
  assert.equal(GENERAL_BOT.kind, 'general');
  assert.equal(GENERAL_BOT.portraitPath, null);
  assert.equal(GENERAL_BOT.usesRepertoire, true);
  assert.equal(ALL_OPPONENTS.length, 15);
  assert.equal(new Set(ALL_OPPONENTS.map((opponent) => opponent.id)).size, 15);
  assert.equal(GENERAL_BOT_ELO.min, 100);
  assert.equal(GENERAL_BOT_ELO.max, 2800);
});

test('looks opponents up by id and clamps custom strength', () => {
  assert.equal(getOpponent('freshman')?.elo, 1250);
  assert.equal(getOpponent('nina')?.elo, 1550);
  assert.equal(getOpponent('bryan')?.elo, 1800);
  assert.equal(getOpponent('bryan-prime')?.elo, 2000);
  assert.equal(getOpponent('junior')?.elo, 2150);
  assert.equal(getOpponent('brandon')?.elo, 2350);
  assert.equal(getOpponent('general')?.id, 'general');
  assert.equal(getOpponent('missing'), undefined);

  assert.equal(withElo(GENERAL_BOT, 100).elo, GENERAL_BOT_ELO.min);
  assert.equal(withElo(GENERAL_BOT, 9_000).elo, GENERAL_BOT_ELO.max);
  assert.equal(withElo(GENERAL_BOT, 1724).elo, 1724);
});
