# Play audio and premoves

Phase 4 adds two things to the Play room: the nine supplied MP3 cues and a
single queued premove. Both plug into the existing board, `usePlayGame` and the
appearance provider; no second board, engine or game-state store was added.

## Files

| File | Role |
| --- | --- |
| `public/sounds/*.mp3` | The nine supplied assets, original names. |
| `src/play/audio/soundEvents.ts` | Event names, file map, move classifier and priority, de-dupe window, allowed contexts. Pure. |
| `src/play/audio/soundSettings.ts` | Mute + volume schema, tolerant parser and storage. Pure. |
| `src/play/audio/soundManager.ts` | The only player: one reused `HTMLAudioElement` per cue, lazy creation, immediate volume, failure handling. |
| `src/services/soundService.ts` | Thin adapter kept for older call sites (`playSound('move')`); mute/volume live in the manager. |
| `src/play/premove.ts` | Pure premove rules: targets, promotion need, re-validation, equality. |
| `src/play/usePlayGame.ts` | Emits the move/end/premove cues and owns the queued premove and its execution. |
| `src/components/ChessBoardWrapper.tsx` | Selects a premove during the opponent's turn and draws it; can mute its own move cues. |
| `src/components/play/CurrentGameView.tsx` | Wires premove state, the clear button and the status line. |
| `src/theme/ThemeProvider.tsx`, `SettingsDrawer.tsx` | Persisted volume beside the existing mute switch. |

## What plays when

One move produces exactly one cue, chosen in `classifyMoveSound`:

1. game completion (`game-end`)
2. promotion (`promote`)
3. castling (`castle`)
4. check (`move-check`)
5. capture (`capture`, including en passant)
6. ordinary move (`move-self` / `move-opponent`)

The Play room turns off the board's own move feedback (`soundFeedback: false`)
and lets `usePlayGame` classify, because only the hook knows who moved and
whether the move ended the game. A mating move therefore plays `game-end`
once, from `finish`, and never also a capture or check cue.

`premove.mp3` plays when a premove is queued, never when it executes. Execution
is an ordinary move and gets an ordinary cue. `illegal.mp3` still plays when a
direct move attempt is rejected; cancellation of a premove is silent.

Reviewing speaks too, one move at a time: stepping a single ply in the in-game
move browser (`usePlyBrowser`) or in Game Review plays the cue that move made
live - capture, check, castle, promotion or a plain move, in the mover's own
self/opponent voice (`replayPlySound` classifies it from the position before the
ply). `Home`/`End` and clicking a distant move are navigation across several
plies, so they stay quiet, and a move arriving live is sounded by the game's own
hook rather than by the browser. Those boards keep `soundFeedback: false` so the
cue comes from the ply data, which knows whose move it was.

Silent by policy: board initialisation, restoring a saved game, PGN import,
engine analysis, orientation changes and evaluation updates.

## Audio settings

`soundSettings.ts` stores `{ muted, volume }` as JSON under
`chess-trainer.sound.settings.v1`. The old mute-only key is read once when the
new blob is absent, so an existing mute choice survives the upgrade. Volume is
clamped to 0–1 and rounded to two decimals.

`ThemeProvider` exposes `soundOn`, `soundVolume`, `setSoundOn` and
`setSoundVolume`; the settings drawer shows the switch and a 0–100 slider.
Every change is written immediately and applied to all cached audio elements,
so dragging the slider is audible while the panel is open. Muting sets volume
to zero on every element; no cue is even attempted.

The manager creates elements lazily and caches one per event. A repeated cue
rewinds instead of layering, and identical cues within 90ms are treated as one
event. Playback failures — autoplay refusal, a missing file, a decode error —
are swallowed; that cue is disabled and the game is unaffected. The first
pointer or key press primes the cache.

## Premoves

A queue of up to `MAX_PREMOVES` (5), stored as `{ from, to, promotion? }` and
mirrored on the session for rendering. It is **not** persisted: the active-game
record has no premove field, so a reload never restores or executes one against
a position it was not chosen for.

**Targets are geometric, not legal.** `geometricTargets` reads the piece's
movement pattern and nothing else: a rook, bishop or queen runs a ray to the
edge of the board through any blocker, a knight offers all eight jumps, a pawn
gets both pushes and both forward diagonals whether or not anything stands
there, and a king may step onto an attacked square. `premoveTargets` adds
castling when the rook is still on its corner. Own pieces are legal
destinations and do not block — that is how a recapture is queued onto the piece
about to be taken, and how a premove lands on top of one of your own pieces.
Legality is decided when the move fires.

**The board draws the queue by moving the pieces.** `premoveDisplayFen` applies
the queue to a *copy* of the placement: each piece sits on its target
immediately, an en-passant premove removes the pawn beside it, castling moves
the rook too, and a pawn reaching the last rank is drawn as a queen. The side to
move is left as it is, so the board still knows it is the opponent's turn; the
board is told `premovesProjected` so a chained premove can be picked up from the
projected square instead of being projected twice. The real FEN, SAN history,
move list and clock are untouched.

**Marks.** `PersistentBoard.css` paints `.board-premove__square--from/--to` in
chess.com red — the square the piece left and the square it went to, the
destination the stronger of the two — as an overlay above the square fills that
scales with the board and mirrors with the orientation. The head of the queue
is opaque, later entries are dimmed.

Cancellation: right-click anywhere on the board, Escape, clicking an empty
square, choosing "Clear premove", starting a new game, resigning, drawing or
finishing. Cancelling never plays a sound. When the opponent's move makes the
**head** illegal the whole queue is dropped (`resolvePremoveQueue`), because
every move behind it was chosen on the assumption it would be played.

Execution: after the bot's move is fully committed, `resolvePremoveQueue`
re-validates the head with chess.js against the new FEN and plays it through the
normal commit path, one premove per opponent reply. An executed premove gets
ordinary clock charges, increment, last-move highlight, PGN/history and sound,
plus the premove cost: `PREMOVE_CLOCK_COST_MS` (0.1s) is taken by
`ChessClock.penalize`, which banks the running time first so nothing is charged
twice. A clock with nothing to spend freezes at 0.1s and the premove does not
fire — the player moves by hand.

Promotion: a premove to the last rank needs no picker. `needsPromotion` detects
it and `resolvePremove` promotes to a queen (`DEFAULT_PROMOTION`), so a time
scramble never opens a modal.

Setting: `src/play/premovePrefs.ts` persists "Enable premoves" (default on)
and the settings drawer exposes it as a switch. With it off the board never
enters the premove state — `premoveColor` is null and no queue is drawn or
played.

Known limits: tapping the premoved piece to cancel is not wired (tapping an
empty square, Escape or right-click clears the queue); a premove onto one of
your own pieces shows the premoving piece on top rather than both, because a FEN
holds one piece per square.
