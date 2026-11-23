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
      ['emmanuel', 'Emmanuel Domah', 'Senior', 150],
      ['edward', 'Edward Chen', 'Senior', 800],
      ['faadi', 'Faadi Granillo Garcia', 'Prime', 700],
      ['christian-hernandez', 'Christian Hernandez', 'Senior', 950],
      ['nina-freshman', 'Nina Yang', 'Freshman', 1200],
      ['freshman', 'Johnfer Quispe', 'Freshman', 1250],
      ['alex-tang', 'Alex Tang', 'Sophomore', 1100],
      ['bryan-sophomore', 'Bryan Martinez-Hernandez', 'Sophomore', 1350],
      ['bryan-widjaja', 'Bryan Widjaja', 'Prime', 1400],
      ['sophomore', 'Johnfer Quispe', 'Sophomore', 1450],
      ['nina', 'Nina Yang', 'Sophomore', 1550],
      ['brandon-freshman', 'Brandon Tran', 'Freshman', 1600],
      ['bryan', 'Bryan Martinez-Hernandez', 'Junior', 1800],
      ['senior', 'Johnfer Quispe', 'Senior', 2000],
      ['brandon', 'Brandon Tran', 'Prime', 2350],
      ['junior', 'Johnfer Quispe', 'Junior', 2150],
      ['bryan-prime', 'Bryan Martinez-Hernandez', 'Prime', 2000],
      ['mabinti', 'Mabinti Mansaray', 'Junior', 1550],
      ['erik-wiessmann', 'Erik Wiessmann', 'Teacher', 1100],
      ['jonah-pachikara', 'Jonah Pachikara', undefined, 1400],
      ['sophia-kuan', 'Sophia Kuan', 'Senior', 1300],
      ['brandon-varsity', 'Brandon Tran', 'Sophomore', 1850],
      ['monkey', 'Monkey', '???', 999999999],
    ],
  );

  assert.equal(new Set(PERSONALITY_OPPONENTS.map((opponent) => opponent.id)).size, 23);
  for (const opponent of PERSONALITY_OPPONENTS) {
    assert.doesNotMatch(opponent.name, /\(/, 'the name carries no parenthetical suffix');
    /* Jonah has no specified subtext by design: no title, so no invented stage. */
    if (opponent.id === 'jonah-pachikara') {
      assert.equal(opponent.title, undefined, 'no invented school-year label');
      continue;
    }
    assert.ok(opponent.title, `${opponent.id} has a subtext`);
    assert.equal(
      opponent.name.toLowerCase().includes(opponent.title.toLowerCase()),
      false,
      'the name does not repeat its subtext',
    );
  }

  /* Shared names are fine: id plus stage still tells the four Johnfers and the
     two Bryans apart, which is how saved games are labelled. */
  assert.equal(
    new Set(PERSONALITY_OPPONENTS.map((opponent) => opponentFullName(opponent))).size,
    23,
  );
});

