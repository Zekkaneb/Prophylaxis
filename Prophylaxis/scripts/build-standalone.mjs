#!/usr/bin/env node
/**
 * Builds `opening-lab.html` — the whole app in one file.
 *
 * `vite build --minify false` produces `dist/index.html` plus an unminified JS
 * bundle, an unminified stylesheet, the piece SVGs, the opening book and the
 * engine. This script folds all of it into a single HTML document, ordered and
 * labelled so it reads top to bottom:
 *
 *   1. the stylesheet, inlined as `<style>` in the head
 *   2. a notice that appears when the file is opened straight from disk
 *   3. the app bundle, inlined as `<script type="module">`
 *   4. the embedded assets — every `public/` file as a data URL in
 *      `window.__ASSETS__` (see `src/assets/assetUrl.ts`), plus the engine
 *      worker source as text in `window.__ASSETS_TEXT__`
 *
 * Long strings (base64 images, the 1.8 MB engine wasm, the opening book) are
 * split into short concatenated chunks, so no part of the file is one huge
 * line. Run it through `npm run build:single`; it reads `dist/`, never the
 * sources.
 */

import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const outFile = path.join(root, 'opening-lab.html');

const MIME = {
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
};

/** Files inlined as text so they can be executed rather than fetched. */
const TEXT_ASSETS = new Set(['stockfish/sf19/stockfish.js']);

/** Characters per line inside an embedded asset string. */
const CHUNK = 96;

/** Recursively lists files under `dir`, returned as posix paths relative to it. */
async function walk(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full, base)));
    } else if (entry.isFile()) {
      files.push(path.relative(base, full).split(path.sep).join('/'));
    }
  }
  return files;
}

function dataUrl(mime, buffer) {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

/**
 * Published puzzle shards live in `public/puzzles/{tier}/…` and are fetched
 * over HTTP at runtime. They must NOT be inlined: a 5,000-per-tier pool would
 * add ~14 MB of base64 to the single-file build. Only the *legacy* tier files
 * (`puzzles/{tier}.json`) stay inline-able — they are the offline fallback.
 */
const SHARD_DIRECTORY = /^puzzles\/[^/]+\//;

/** Every file `dist/` would serve statically, keyed the way `assetUrl` looks it up. */
async function collectAssets() {
  const urls = {};
  const text = {};
  let bytes = 0;
  let skippedShards = 0;

  for (const rel of await walk(dist)) {
    if (rel === 'index.html' || rel.startsWith('assets/')) continue;
    if (SHARD_DIRECTORY.test(rel)) {
      skippedShards += 1;
      continue;
    }

    const buffer = await readFile(path.join(dist, rel));
    const ext = path.extname(rel).toLowerCase();

    if (TEXT_ASSETS.has(rel)) {
      text[rel] = buffer.toString('utf8');
    } else if (MIME[ext]) {
      urls[rel] = dataUrl(MIME[ext], buffer);
      bytes += buffer.byteLength;
    }
  }

  return { urls, text, bytes, skippedShards };
}

/** A label comment, so each section is obvious when scrolling the file. */
function label(title, note) {
  const rule = '═'.repeat(72);
  const lines = [`<!-- ${rule}`, `     ${title}`, ...(note ? ['', ...note.split('\n').map((l) => `     ${l}`)] : []), `     ${rule} -->`];
  return lines.join('\n');
}

/**
 * Writes `window.__ASSETS__['key'] = ["…", "…"].join('')` with the value broken
 * into short string literals. Chunks are escaped individually, so a split can
 * never land in the middle of an escape sequence, and `join` keeps the build-up
 * linear — a chain of `+` across the 2.4 MB engine string froze the page on
 * load instead of just looking untidy.
 */
function assetAssignment(target, key, value) {
  const chunks = [];
  for (let i = 0; i < value.length; i += CHUNK) chunks.push(value.slice(i, i + CHUNK));

  const head = `${target}[${JSON.stringify(key)}] = `;
  if (chunks.length <= 1) return `${head}${JSON.stringify(chunks[0] ?? '')};`;

  const body = chunks.map((chunk) => `    ${JSON.stringify(chunk)}`).join(',\n');
  return `${head}[\n${body},\n  ].join('');`;
}

function escapeForMarkup(source, tag) {
  // A literal `</script` / `</style` inside the source would end the tag early.
  return source.replace(new RegExp(`</${tag}`, 'gi'), `<\\/${tag}`);
}

const { urls, text, bytes, skippedShards } = await collectAssets();

let html = await readFile(path.join(dist, 'index.html'), 'utf8');

/* --- 1 · stylesheet ------------------------------------------------------ */

const stylesheet = html.match(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+\.css)"[^>]*>/i);
if (!stylesheet) throw new Error('No stylesheet in dist/index.html — did the build run?');
const css = await readFile(path.join(dist, stylesheet[1]), 'utf8');
const cssBlock =
  `  ${label(
    '1 of 4 · Styles',
    'Every stylesheet in src/, concatenated and unminified by Vite. This is the\n' +
      'place to look when changing appearance.',
  )}\n` +
  `  <style>\n${escapeForMarkup(css, 'style')}\n  </style>`;

/* --- 3 · app bundle ----------------------------------------------------- */

const script = html.match(/<script[^>]+src="([^"]+\.js)"[^>]*><\/script>/i);
if (!script) throw new Error('No JS bundle in dist/index.html — did the build run?');
const js = await readFile(path.join(dist, script[1]), 'utf8');
const jsBlock =
  `  ${label(
    '3 of 4 · The application',
    'The compiled app, bundled from src/ by Vite with minification off. Names and\n' +
      'formatting are preserved, but modules are flattened into one scope, so this\n' +
      'is for reading rather than editing — change src/ and rebuild.',
  )}\n` +
  `<script type="module">\n${escapeForMarkup(js, 'script')}\n</script>`;

