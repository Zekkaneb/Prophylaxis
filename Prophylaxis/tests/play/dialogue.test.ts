import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DIALOGUE_BANKS,
  DIALOGUE_TIMING,
  createDialogueState,
  maybeReact,
} from '../../src/play/personality/dialogue.ts';
import { PERSONALITY_STYLES } from '../../src/play/personality/styles.ts';

const IDS = ['freshman', 'sophomore', 'junior', 'senior', 'brandon'] as const;
const ENGINE_WORDS = /\b(eval|evaluation|centipawn|engine|stockfish|depth|advantage|blunder|inaccuracy)\b/i;

test('every character has a full bank of short, human lines', () => {
  for (const id of IDS) {
    const bank = DIALOGUE_BANKS[id];
    for (const [event, lines] of Object.entries(bank)) {
      assert.ok(lines.length >= 2, `${id}/${event} needs at least two lines`);
      for (const line of lines) {
        assert.ok(line.trim().length > 0);
        assert.ok(line.length <= 100, `${id}/${event}: too long: ${line}`);
        assert.ok(!/[0-9]/.test(line), `${id}/${event}: numbers read as engine output: ${line}`);
        assert.ok(!ENGINE_WORDS.test(line), `${id}/${event}: engine vocabulary: ${line}`);
        assert.ok(!line.includes('+'), `${id}/${event}: evaluation sign leaked: ${line}`);
      }
    }
  }

  /* Four distinct voices, not four copies. */
  const openings = IDS.map((id) => DIALOGUE_BANKS[id].book[0]);
  assert.equal(new Set(openings).size, 5);
});

test('ordinary remarks respect the quiet gap', () => {
  const state = createDialogueState();
  const first = maybeReact('sophomore', 'mistake', { ply: 20, state, random: () => 0 });
  assert.ok(first);

  assert.equal(
    maybeReact('sophomore', 'strong', { ply: 22, state, random: () => 0 }),
    null,
    'a second remark two plies later would be chatter',
  );

  const later = maybeReact('sophomore', 'strong', {
    ply: 20 + DIALOGUE_TIMING.ordinaryGap,
    state,
    random: () => 0,
  });
  assert.ok(later);
});

test('the same event waits longer than ordinary remarks', () => {
  const state = createDialogueState();
  assert.ok(maybeReact('senior', 'material-won', { ply: 20, state, random: () => 0 }));

  assert.equal(
    maybeReact('senior', 'material-won', {
      ply: 20 + DIALOGUE_TIMING.ordinaryGap,
      state,
      random: () => 0,
    }),
    null,
  );

  assert.ok(
    maybeReact('senior', 'material-won', {
      ply: 20 + DIALOGUE_TIMING.repeatGap,
      state,
      random: () => 0,
    }),
  );
});

test('a sacrifice and a brilliant move may interrupt the quiet gap', () => {
  const state = createDialogueState();
  assert.ok(maybeReact('brandon', 'mistake', { ply: 20, state, random: () => 0 }));
  assert.ok(maybeReact('brandon', 'sacrifice', { ply: 21, state, random: () => 0 }));
});

test('a brilliant move may interrupt the quiet gap', () => {
  const state = createDialogueState();
  assert.ok(maybeReact('junior', 'mistake', { ply: 20, state, random: () => 0 }));
  assert.ok(maybeReact('junior', 'brilliant', { ply: 21, state, random: () => 0 }));
});

test('a remark is never repeated while the bank has unused lines', () => {
  const state = createDialogueState();
  const first = maybeReact('freshman', 'strong', { ply: 10, state, force: true, random: () => 0 });
  const second = maybeReact('freshman', 'strong', { ply: 11, state, force: true, random: () => 0 });
  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first.text, second.text);
});

test('winning and losing are said once per game', () => {
  const state = createDialogueState();
  assert.ok(maybeReact('senior', 'winning', { ply: 20, state, force: true, random: () => 0 }));
  assert.equal(
    maybeReact('senior', 'winning', { ply: 60, state, force: true, random: () => 0 }),
    null,
  );
});

test('the end of the game always gets a line', () => {
  const state = createDialogueState();
  const win = maybeReact('freshman', 'win', { ply: 0, state, force: true, random: () => 0 });
  const loss = maybeReact('freshman', 'loss', { ply: 1, state, force: true, random: () => 0 });
  assert.ok(win);
  assert.ok(loss);
  assert.notEqual(win.text, loss.text);
});

test('a line is chosen from the requested event and character', () => {
  const state = createDialogueState();
  const line = maybeReact('junior', 'deviation', { ply: 40, state, force: true, random: () => 0.9 });
  assert.ok(line);
  assert.ok(DIALOGUE_BANKS.junior.deviation.includes(line.text));
});

test('every style can speak every event without an empty bank', () => {
  for (const [id, style] of Object.entries(PERSONALITY_STYLES)) {
    assert.ok(style.id === id);
    for (const event of Object.keys(DIALOGUE_BANKS[id as keyof typeof DIALOGUE_BANKS])) {
      const state = createDialogueState();
      const line = maybeReact(
        id as 'freshman',
        event as keyof (typeof DIALOGUE_BANKS)['freshman'],
        { ply: 30, state, force: true },
      );
      assert.ok(line, `${id}/${event} has no line`);
    }
  }
});