test('categories are explicitly configured, complete and ordered by band', () => {
  assert.deepEqual(
    OPPONENT_CATEGORIES.map((group) => group.label),
    ['Beginner', 'Novice', 'Intermediate', 'Varsity', 'The Big 4', '???'],
  );
  assert.deepEqual(
    OPPONENT_CATEGORIES.map((group) => group.hint),
    ['100–1000 Elo', '1001–1300 Elo', '1301–1600 Elo', '1601–2000 Elo', 'Special designation', 'Beyond the ladder'],
  );

  const declared = new Set(OPPONENT_CATEGORIES.map((group) => group.id));
  for (const opponent of PERSONALITY_OPPONENTS) {
    assert.ok(declared.has(opponent.category), `${opponent.id} sits in a real group`);
  }

  /* Every band, in the order the cards are listed inside it. */
  assert.deepEqual(
    PERSONALITY_OPPONENTS.filter((opponent) => opponent.category === 'beginner').map(
      (opponent) => opponent.id,
    ),
    ['emmanuel', 'edward', 'faadi', 'christian-hernandez'],
  );
  assert.deepEqual(
    PERSONALITY_OPPONENTS.filter((opponent) => opponent.category === 'novice').map(
      (opponent) => opponent.id,
    ),
    ['nina-freshman', 'freshman', 'alex-tang', 'erik-wiessmann', 'sophia-kuan'],
  );
  assert.deepEqual(
    PERSONALITY_OPPONENTS.filter((opponent) => opponent.category === 'intermediate').map(
      (opponent) => opponent.id,
    ),
    ['bryan-sophomore', 'bryan-widjaja', 'sophomore', 'nina', 'brandon-freshman', 'jonah-pachikara'],
  );
  assert.deepEqual(
    PERSONALITY_OPPONENTS.filter((opponent) => opponent.category === 'varsity').map(
      (opponent) => opponent.id,
    ),
    ['bryan', 'senior', 'brandon-varsity'],
  );
  assert.deepEqual(
    PERSONALITY_OPPONENTS.filter((opponent) => opponent.category === 'big-4').map(
      (opponent) => opponent.id,
    ),
    ['brandon', 'junior', 'bryan-prime', 'mabinti'],
  );
  assert.deepEqual(
    PERSONALITY_OPPONENTS.filter((opponent) => opponent.category === 'apex').map(
      (opponent) => opponent.id,
    ),
    ['monkey'],
  );

  /* Two 2000s, two different groups: membership is a field, never the rating. */
  assert.equal(getOpponent('senior')?.elo, 2000);
  assert.equal(getOpponent('bryan-prime')?.elo, 2000);
  assert.notEqual(getOpponent('senior')?.category, getOpponent('bryan-prime')?.category);
});

test('The Big 4 holds exactly Brandon, Johnfer, Bryan Prime and Mabinti', () => {
  const big = PERSONALITY_OPPONENTS.filter((opponent) => opponent.category === 'big-4');
  assert.equal(big.length, 4, 'no fifth card');
  assert.deepEqual(
    big.map((opponent) => [opponent.name, opponent.title, opponent.elo]),
    [
      ['Brandon Tran', 'Prime', 2350],
      ['Johnfer Quispe', 'Junior', 2150],
      ['Bryan Martinez-Hernandez', 'Prime', 2000],
      ['Mabinti Mansaray', 'Junior', 1550],
    ],
    'the featured row reads strongest first',
  );
  assert.equal(new Set(big.map((opponent) => opponent.id)).size, 4);
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
      'opponents/emmanuel.webp',
      'opponents/edward.webp',
      'opponents/faadi.webp',
      'opponents/christian-hernandez.webp',
      'opponents/nina-freshman.webp',
      'opponents/freshman.webp',
      'opponents/alex-tang.webp',
      'opponents/bryan-sophomore.webp',
      'opponents/bryan-widjaja.webp',
      'opponents/sophomore.webp',
      'opponents/nina.webp',
      'opponents/brandon-freshman.webp',
      'opponents/bryan-junior.webp',
      'opponents/senior.webp',
      'opponents/brandon.webp',
      'opponents/junior.webp',
      'opponents/bryan-prime.webp',
      'opponents/mabinti.webp',
      'opponents/erik-wiessmann.webp',
      'opponents/jonah-pachikara.webp',
      'opponents/sophia-kuan.webp',
      'opponents/brandon-varsity.webp',
      'opponents/monkey.webp',
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
  assert.equal(prime.category, 'big-4');

  /* A record for an opponent that no longer exists is rebuilt, not dropped. */
  const dropped = profileFromRecord({
    opponent_id: 'retired-bot',
    opponent_name: 'Retired Bot',
    opponent_elo: 1900,
    opponent_kind: 'personality',
  });
  assert.equal(dropped.id, 'retired-bot');
  assert.equal(dropped.elo, 1900);
  assert.equal(dropped.category, 'varsity');
  assert.equal(dropped.initials, 'RE');
});

test('keeps the General Bot separate and configurable', () => {
  assert.equal(GENERAL_BOT.name, 'General Bot');
  assert.equal(GENERAL_BOT.kind, 'general');
  assert.equal(GENERAL_BOT.portraitPath, null);
  assert.equal(GENERAL_BOT.usesRepertoire, false);
  assert.equal(ALL_OPPONENTS.length, 24);
  assert.equal(new Set(ALL_OPPONENTS.map((opponent) => opponent.id)).size, 24);
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