/* --- 4 · embedded assets ------------------------------------------------ */

const manifest = [
  label(
    '4 of 4 · Embedded assets',
    `${Object.keys(urls).length + Object.keys(text).length} files normally served from public/, embedded as data URLs (images,\n` +
      'opening book, engine wasm) so the page needs no sibling files. This section\n' +
      'holds most of the megabytes, which is why it sits at the very end.\n\n' +
      'Published puzzle shards (puzzles/{tier}/…) are deliberately NOT inlined:\n' +
      'they are downloaded over http by the manifest-aware seeder. Offline from\n' +
      'file:// the app uses the inlined legacy tier file, or the mock pool.',
  ),
  '<script>',
  '(function () {',
  '  window.__ASSETS__ = {};',
  ...Object.keys(urls).map((key) => `  ${assetAssignment('window.__ASSETS__', key, urls[key])}`),
  '',
  '  // Plain-text sources that have to be executed (the Stockfish worker glue).',
  '  window.__ASSETS_TEXT__ = {};',
  ...Object.keys(text).map((key) => `  ${assetAssignment('window.__ASSETS_TEXT__', key, text[key])}`),
  '',
  '  // The tab icon, taken from the map above so the SVG is not stored twice.',
  "  if (window.__ASSETS__['favicon.svg']) {",
  "    var icon = document.createElement('link');",
  "    icon.rel = 'icon';",
  "    icon.type = 'image/svg+xml';",
  "    icon.href = window.__ASSETS__['favicon.svg'];",
  '    document.head.appendChild(icon);',
  '  }',
  '})();',
  '</script>',
].join('\n');

/* --- 2 · file:// notice ------------------------------------------------- */

const NOTICE_STYLE = [
  '  #disk-warning {',
  '    position: relative;',
  '    z-index: 9999;',
  '    background: #2a2113;',
  '    color: #f3e6cf;',
  "    border-bottom: 1px solid #6d5a33;",
  "    font: 15px/1.55 system-ui, -apple-system, 'Segoe UI', sans-serif;",
  '  }',
  '  #disk-warning[hidden] { display: none; }',
  '  .disk-warning-inner { max-width: 68ch; margin: 0 auto; padding: 22px 24px 26px; }',
  '  #disk-warning h2 { margin: 0 0 10px; font-size: 17px; color: #ffd79a; }',
  '  #disk-warning p { margin: 0 0 8px; }',
  '  #disk-warning ul { margin: 0 0 10px; padding-left: 20px; }',
  '  #disk-warning li { margin-bottom: 5px; }',
  '  #disk-warning pre {',
  '    margin: 0 0 8px;',
  '    padding: 10px 12px;',
  '    background: #191307;',
  '    border: 1px solid #4a3d22;',
  '    border-radius: 6px;',
  '    overflow-x: auto;',
  '  }',
  "  #disk-warning code { font-family: ui-monospace, 'Cascadia Code', Consolas, monospace; font-size: 13px; }",
  '  .disk-warning-alt { color: #d8c6a6; font-size: 14px; }',
  '  #disk-warning-dismiss {',
  '    margin-top: 6px;',
  '    padding: 7px 14px;',
  '    background: #ffd79a;',
  '    color: #2a2113;',
  '    border: 0;',
  '    border-radius: 6px;',
  '    font: inherit;',
  '    font-weight: 600;',
  '    cursor: pointer;',
  '  }',
  '  #disk-warning-dismiss:hover { background: #ffe7bf; }',
];

