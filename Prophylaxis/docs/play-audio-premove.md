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

One premove at a time, stored as `{ from, to, promotion? }` in hook state and
mirrored on the session for rendering. It is **not** persisted: the active-game
record has no premove field, so a reload never restores or executes one against
a position it was not chosen for.

Selection: while the opponent is to move, clicking (or dragging) one of your
pieces highlights it and its plausible destinations; choosing a destination
queues the move. `premoveTargets` generates those destinations by loading the
current FEN with your side to move, so blocked squares, castling and captures
behave normally. Nothing is applied: the FEN, SAN history, move list and clock
are untouched until execution.

The queued move is drawn as an overlay above the squares and below the
classification badges — dashed blue outlines on both squares plus a dashed
arrow, positioned by percentage and mirrored automatically for the black
orientation. It never covers a piece, and it scales with the board.

Cancellation: Escape; clicking any other square; selecting another piece;
choosing "Clear premove"; starting a new game; resigning, drawing or otherwise
finishing; leaving the board view. Cancelling never plays a sound.

Execution: after the bot's move is fully committed (SAN, session, clock,
persistence path), `commit` re-validates the premove with chess.js against the
new FEN and only then calls the normal commit path. That means an executed
premove gets ordinary clock charges, Fischer increment, last-move highlight,
PGN/history and the ordinary sound. If the move is no longer legal — piece
captured, line blocked, king exposed, destination changed — it is dropped
silently. A queued premove is cleared before the game-over check runs, so a bot
move that ends the game never executes it.

Engine and clock: queueing only writes interaction state. The bot keeps
searching, its clock is untouched, and the player's clock keeps running as it
always did. Execution in the same commit call avoids stale timers and extra
time. A game that has ended or been abandoned is guarded by the existing
`statusRef`/`gameIdRef` checks.

Promotion: a premove pawn reaching the last rank opens the existing promotion
picker, and the chosen piece is stored with the premove. If a promotion premove
somehow reaches execution without a piece, `resolvePremove` defaults to a queen.

Known limits: one premove only; no en-passant premoves (the target list clears
the en-passant square); a premove is dropped when the board view is left, by
design.
