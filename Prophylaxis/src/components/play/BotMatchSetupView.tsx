import { useMemo, useState } from 'react';
import {
  PERSONALITY_OPPONENTS,
  opponentFullName,
  opponentStage,
  type OpponentProfile,
} from '../../play/opponents.ts';
import {
  TIME_CONTROL_PRESETS,
  UNTIMED_ID,
  timeControlLabel,
} from '../../play/timeControls.ts';
import type { GameConfig } from '../../play/types.ts';
import type { BotMatchConfig, MatchSpeed } from '../../play/useBotMatch.ts';
import { OpponentAvatar } from './OpponentAvatar.tsx';

export interface BotMatchSetupViewProps {
  onStart: (config: BotMatchConfig) => void;
  onCancel: () => void;
}

const SPEEDS: Array<{ id: MatchSpeed; label: string; hint: string }> = [
  { id: 'slow', label: 'Slow', hint: 'Longer pause between moves' },
  { id: 'normal', label: 'Normal', hint: 'Standard viewing pace' },
  { id: 'fast', label: 'Fast', hint: 'Short pause between moves' },
];

function displayName(opponent: OpponentProfile): string {
  return opponent.name;
}

function opponentCardClass(selected: boolean, disabled: boolean): string {
  return [
    'bot-choice',
    selected ? 'is-selected' : '',
    disabled ? 'is-disabled' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function BotMatchSetupView({ onStart, onCancel }: BotMatchSetupViewProps) {
  const [whiteId, setWhiteId] = useState<string>(PERSONALITY_OPPONENTS[0].id);
  const [blackId, setBlackId] = useState<string>(PERSONALITY_OPPONENTS[1].id);
  const [timeId, setTimeId] = useState<string>('5+0');
  const [speed, setSpeed] = useState<MatchSpeed>('normal');

  const white =
    PERSONALITY_OPPONENTS.find((opponent) => opponent.id === whiteId) ??
    PERSONALITY_OPPONENTS[0];
  const black =
    PERSONALITY_OPPONENTS.find((opponent) => opponent.id === blackId) ??
    PERSONALITY_OPPONENTS[1];

  const timeLabel = useMemo(() => {
    if (timeId === UNTIMED_ID) return 'Untimed';
    const preset = TIME_CONTROL_PRESETS.find((control) => control.id === timeId);
    return preset ? timeControlLabel(preset.initialSeconds, preset.incrementSeconds) : timeId;
  }, [timeId]);

  function start() {
    if (white.id === black.id) return;
    const preset = TIME_CONTROL_PRESETS.find((control) => control.id === timeId);
    const untimed = timeId === UNTIMED_ID;
    const game: GameConfig = {
      color: 'w',
      timeControlId: timeId,
      initialSeconds: untimed ? 0 : (preset?.initialSeconds ?? 300),
      incrementSeconds: untimed ? 0 : (preset?.incrementSeconds ?? 0),
      untimed,
    };
    onStart({ white, black, game, speed });
  }

  return (
    <section className="bot-setup" aria-labelledby="bot-setup-title">
      <div className="play-history__head">
        <div>
          <p className="play-eyebrow">Watch mode</p>
          <h2 id="bot-setup-title">Bot vs. Bot</h2>
        </div>
        <button type="button" className="secondary-btn" onClick={onCancel}>
          Back
        </button>
      </div>

      <div className="bot-setup__sides">
        {(['w', 'b'] as const).map((side) => {
          const selected = side === 'w' ? white : black;
          const otherId = side === 'w' ? blackId : whiteId;
          return (
            <div className="bot-side" key={side}>
              <div className="bot-side__head">
                <p className="play-eyebrow">{side === 'w' ? 'White' : 'Black'}</p>
                <span className="bot-side__elo">{selected.elo} Elo</span>
              </div>
              <div className="bot-side__selected">
                <OpponentAvatar opponent={selected} size="lg" loading="eager" />
                <div>
                  <h3>{displayName(selected)}</h3>
                  {opponentStage(selected) ? <p>{opponentStage(selected)}</p> : null}
                  <p className="bot-side__style">{selected.style}</p>
                </div>
              </div>
              <div
                className="bot-roster"
                role="group"
                aria-label={`${side === 'w' ? 'White' : 'Black'} opponent`}
              >
                {PERSONALITY_OPPONENTS.map((opponent) => {
                  const active = opponent.id === selected.id;
                  const disabled = opponent.id === otherId;
                  return (
                    <button
                      key={opponent.id}
                      type="button"
                      className={opponentCardClass(active, disabled)}
                      aria-pressed={active}
                      disabled={disabled}
                      aria-label={`${opponentFullName(opponent)} for ${side === 'w' ? 'White' : 'Black'}`}
                      onClick={() => {
                        if (disabled) return;
                        if (side === 'w') setWhiteId(opponent.id);
                        else setBlackId(opponent.id);
                      }}
                    >
                      <OpponentAvatar opponent={opponent} size="sm" />
                      <span>{opponent.shortName}</span>
                      <small>{opponent.elo}</small>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <section className="play-block">
        <div className="play-block__head">
          <p className="play-eyebrow">Match settings</p>
          <h2>Clock and viewing pace</h2>
        </div>

        <div className="play-field">
          <span className="play-field__label">Time control · {timeLabel}</span>
          <div className="play-timegrid">
            {TIME_CONTROL_PRESETS.map((control) => (
              <button
                key={control.id}
                type="button"
                aria-pressed={timeId === control.id}
                className={`play-time${timeId === control.id ? ' is-selected' : ''}`}
                onClick={() => setTimeId(control.id)}
              >
                {control.id}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={timeId === UNTIMED_ID}
              className={`play-time${timeId === UNTIMED_ID ? ' is-selected' : ''}`}
              onClick={() => setTimeId(UNTIMED_ID)}
            >
              Untimed
            </button>
          </div>
        </div>

        <div className="play-field">
          <span className="play-field__label">Viewing pace</span>
          <div className="bot-speed" role="group" aria-label="Viewing pace">
            {SPEEDS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={speed === option.id}
                className={`play-segment__option${speed === option.id ? ' is-selected' : ''}`}
                onClick={() => setSpeed(option.id)}
              >
                <span>{option.label}</span>
                <small>{option.hint}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="bot-setup__actions">
          <button
            type="button"
            className="primary-btn"
            onClick={start}
            disabled={white.id === black.id}
          >
            Start Match
          </button>
          <p className="play-hint">
            Both bots use their own repertoire, personality and engine strength. Pace only
            changes how quickly moves are shown.
          </p>
        </div>
      </section>
    </section>
  );
}
