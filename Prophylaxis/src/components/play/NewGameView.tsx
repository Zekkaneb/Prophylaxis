import { useMemo, useState } from 'react';
import {
  GENERAL_BOT,
  GENERAL_BOT_ELO,
  OPPONENT_CATEGORIES,
  PERSONALITY_OPPONENTS,
  opponentFullName,
  opponentStage,
  profileFromRecord,
  withElo,
  type OpponentProfile,
} from '../../play/opponents.ts';
import {
  CATEGORY_LABELS,
  CUSTOM_ID,
  TIME_CONTROL_PRESETS,
  UNTIMED_ID,
  formatClock,
  formatTimeControl,
  timeControlLabel,
  validateCustomTime,
} from '../../play/timeControls.ts';
import { recoverClock } from '../../play/clock.ts';
import { humanCalibration } from '../../play/humanStrength.ts';
import type { ActiveGameRecord, ColorChoice, GameConfig } from '../../play/types.ts';
import { OpponentAvatar } from './OpponentAvatar';

const COLOR_OPTIONS: Array<{ id: ColorChoice; label: string; hint: string }> = [
  { id: 'w', label: 'White', hint: 'Move first' },
  { id: 'b', label: 'Black', hint: 'Reply to White' },
  { id: 'random', label: 'Random', hint: 'Chosen at start' },
];

const TIME_GROUPS = ['bullet', 'blitz', 'rapid'] as const;

export interface NewGameViewProps {
  hasLiveGame: boolean;
  resumable: ActiveGameRecord | null;
  resumeError: string | null;
  onStart: (opponent: OpponentProfile, config: GameConfig) => void;
  onResume: () => void;
  onAbandon: () => void;
  onDismissResumeError: () => void;
}

/**
 * Setup screen: colour and clock first, then the opponent. No board here — the
 * portraits, the selection summary and the start control are the whole surface.
 * Players pick how they want to play before they pick who they play.
 */