const notice = [
  label(
    '2 of 4 · Opened from disk?',
    'Browsers block storage and workers on file:// pages, which disables saving and\n' +
      'the engine. The banner below says so and is hidden when the page is served\n' +
      'over http. Nothing else in the app depends on it.',
  ),
  `<div id="disk-warning" hidden>
  <div class="disk-warning-inner">
    <h2>Opened straight from disk — saving and the engine are switched off</h2>
    <p>This page is running from a <code>file://</code> address. Browsers refuse two things there:</p>
    <ul>
      <li><strong>Browser storage (IndexedDB)</strong> — courses you add, chapter progress and
        settings will not be saved, and anything already saved in a served copy is not visible.</li>
      <li><strong>The Stockfish engine worker</strong> — Game Review analysis and engine hints stay
        unavailable, because the engine cannot load from a file.</li>
    </ul>
    <p>Everything else works: browsing the library, replaying chapters, quizzes and puzzles.</p>
    <p><strong>For the full app,</strong> serve the file over http — in a terminal next to it:</p>
    <pre>npx serve opening-lab.html</pre>
    <p class="disk-warning-alt">
      or <code>python -m http.server 8000</code>, then open the <code>http://localhost:…</code>
      address it prints. In VS Code, the Live Preview extension’s “Show preview” does the same.
    </p>
    <button type="button" id="disk-warning-dismiss">Keep browsing anyway</button>
  </div>
</div>`,
  '<style>',
  ...NOTICE_STYLE,
  '</style>',
  `<script>
  (function () {
    if (location.protocol !== 'file:') return;
    var banner = document.getElementById('disk-warning');
    banner.hidden = false;
    document.getElementById('disk-warning-dismiss').addEventListener('click', function () {
      banner.hidden = true;
    });
  })();
</script>`,
].join('\n');

/* --- assemble the document ---------------------------------------------- */

// Take the pieces out of their build positions; the sections below put them
// back in reading order.
html = html.replace(/\s*<link[^>]+rel="stylesheet"[^>]*href="[^"]+\.css"[^>]*>/i, () => '');
html = html.replace(/\s*<script[^>]+src="[^"]+\.js"[^>]*><\/script>/i, () => '');
html = html.replace(/\s*<link[^>]+rel="icon"[^>]*>/i, () => '');

// 1 · styles in the head
html = html.replace('</head>', () => `${cssBlock}\n  </head>`);

// 2 · notice at the top of the body, 3 · app right after the mount point
html = html.replace('<body>', () => `<body>\n${notice}`);
html = html.replace(/<div id="root"><\/div>/, () => `<div id="root"></div>\n${jsBlock}`);

// 4 · assets last
html = html.replace('</body>', () => `\n${manifest}\n</body>`);

const header =
  '<!--\n' +
  '  Opening Lab — Repertoire & tactics trainer, packaged as one file.\n\n' +
  '  Sections, in file order:\n' +
  '    1 of 4  stylesheet\n' +
  '    2 of 4  notice shown when the file is opened from disk\n' +
  '    3 of 4  the application (unminified bundle)\n' +
  '    4 of 4  embedded assets (images, opening book, engine)\n\n' +
  '  Generated by scripts/build-standalone.mjs from src/. Do not hand-edit the\n' +
  '  build output; change the source and run `npm run build:single`.\n' +
  '-->\n';
html = html.replace('<!doctype html>', () => `<!doctype html>\n${header}`);

await writeFile(outFile, html, 'utf8');

const { size } = await stat(outFile);
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
const lines = html.split('\n');
console.log(
  `opening-lab.html — ${mb(size)}, ${lines.length.toLocaleString()} lines ` +
    `(js ${mb(Buffer.byteLength(js))}, css ${mb(Buffer.byteLength(css))}, ` +
    `${Object.keys(urls).length + Object.keys(text).length} assets ${mb(bytes)}` +
    (skippedShards ? `, ${skippedShards} puzzle shards kept out (served over http)` : '') +
    ')',
);
/* A reduce, not a spread: the file has more lines than the argument limit. */
const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
console.log(`longest line: ${longest.toLocaleString()} chars`);
