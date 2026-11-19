/**
 * Invariants of the shipped puzzle pools.
 *
 * These JSON files are exactly what a browser downloads, so the rules the ingest
 * script enforces are asserted here against the committed output: every band
 * (Elite included) has a manifest, its bounds are the band's served floor, and
 * every puzzle sits inside them, needs at least two solver moves and appears
 * once.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PUZZLE_TIER_BANDS, bandRatingFloor } from '../../src/puzzles/tiers.ts';
import { solutionMoveCount } from '../../src/puzzles/puzzleValidation.ts';
import { parseShardManifest, parseShardPayload } from '../../src/puzzles/shardPlan.ts';

for (const band of PUZZLE_TIER_BANDS) {
  test(`${band.slug} publishes a complete, harder pool`, async () => {
    const dir = new URL(`../../public/puzzles/${band.slug}/`, import.meta.url);
    const manifest = parseShardManifest(
      JSON.parse(await readFile(new URL('manifest.json', dir), 'utf8')),
    );

    const floor = bandRatingFloor(band);
    assert.equal(manifest.tier, band.slug);
    assert.equal(manifest.min_rating, floor, 'manifest starts at the served floor');
    assert.equal(manifest.max_rating, band.maxRating);
    assert.ok(manifest.count >= 1000, `${band.slug} only holds ${manifest.count} puzzles`);

    const ids = new Set<string>();
    for (const descriptor of manifest.shards) {
      const payload = parseShardPayload(
        JSON.parse(await readFile(new URL(descriptor.file, dir), 'utf8')),
        manifest,
        descriptor,
      );
      assert.equal(payload.skipped, 0, `${descriptor.file} has malformed rows`);

      for (const puzzle of payload.puzzles) {
        assert.ok(
          puzzle.rating >= floor && puzzle.rating <= band.maxRating,
          `${puzzle.puzzle_id} rating ${puzzle.rating} outside ${floor}–${band.maxRating}`,
        );
        assert.ok(
          solutionMoveCount(puzzle.moves.split(' ')) >= 2,
          `${puzzle.puzzle_id} is a one-move puzzle`,
        );
        assert.ok(!ids.has(puzzle.puzzle_id), `${puzzle.puzzle_id} appears twice`);
        ids.add(puzzle.puzzle_id);
      }
    }

    assert.equal(ids.size, manifest.count, 'manifest count matches the rows served');
  });
}
