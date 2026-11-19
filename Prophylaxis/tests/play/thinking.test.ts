import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeThinkingPlan,
  profilePosition,
  type ThinkingInput,
} from '../../src/play/personality/thinking.ts';
import { styleFor } from '../../src/play/personality/styles.ts';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const OPEN = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 6';
const TACTICAL = '4k3/8/8/8/q7/8/3QK3/8 w - - 0 1';
const ENDGAME = '8/8/4k3/8/8/4K3/8/4R3 w - - 0 1';

function input(overrides: Partial<ThinkingInput> = {}): ThinkingInput {
  return {
    fen: START,
    style: styleFor('sophomore', 1450)!,
    clockMs: null,
    incrementMs: 0,
    initialMs: 0,
    ply: 12,
    bookMove: false,
    ...overrides,
  };
}

test('the planner reads phase, branching and tension from the position', () => {
  const start = profilePosition(START);
  assert.equal(start.phase, 'opening');
  assert.equal(start.legalMoves, 20);
  assert.equal(start.tactical, false);
  assert.ok(start.complexity > 0 && start.complexity < 0.5);

  const tactical = profilePosition(TACTICAL);
  assert.ok(tactical.tactical, 'checks and a queen capture should read as tactical');
  assert.ok(tactical.checks >= 2);
  assert.ok(tactical.complexity > start.complexity);

  assert.equal(profilePosition(ENDGAME).phase, 'endgame');
});

test('a book move searches not at all but still takes a human beat', () => {
  const plan = computeThinkingPlan(
    input({ fen: OPEN, bookMove: true, clockMs: 120_000, initialMs: 120_000 }),
  );
  assert.equal(plan.reason, 'book');
  assert.equal(plan.searchMs, 0);
  assert.equal(plan.pauseMs, plan.deliberationMs);
  assert.ok(plan.deliberationMs >= 1500, `book move waited only ${plan.deliberationMs}ms`);
  assert.ok(plan.deliberationMs <= 6000);
  assert.ok(plan.deliberationMs <= plan.budgetMs);
});

test('every character deliberately takes a human beat before moving', () => {
  for (const id of ['freshman', 'sophomore', 'junior', 'senior'] as const) {
    const plan = computeThinkingPlan(input({ fen: START, style: styleFor(id, 1500)! }));
    assert.ok(
      plan.deliberationMs >= 1500,
      `${id} would move after ${plan.deliberationMs}ms`,
    );
    assert.ok(plan.deliberationMs <= plan.budgetMs);
  }

  const brandon = computeThinkingPlan(
    input({ fen: START, style: styleFor('brandon', 2350)! }),
  );
  assert.ok(brandon.deliberationMs >= 1000, 'Brandon still pauses, just briefly');
  assert.ok(brandon.deliberationMs <= brandon.budgetMs);
});

test('Brandon decides faster, but sharp positions still earn extra calculation', () => {
  const fresh = (fen: string) =>
    computeThinkingPlan(input({ fen, style: styleFor('brandon', 2350)! }));
  const quiet = fresh(START);
  const sharp = fresh(TACTICAL);

  assert.ok(sharp.budgetMs > quiet.budgetMs, 'a tactical position must not be rushed');
  assert.ok(sharp.deliberationMs >= quiet.deliberationMs);

  const sophomoreOpen = computeThinkingPlan(
    input({ fen: START, style: styleFor('sophomore', 1450)! }),
  );
  assert.ok(
    quiet.budgetMs < sophomoreOpen.budgetMs,
    `Brandon ${quiet.budgetMs}ms should be quicker than Sophomore ${sophomoreOpen.budgetMs}ms`,
  );
});

test('the stronger, more deliberate characters take longer', () => {
  const freshman = computeThinkingPlan(
    input({ fen: OPEN, bookMove: true, style: styleFor('freshman', 1250)! }),
  );
  const senior = computeThinkingPlan(
    input({ fen: OPEN, bookMove: true, style: styleFor('senior', 2250)! }),
  );
  assert.ok(
    senior.deliberationMs > freshman.deliberationMs,
    `senior ${senior.deliberationMs}ms should outlast freshman ${freshman.deliberationMs}ms`,
  );
});