export function NewGameView({
  hasLiveGame,
  resumable,
  resumeError,
  onStart,
  onResume,
  onAbandon,
  onDismissResumeError,
}: NewGameViewProps) {
  const [opponentId, setOpponentId] = useState<string>(PERSONALITY_OPPONENTS[0]?.id ?? 'freshman');
  const [generalElo, setGeneralElo] = useState<number>(GENERAL_BOT.elo);
  const generalCalibration = humanCalibration(generalElo);
  const generalErrorPct = Math.round(generalCalibration.errorRate * 100);
  const [color, setColor] = useState<ColorChoice>('random');
  const [timeId, setTimeId] = useState<string>('5+0');
  const [customMinutes, setCustomMinutes] = useState('5');
  const [customIncrement, setCustomIncrement] = useState('3');
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [confirmAbandon, setConfirmAbandon] = useState(false);

  const isGeneral = opponentId === GENERAL_BOT.id;
  const selected: OpponentProfile = isGeneral
    ? withElo(GENERAL_BOT, generalElo)
    : (PERSONALITY_OPPONENTS.find((opponent) => opponent.id === opponentId) ??
      PERSONALITY_OPPONENTS[0]);

  const custom = useMemo(
    () => validateCustomTime(customMinutes, customIncrement),
    [customMinutes, customIncrement],
  );

  const preset = TIME_CONTROL_PRESETS.find((control) => control.id === timeId);

  const timeLabel = useMemo(() => {
    if (timeId === UNTIMED_ID) return 'Untimed';
    if (timeId === CUSTOM_ID) {
      return custom.ok
        ? formatTimeControl(custom.initialSeconds, custom.incrementSeconds)
        : 'Custom';
    }
    return preset?.id ?? timeId;
  }, [custom, preset, timeId]);

  const colorLabel = COLOR_OPTIONS.find((option) => option.id === color)?.label ?? 'Random';
  const canStart = timeId !== CUSTOM_ID || custom.ok;
  const hasUnfinished = hasLiveGame || Boolean(resumable);

  const resumeProfile = resumable ? profileFromRecord(resumable) : null;
  /* Matches what resume will restore: the player's clock kept running away. */
  const resumeClock = useMemo(() => {
    if (!resumable || resumable.untimed) return null;
    const recovered = recoverClock(
      {
        whiteMs: resumable.white_ms,
        blackMs: resumable.black_ms,
        active: resumable.active_clock,
        started: resumable.clock_started,
        paused: resumable.paused,
        savedAt: resumable.last_sync_at,
      },
      { now: Date.now(), chargeSide: resumable.player_color },
    );
    return formatClock(
      resumable.player_color === 'w' ? recovered.whiteMs : recovered.blackMs,
    );
  }, [resumable]);

  function handleStart(force = false) {
    if (hasUnfinished && !force) {
      setConfirmRestart(true);
      return;
    }
    setConfirmRestart(false);

    let config: GameConfig;

    if (timeId === UNTIMED_ID) {
      config = {
        color,
        timeControlId: UNTIMED_ID,
        initialSeconds: 0,
        incrementSeconds: 0,
        untimed: true,
      };
    } else if (timeId === CUSTOM_ID) {
      const result = validateCustomTime(customMinutes, customIncrement);
      if (!result.ok) return;
      config = {
        color,
        timeControlId: `${CUSTOM_ID}-${result.initialSeconds}+${result.incrementSeconds}`,
        initialSeconds: result.initialSeconds,
        incrementSeconds: result.incrementSeconds,
        untimed: false,
      };
    } else {
      const control = TIME_CONTROL_PRESETS.find((entry) => entry.id === timeId);
      if (!control) return;
      config = {
        color,
        timeControlId: control.id,
        initialSeconds: control.initialSeconds,
        incrementSeconds: control.incrementSeconds,
        untimed: false,
      };
    }

    onStart(selected, config);
  }

  return (
    <div className="play-setup">
      {resumable && resumeProfile ? (
        <div className="play-resume" role="status">
          <OpponentAvatar opponent={resumeProfile} size="md" loading="eager" />
          <div className="play-resume__body">
            <p className="play-eyebrow">Unfinished game</p>
            <p className="play-resume__title">
              Resume your game against {resumeProfile.name}
            </p>
            <p className="play-resume__meta">
              {opponentStage(resumeProfile) ? `${opponentStage(resumeProfile)} · ` : ''}
              {resumable.player_color === 'w' ? 'White' : 'Black'} ·{' '}
              {timeControlLabel(resumable.initial_seconds, resumable.increment_seconds)} ·{' '}
              {resumable.sans.length} {resumable.sans.length === 1 ? 'move' : 'moves'}
              {resumeClock ? ` · your clock ≈ ${resumeClock}` : ''}
            </p>
          </div>

          {confirmAbandon ? (
            <div className="play-resume__actions">
              <span className="play-resume__warning">Abandon without saving?</span>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => {
                  setConfirmAbandon(false);
                  onAbandon();
                }}
              >
                Abandon
              </button>
              <button
                type="button"
                className="play-link"
                onClick={() => setConfirmAbandon(false)}
              >
                Keep it
              </button>
            </div>
          ) : (
            <div className="play-resume__actions">
              <button type="button" className="primary-btn" onClick={onResume}>
                Resume game
              </button>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => setConfirmAbandon(true)}
              >
                Abandon
              </button>
            </div>
          )}
        </div>
      ) : null}

      {hasLiveGame && !resumable ? (
        <div className="play-resume play-resume--live" role="status">
          <span className="play-resume__live-dot" aria-hidden="true" />
          <div className="play-resume__body">
            <p className="play-eyebrow">Game in progress</p>
            <p className="play-resume__title">Your board is still open</p>
          </div>
          <div className="play-resume__actions">
            <button type="button" className="primary-btn" onClick={onResume}>
              Back to the board
            </button>
          </div>
        </div>
      ) : null}

      {resumeError ? (
        <div className="play-error" role="alert">
          <span>{resumeError}</span>
          <button type="button" onClick={onDismissResumeError} aria-label="Dismiss message">
            ×
          </button>
        </div>
      ) : null}

      <div className="play-setup__main">
        <section className="play-block" aria-labelledby="play-game-title">
          <div className="play-block__head">
            <p className="play-eyebrow">01 — Game</p>
            <h2 id="play-game-title">Colour and clock</h2>
          </div>

          <div className="play-field">
            <span className="play-field__label">Play as</span>
            <div className="play-segment" role="group" aria-label="Your colour">
              {COLOR_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={color === option.id}
                  className={`play-segment__option${color === option.id ? ' is-selected' : ''}`}
                  onClick={() => setColor(option.id)}
                >
                  <span>{option.label}</span>
                  <small>{option.hint}</small>
                </button>
              ))}
            </div>
          </div>

          <div className="play-field">
            <span className="play-field__label">Time control</span>
            <div className="play-times">
              {TIME_GROUPS.map((group) => (
                <div key={group} className="play-timegroup">
                  <span className="play-timegroup__label">{CATEGORY_LABELS[group]}</span>
                  <div className="play-timegrid">
                    {TIME_CONTROL_PRESETS.filter((control) => control.category === group).map(
                      (control) => (
                        <button
                          key={control.id}
                          type="button"
                          aria-pressed={timeId === control.id}
                          className={`play-time${timeId === control.id ? ' is-selected' : ''}`}
                          onClick={() => setTimeId(control.id)}
                        >
                          {control.id}
                        </button>
                      ),
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="play-times-extra">
              <button
                type="button"
                aria-pressed={timeId === UNTIMED_ID}
                className={`play-time${timeId === UNTIMED_ID ? ' is-selected' : ''}`}
                onClick={() => setTimeId(UNTIMED_ID)}
              >
                Untimed
              </button>
              <button
                type="button"
                aria-pressed={timeId === CUSTOM_ID}
                className={`play-time${timeId === CUSTOM_ID ? ' is-selected' : ''}`}
                onClick={() => setTimeId(CUSTOM_ID)}
              >
                Custom
              </button>
            </div>

            {timeId === CUSTOM_ID ? (
              <div className="play-custom">
                <label className="play-custom__field">
                  <span>Minutes</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={180}
                    step={1}
                    value={customMinutes}
                    onChange={(event) => setCustomMinutes(event.target.value)}
                  />
                </label>
                <span className="play-custom__plus" aria-hidden="true">
                  +
                </span>
                <label className="play-custom__field">
                  <span>Increment (s)</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={60}
                    step={1}
                    value={customIncrement}
                    onChange={(event) => setCustomIncrement(event.target.value)}
                  />
                </label>
                <p className={`play-custom__hint${custom.ok ? '' : ' is-error'}`}>
                  {custom.ok
                    ? `Plays as ${formatTimeControl(custom.initialSeconds, custom.incrementSeconds)}.`
                    : (custom.error ?? 'Check the custom time control.')}
                </p>
              </div>
            ) : null}
          </div>
        </section>

        <section className="play-block" aria-labelledby="play-opponent-title">
          <div className="play-block__head">
            <p className="play-eyebrow">02 — Opponent</p>
            <h2 id="play-opponent-title">Choose who you play</h2>
          </div>

          {/* The configurable engine is not a rung on the ladder: it gets its own
              heading at the top, where a custom opponent belongs. */}
          <section
            className="play-tier play-tier--general"
            aria-labelledby="play-tier-general"
          >
            <div className="play-tier__head">
              <h3 id="play-tier-general">
                General
                <span className="play-tier__count">1</span>
              </h3>
              <span className="play-tier__hint">Configurable · standard openings</span>
            </div>

            <div className="play-engine">
              <button
                type="button"
                aria-pressed={isGeneral}
                aria-label="General Bot"
                className={`play-engine__choice${isGeneral ? ' is-selected' : ''}`}
                onClick={() => setOpponentId(GENERAL_BOT.id)}
              >
                <OpponentAvatar opponent={GENERAL_BOT} size="md" loading="eager" />
                <span className="play-engine__body">
                  <span className="play-engine__name">General Bot</span>
                  <span className="play-engine__hint">
                    Configurable strength · standard beginner book
                  </span>
                </span>
                <span className="play-engine__elo">{generalElo} Elo</span>
              </button>

              {isGeneral ? (
                <div className="play-bot-range">
                  <div className="play-bot-range__head">
                    <label htmlFor="general-elo">Strength</label>
                    <output htmlFor="general-elo">{generalElo} Elo</output>
                  </div>
                  <input
                    id="general-elo"
                    type="range"
                    min={GENERAL_BOT_ELO.min}
                    max={GENERAL_BOT_ELO.max}
                    step={GENERAL_BOT_ELO.step}
                    value={generalElo}
                    onChange={(event) => setGeneralElo(Number(event.target.value))}
                  />
                  <div className="play-bot-range__scale" aria-hidden="true">
                    <span>{GENERAL_BOT_ELO.min}</span>
                    <span>1500</span>
                    <span>{GENERAL_BOT_ELO.max}</span>
                  </div>
                  <p className="play-bot-range__tier">
                    {generalCalibration.elo} USCF · ~{generalErrorPct}% errors ·{' '}
                    {generalCalibration.depth}-ply scan
                  </p>
                </div>
              ) : null}
            </div>
          </section>

          {/* One headed section per ladder group, in playing order, so the grid
              reads as a ladder instead of six equal portraits. */}
          {OPPONENT_CATEGORIES.map((category) => {
            const opponents = PERSONALITY_OPPONENTS.filter(
              (opponent) => opponent.category === category.id,
            );
            if (opponents.length === 0) return null;

            return (
              <section
                key={category.id}
                className="play-tier"
                aria-labelledby={`play-tier-${category.id}`}
              >
                <div className="play-tier__head">
                  <h3 id={`play-tier-${category.id}`}>
                    {category.label}
                    <span className="play-tier__count">{opponents.length}</span>
                  </h3>
                  <span className="play-tier__hint">{category.hint}</span>
                </div>

                <div
                  className="play-opponents"
                  role="group"
                  aria-label={`${category.label} opponents`}
                >
                  {opponents.map((opponent) => {
                    const active = opponent.id === opponentId;
                    return (
                      <button
                        key={opponent.id}
                        type="button"
                        aria-pressed={active}
                        aria-label={opponentFullName(opponent)}
                        className={`play-opponent${active ? ' is-selected' : ''}`}
                        onClick={() => setOpponentId(opponent.id)}
                      >
                        <span className="play-opponent__portrait">
                          <OpponentAvatar opponent={opponent} size="lg" loading="eager" />
                          {active ? (
                            <span className="play-opponent__check" aria-hidden="true">
                              ✓
                            </span>
                          ) : null}
                        </span>
                                                <span className="play-opponent__body">
                          <span className="play-opponent__name">{opponent.name}</span>
                          {opponentStage(opponent) ? (
                            <span className="play-opponent__tier">
                              {opponentStage(opponent)}
                            </span>
                          ) : null}
                          <span className="play-opponent__elo">{opponent.elo} Elo</span>
                          <span className="play-opponent__style">{opponent.style}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}

        </section>
      </div>

      <aside className="play-preview" aria-label="Game summary">
        <div className="play-preview__card">
          <div className="play-preview__hero">
            <OpponentAvatar opponent={selected} size="xl" loading="eager" />
          </div>
          <div className="play-preview__identity">
            <p className="play-eyebrow">
              {selected.kind === 'general' ? 'Configurable engine' : 'Personality opponent'}
            </p>
            <h2>{selected.name}</h2>
            <p className="play-preview__elo">
              {opponentStage(selected)
                ? `${opponentStage(selected)} · ${selected.elo} Elo`
                : `${selected.elo} Elo`}
            </p>
          </div>

          <p className="play-preview__style">{selected.style}</p>

          <dl className="play-preview__facts">
            <div>
              <dt>Colour</dt>
              <dd>{colorLabel}</dd>
            </div>
            <div>
              <dt>Time control</dt>
              <dd>{timeLabel}</dd>
            </div>
            <div>
              <dt>Opponent</dt>
              <dd>{selected.elo} Elo</dd>
            </div>
          </dl>

          {confirmRestart ? (
            <div className="play-restart" role="alert">
              <p>
                {hasLiveGame
                  ? 'A game is in progress. Starting a new one abandons it.'
                  : 'An unfinished game is saved. Starting a new one abandons it.'}
              </p>
              <div className="play-restart__actions">
                <button type="button" className="primary-btn" onClick={() => handleStart(true)}>
                  Start new game
                </button>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setConfirmRestart(false)}
                >
                  Keep current
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="primary-btn play-preview__start"
                onClick={() => handleStart()}
                disabled={!canStart}
              >
                Start Game
              </button>
              <p className={`play-hint${!canStart ? ' is-error' : ''}`}>
                {!canStart
                  ? (custom.error ?? 'Choose a valid time control.')
                  : 'Clocks start after your first move.'}
              </p>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
