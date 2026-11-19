# archive/

Kept for reference only — nothing here is built, imported or served.

## `legacy-static-app.tar.gz`

A tarball of `Zekkaneb.github.io-main/`, the original static/vanilla-JS version of
this app (before the React + TypeScript rewrite). It used to sit inside the project
root as a second, nested copy of the application, which made the repository look
like two projects and confused tooling, editors and searches.

The active codebase now lives in exactly one place:

```
src/          application (React + TS)
public/       static assets (pieces, Stockfish, opening book)
scripts/      build-time tooling
learn/        the PGN parser course
archive/      this folder — reference material only
```

Everything worth keeping from the legacy app has already been ported:

| Legacy file | Where it lives now |
| --- | --- |
| `pgn-parser.js` | `src/pgn/` (typed, tested — see `learn/`) |
| `chess-engine.js` | `src/engine/` + `chess.js` |
| `storage.js`, `backup.js` | `src/db.ts` (Dexie), `src/services/backupService.ts` |
| `study.js`, `practice.js` | `src/lessons/`, `src/components/OpeningLessonPlayer.tsx` |
| `spaced-repetition.js`, `sidelines.js` | `src/puzzles/` |

Restore or inspect it with:

```bash
tar -xzf archive/legacy-static-app.tar.gz
```

Safe to delete once you are satisfied nothing is missing.
