/**
 * New Game layout contracts.
 *
 * There is no browser in this test run, so these are static checks on the
 * stylesheet and the setup view: the time-control row is a reflowing grid of
 * equal-height options, the summary panel is sticky inside its own scrollport on
 * desktop and static on narrow screens, and no "Big 4" label survives anywhere
 * in the source.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { OPPONENT_CATEGORIES, PERSONALITY_OPPONENTS } from '../../src/play/opponents.ts';
import { TIME_CONTROL_PRESETS } from '../../src/play/timeControls.ts';

const css = readFileSync('src/components/play/play.css', 'utf8');
const view = readFileSync('src/components/play/NewGameView.tsx', 'utf8');

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} is defined`);
  const end = css.indexOf('}', start);
  return css.slice(start, end);
}

function media(query: string): string {
  const start = css.indexOf(`@media ${query}`);
  assert.ok(start >= 0, `${query} block exists`);
  /* The block runs to the next top-level @media or the end of the sheet. */
  const next = css.indexOf('\n@media ', start + 1);
  return css.slice(start, next === -1 ? css.length : next);
}

test('time controls spread across the panel instead of a cramped chip row', () => {
  const times = rule('.play-times');
  assert.match(times, /grid-template-columns:\s*repeat\(auto-fit, minmax\(184px, 1fr\)\)/);
  assert.match(times, /gap:/);

  const group = rule('.play-timegroup');
  assert.match(group, /flex-direction:\s*column/, 'category label above its presets');

  const buttons = rule('.play-time');
  assert.match(buttons, /flex:\s*1 1 auto/, 'presets share their column evenly');
  assert.match(buttons, /text-align:\s*center/);
  assert.match(buttons, /min-width:\s*\d+px/, 'no shrunken, clipped labels');

  /* The narrow layout stacks the categories instead of squeezing them. */
  assert.match(media('(max-width: 720px)'), /\.play-times \{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);

  /* Every preset is still offered, grouped by category. */
  assert.equal(TIME_CONTROL_PRESETS.length, 8);
  const categories = new Set(TIME_CONTROL_PRESETS.map((control) => control.category));
  assert.deepEqual([...categories].sort(), ['blitz', 'bullet', 'rapid']);
  assert.match(view, /TIME_CONTROL_PRESETS\.filter/, 'presets are rendered from the shared list');
  assert.match(view, /UNTIMED_ID/, 'untimed is still offered');
  assert.match(view, /CUSTOM_ID/, 'custom time and increment are still offered');
});

test('the New Game panel is sticky on desktop only', () => {
  const base = rule('.play-setup');
  assert.match(base, /minmax\(300px, 348px\)/, 'the summary stays the right-hand column');
  assert.doesNotMatch(base, /overflow-y:\s*auto/, 'no nested scroller outside the frame');

  /* Pinning lives in the frame-width layer only, where the shell stops scrolling. */
  const desktop = media('(min-width: 1150px)');
  const setup = /[.]play-setup \{([^}]*)\}/.exec(desktop)?.[1] ?? '';
  assert.match(setup, /overflow-y:\s*auto/, 'the setup screen is its own scrollport');
  assert.match(setup, /flex:\s*1 1 auto/);
  assert.match(setup, /min-height:\s*0/);

  const preview = /[.]play-preview \{([^}]*)\}/.exec(desktop)?.[1] ?? '';
  assert.match(preview, /align-self:\s*stretch/, 'room to travel while scrolling');

  const card = /[.]play-preview__card \{([^}]*)\}/.exec(desktop)?.[1] ?? '';
  assert.match(card, /position:\s*sticky/);
  assert.match(card, /top:\s*2px/, 'it pins below the tab strip, not over it');
  assert.match(card, /max-height:\s*calc\(100dvh/, 'short windows scroll the card, not the page');

  assert.doesNotMatch(
    rule('.play-preview__card'),
    /position:\s*sticky/,
    'in flow by default, so narrow screens simply scroll past it',
  );

  const narrow = media('(max-width: 1149px)');
  assert.match(narrow, /\.play \{[^}]*width:\s*100%/, 'the room cannot outgrow the column');
});

test('the General Bot leads the list in its own headed section', () => {
  const general = view.indexOf('play-tier--general');
  const ladder = view.indexOf('OPPONENT_CATEGORIES.map');
  assert.ok(general > 0, 'the general section exists');
  assert.ok(ladder > 0, 'the ladder groups still render');
  assert.ok(general < ladder, 'the custom engine comes before every ladder group');

  /* Its choice row lives inside that section, not after the last tier. */
  const section = view.slice(general, ladder);
  assert.match(section, /play-engine__choice/);
  assert.match(section, /play-bot-range/);
  assert.match(section, /play-tier__head/);

  /* The row no longer carries the divider it used to need at the bottom. */
  assert.doesNotMatch(rule('.play-engine'), /border-top/);
});

test('each category has opponents and the Big 4 is the featured group', () => {
  for (const group of OPPONENT_CATEGORIES) {
    assert.ok(
      PERSONALITY_OPPONENTS.some((opponent) => opponent.category === group.id),
      `${group.label} has at least one card`,
    );
  }
  assert.equal(OPPONENT_CATEGORIES.find((group) => group.id === 'big-4')?.label, 'The Big 4');

  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        if (entry === 'node_modules') continue;
        walk(path);
        continue;
      }
      if (!/\.(ts|tsx|css)$/.test(entry)) continue;
      if (/big-3/i.test(readFileSync(path, 'utf8'))) offenders.push(path);
    }
  };
  walk('src');
  assert.deepEqual(offenders, [], 'no stale Big 3 references in the app');
});
