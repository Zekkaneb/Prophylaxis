/**
 * Resolution of files that normally live in `public/`.
 *
 * The app ships assets as separate files: `${BASE_URL}pieces/…`,
 * `openings.json`, the engine worker. The single-file build
 * (`npm run build:single`) inlines every one of them as a data URL and injects
 * the maps as `window.__ASSETS__` / `window.__ASSETS_TEXT__` before the app
 * starts, so these call sites work unchanged from a `file://` page that has no
 * sibling files next to it.
 */

type AssetMap = Record<string, string>;

const inlineAssets: AssetMap =
  (globalThis as { __ASSETS__?: AssetMap }).__ASSETS__ ?? {};

/** Inlined source text for assets that have to be executed, not just fetched. */
const inlineText: Record<string, string> =
  (globalThis as { __ASSETS_TEXT__?: AssetMap }).__ASSETS_TEXT__ ?? {};

/** `pieces/neo/wK.svg` and `/pieces/neo/wK.svg` name the same asset. */
function normalize(path: string): string {
  return path.replace(/^\.?\//, '');
}

/** URL for a bundled asset: the inlined copy when present, else the served file. */
export function assetUrl(path: string): string {
  const key = normalize(path);
  return inlineAssets[key] ?? `${import.meta.env.BASE_URL}${key}`;
}

/** Source text of a bundled script (the engine worker), when it was inlined. */
export function assetText(path: string): string | null {
  return inlineText[normalize(path)] ?? null;
}
