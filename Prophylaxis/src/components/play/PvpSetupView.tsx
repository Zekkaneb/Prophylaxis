import { useMemo, useState } from 'react';
import {
  BONUS_TYPES,
  PVP_CATEGORY_LABELS,
  PVP_CATEGORY_ORDER,
  PVP_LIMITS,
  PVP_PRESETS,
  pvpTimeControlLabel,
  validateCustomPvp,
  type PvpPreset,
  type PvpTimeControl,
} from '../../play/pvp.ts';
import type { BonusType } from '../../play/clock.ts';

export interface PvpStartOptions {
  control: PvpTimeControl;
  autoFlip: boolean;
}

const CUSTOM_ID = 'custom';

/**
 * The PvP lobby: quick-pick presets, the custom control panel, and the two ways
 * to play.
 *
 * The presets are the ones the clock labels mean; a delay clock is chosen in
 * the custom panel, because `5+3` cannot say which of the three bonus mechanics
 * it is.
 */
export function PvpSetupView({
  onStart,
  online,
}: {
  onStart: (options: PvpStartOptions) => void;
  /**
   * Online lobby content. A render prop, because the room has to adopt the time
   * control chosen in this form rather than the other way round.
   */
  online?: (control: PvpTimeControl | null) => React.ReactNode;
}) {
  const [presetId, setPresetId] = useState<string>('5+3');
  const [customMinutes, setCustomMinutes] = useState('10');
  const [customBonus, setCustomBonus] = useState('5');
  const [bonusType, setBonusType] = useState<BonusType>('fischer');
  const [autoFlip, setAutoFlip] = useState(true);
  const [mode, setMode] = useState<'local' | 'online'>('local');

  const custom = useMemo(
    () => validateCustomPvp(customMinutes, customBonus, bonusType),
    [bonusType, customBonus, customMinutes],
  );

  const preset = PVP_PRESETS.find((entry) => entry.id === presetId) ?? PVP_PRESETS[0];
  const usingCustom = presetId === CUSTOM_ID;

  const control: PvpTimeControl | null = usingCustom
    ? custom.ok
      ? custom.control
      : null
    : {
        initialSeconds: preset.initialSeconds,
        bonusSeconds: preset.bonusSeconds,
        bonusType: preset.bonusType,
        untimed: preset.untimed,
      };

  function presetButton(entry: PvpPreset) {
    const active = entry.id === presetId;
    return (
      <button
        key={entry.id}
        type="button"
        aria-pressed={active}
        className={`pvp-preset${active ? ' is-selected' : ''}`}
        onClick={() => setPresetId(entry.id)}
      >
        <span className="pvp-preset__label">
          {entry.untimed ? 'Unlimited' : `${entry.initialSeconds / 60}+${entry.bonusSeconds}`}
        </span>
        <span className="pvp-preset__meta">
          {entry.untimed ? 'No clock' : `${entry.initialSeconds / 60} min`}
        </span>
      </button>
    );
  }

  return (
    <div className="pvp-setup">
      <section className="play-block" aria-labelledby="pvp-how-title">
        <div className="play-block__head">
          <p className="play-eyebrow">01 — Players</p>
          <h2 id="pvp-how-title">How are you playing?</h2>
        </div>

        <div className="play-segment" role="group" aria-label="Play mode">
          <button
            type="button"
            aria-pressed={mode === 'local'}
            className={`play-segment__option${mode === 'local' ? ' is-selected' : ''}`}
            onClick={() => setMode('local')}
          >
            <span>Pass and play</span>
            <small>Two people, one device</small>
          </button>
          <button
            type="button"
            aria-pressed={mode === 'online'}
            className={`play-segment__option${mode === 'online' ? ' is-selected' : ''}`}
            onClick={() => setMode('online')}
          >
            <span>Online</span>
            <small>Two devices, one room</small>
          </button>
        </div>

        {mode === 'online' ? online?.(control) : null}
      </section>

      {
        <>
          <section className="play-block" aria-labelledby="pvp-time-title">
            <div className="play-block__head">
              <p className="play-eyebrow">02 — Time control</p>
              <h2 id="pvp-time-title">How much time each?</h2>
            </div>

            {PVP_CATEGORY_ORDER.map((category) => {
              /* Unlimited is listed with the classical controls: both are "long
                 or none", and two identically titled groups would read wrong. */
              const presets = PVP_PRESETS.filter((entry) =>
                category === 'classical'
                  ? entry.category === 'classical' || entry.category === 'unlimited'
                  : entry.category === category,
              );
              if (presets.length === 0) return null;
              return (
                <div key={category} className="pvp-group">
                  <span className="pvp-group__label">{PVP_CATEGORY_LABELS[category]}</span>
                  <div className="pvp-presets" role="group" aria-label={PVP_CATEGORY_LABELS[category]}>
                    {presets.map(presetButton)}
                  </div>
                </div>
              );
            })}

            <div className="pvp-group">
              <span className="pvp-group__label">Custom</span>
              <div className="pvp-presets">
                <button
                  type="button"
                  aria-pressed={usingCustom}
                  className={`pvp-preset${usingCustom ? ' is-selected' : ''}`}
                  onClick={() => setPresetId(CUSTOM_ID)}
                >
                  <span className="pvp-preset__label">Custom</span>
                  <span className="pvp-preset__meta">Your own</span>
                </button>
              </div>
            </div>
          </section>

          <section className="play-block" aria-labelledby="pvp-custom-title">
            <div className="play-block__head">
              <p className="play-eyebrow">03 — Custom control</p>
              <h2 id="pvp-custom-title">Base time and bonus</h2>
            </div>

            <div className="play-field">
              <span className="play-field__label">Base minutes</span>
              <div className="pvp-number">
                <input
                  type="range"
                  min={PVP_LIMITS.minutes.min}
                  max={PVP_LIMITS.minutes.max}
                  step={1}
                  value={Number(customMinutes) || PVP_LIMITS.minutes.min}
                  aria-label="Base minutes slider"
                  onChange={(event) => {
                    setPresetId(CUSTOM_ID);
                    setCustomMinutes(event.target.value);
                  }}
                />
                <input
                  type="number"
                  inputMode="numeric"
                  min={PVP_LIMITS.minutes.min}
                  max={PVP_LIMITS.minutes.max}
                  step={1}
                  value={customMinutes}
                  aria-label="Base minutes"
                  onChange={(event) => {
                    setPresetId(CUSTOM_ID);
                    setCustomMinutes(event.target.value);
                  }}
                />
                <span className="pvp-number__unit">min</span>
              </div>
            </div>

            <div className="play-field">
              <span className="play-field__label">Bonus type</span>
              <div className="pvp-bonus" role="radiogroup" aria-label="Bonus type">
                {BONUS_TYPES.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    role="radio"
                    aria-checked={bonusType === entry.id}
                    className={`pvp-bonus__option${bonusType === entry.id ? ' is-selected' : ''}`}
                    onClick={() => {
                      setPresetId(CUSTOM_ID);
                      setBonusType(entry.id);
                    }}
                  >
                    <span className="pvp-bonus__label">{entry.label}</span>
                    <span className="pvp-bonus__hint">{entry.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="play-field">
              <span className="play-field__label">Bonus seconds</span>
              <div className="pvp-number">
                <input
                  type="range"
                  min={PVP_LIMITS.bonus.min}
                  max={PVP_LIMITS.bonus.max}
                  step={1}
                  value={Number(customBonus) || 0}
                  aria-label="Bonus seconds slider"
                  onChange={(event) => {
                    setPresetId(CUSTOM_ID);
                    setCustomBonus(event.target.value);
                  }}
                />
                <input
                  type="number"
                  inputMode="numeric"
                  min={PVP_LIMITS.bonus.min}
                  max={PVP_LIMITS.bonus.max}
                  step={1}
                  value={customBonus}
                  aria-label="Bonus seconds"
                  onChange={(event) => {
                    setPresetId(CUSTOM_ID);
                    setCustomBonus(event.target.value);
                  }}
                />
                <span className="pvp-number__unit">sec</span>
              </div>
              {usingCustom && !custom.ok ? (
                <p className="pvp-error" role="alert">
                  {custom.error}
                </p>
              ) : null}
            </div>

            <label className="pvp-toggle">
              <input
                type="checkbox"
                checked={autoFlip}
                onChange={(event) => setAutoFlip(event.target.checked)}
              />
              <span>
                <span className="pvp-toggle__label">Flip the board each turn</span>
                <span className="pvp-toggle__hint">
                  The side to move always plays from the bottom.
                </span>
              </span>
            </label>
          </section>

          <aside className="practice-preview" aria-label="Match summary">
            <p className="play-eyebrow">Ready when you are</p>
            <h2>{control ? pvpTimeControlLabel(control) : 'Check the custom control'}</h2>
            <dl className="play-facts">
              <div>
                <dt>Clock</dt>
                <dd>{control?.untimed ? 'No clock' : 'Each side, one clock'}</dd>
              </div>
              <div>
                <dt>Bonus</dt>
                <dd>{BONUS_TYPES.find((entry) => entry.id === (control?.bonusType ?? bonusType))?.label}</dd>
              </div>
              <div>
                <dt>Board</dt>
                <dd>{autoFlip ? 'Flips each turn' : 'Fixed'}</dd>
              </div>
            </dl>
            {mode === 'local' ? (
              <button
                type="button"
                className="primary-btn"
                disabled={!control}
                onClick={() => control && onStart({ control, autoFlip })}
              >
                Start pass-and-play
              </button>
            ) : (
              <p className="practice-preview__note">
                Start the game from the room above once your opponent has joined.
              </p>
            )}
            <p className="practice-preview__note">
              White moves first. Pause whenever you need to; the clocks stop for both sides.
            </p>
          </aside>
        </>
      }
    </div>
  );
}

export default PvpSetupView;