test('a nearly flagged bot does not wait out a long beat', () => {
  const plan = computeThinkingPlan(
    input({ fen: OPEN, bookMove: true, clockMs: 1500, initialMs: 60_000 }),
  );
  assert.ok(plan.deliberationMs <= plan.budgetMs);
  assert.ok(plan.budgetMs <= 600);
});

test('a sharp position earns a longer think than a quiet one', () => {
  const quiet = computeThinkingPlan(input({ fen: START }));
  const sharp = computeThinkingPlan(input({ fen: TACTICAL }));
  assert.ok(sharp.budgetMs > quiet.budgetMs);
  assert.ok(sharp.searchMs + sharp.pauseMs <= sharp.budgetMs + 1);
});

test('the clock caps the budget, and the increment raises it', () => {
  const blitz = computeThinkingPlan(
    input({ fen: TACTICAL, clockMs: 60_000, initialMs: 60_000 }),
  );
  const classic = computeThinkingPlan(
    input({ fen: TACTICAL, clockMs: 600_000, initialMs: 600_000 }),
  );
  const incremental = computeThinkingPlan(
    input({ fen: TACTICAL, clockMs: 60_000, initialMs: 60_000, incrementMs: 5000 }),
  );

  assert.ok(blitz.budgetMs <= 1800, `60s left should not spend ${blitz.budgetMs}ms`);
  assert.ok(classic.budgetMs > blitz.budgetMs);
  assert.ok(incremental.budgetMs > blitz.budgetMs, 'increment is future time to spend');
  assert.ok(blitz.searchMs < 60_000);
});

test('a short clock produces a tiny budget and a low-clock reason', () => {
  const nearlyFlagged = computeThinkingPlan(
    input({ fen: TACTICAL, clockMs: 2000, initialMs: 60_000 }),
  );
  assert.equal(nearlyFlagged.reason, 'low-clock');
  assert.ok(nearlyFlagged.budgetMs <= 600, `2s on the clock spent ${nearlyFlagged.budgetMs}ms`);

  const emergency = computeThinkingPlan(
    input({ fen: TACTICAL, clockMs: 800, initialMs: 60_000 }),
  );
  assert.ok(emergency.budgetMs <= 120);
});

test('the budget never approaches the remaining clock', () => {
  for (const clockMs of [2000, 5000, 10_000, 30_000, 60_000, 180_000, 600_000]) {
    const plan = computeThinkingPlan(
      input({ fen: TACTICAL, clockMs, initialMs: Math.max(clockMs, 60_000) }),
    );
    assert.ok(plan.budgetMs < clockMs, `${clockMs}ms left → ${plan.budgetMs}ms budget`);
    assert.ok(plan.searchMs + plan.pauseMs <= plan.budgetMs + 1);
  }
});

test('the characters do not all think alike', () => {
  const freshman = computeThinkingPlan(
    input({ fen: START, style: styleFor('freshman', 1250)! }),
  );
  const junior = computeThinkingPlan(input({ fen: START, style: styleFor('junior', 2150)! }));
  assert.ok(junior.budgetMs > freshman.budgetMs, 'the methodical character takes longer');

  const senior = computeThinkingPlan(
    input({ fen: TACTICAL, style: styleFor('senior', 2250)! }),
  );
  const freshmanSharp = computeThinkingPlan(
    input({ fen: TACTICAL, style: styleFor('freshman', 1250)! }),
  );
  assert.ok(senior.budgetMs > freshmanSharp.budgetMs, 'the tactician lingers in a sharp position');
});

test('every plan is internally consistent', () => {
  for (const fen of [START, OPEN, TACTICAL, ENDGAME]) {
    for (const clockMs of [null, 3000, 60_000, 600_000]) {
      for (const bookMove of [true, false]) {
        const plan = computeThinkingPlan(
          input({ fen, clockMs, bookMove, initialMs: clockMs ?? 0, ply: 30 }),
        );
        assert.ok(plan.budgetMs > 0);
        assert.ok(plan.searchMs >= 0);
        assert.ok(plan.pauseMs >= 0);
        assert.ok(plan.deliberationMs >= 0);
        assert.ok(plan.deliberationMs <= plan.budgetMs + 1);
        assert.ok(plan.searchMs + plan.pauseMs <= plan.budgetMs + 1);
        if (bookMove) assert.equal(plan.searchMs, 0);
      }
    }
  }
});
