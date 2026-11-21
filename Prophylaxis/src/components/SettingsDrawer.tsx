import { useEffect, useRef } from 'react';
import {
  ACCENTS,
  BOARD_PALETTES,
  COLOR_MODE_LABEL,
  useAppearance,
  type AccentId,
  type BoardPaletteId,
  type ColorMode,
} from '../theme/ThemeProvider';
import { PIECE_SETS, type PieceSetId } from '../theme/pieceSets';
import { savePremovesEnabled, usePremovesEnabled } from '../play/premovePrefs.ts';
import { assetUrl } from '../assets/assetUrl';
import './SettingsDrawer.css';

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
}

const PALETTE_IDS = Object.keys(BOARD_PALETTES) as BoardPaletteId[];
const PIECE_IDS = Object.keys(PIECE_SETS) as PieceSetId[];
const ACCENT_IDS = Object.keys(ACCENTS) as AccentId[];
const MODE_IDS: ColorMode[] = ['dark', 'light', 'system'];


export default function SettingsDrawer({ open, onClose }: SettingsDrawerProps) {
  const {
    appearance,
    palette,
    soundOn,
    soundVolume,
    colorMode,
    theme,
    accent,
    setPalette,
    setPieceSet,
    setColorMode,
    setAccent,
    setSoundOn,
    setSoundVolume,
    reset,
  } = useAppearance();

  const premovesEnabled = usePremovesEnabled();


  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    restoreRef.current = document.activeElement as HTMLElement | null;
    const focusFrame = requestAnimationFrame(() => closeRef.current?.focus());

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;

      /* Keep Tab inside the drawer while it is modal. */
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([tabindex="-1"]), input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((node) => !node.hasAttribute('disabled'));
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
      restoreRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="settings" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <button
        type="button"
        className="settings__scrim"
        aria-label="Close settings"
        tabIndex={-1}
        onClick={onClose}
      />

      <aside className="settings__panel" ref={panelRef}>
        <header className="settings__head">
          <p className="settings__eyebrow">Court appearance</p>
          <h2 id="settings-title">Shape your board</h2>
          <button
            ref={closeRef}
            type="button"
            className="settings__close"
            onClick={onClose}
            aria-label="Close settings"
          >
            ✕
          </button>
        </header>

        <div className="settings__body">
          <section className="settings__section" style={{ animationDelay: '40ms' }}>
            <div className="settings__label-row">
              <div>
                <h3>Theme</h3>
                <p className="settings__hint">
                  Paper for daylight, slate for night. Auto follows your system.
                </p>
              </div>
              <span className="settings__value">
                {colorMode === 'system'
                  ? `Auto · ${COLOR_MODE_LABEL[theme]}`
                  : COLOR_MODE_LABEL[colorMode]}
              </span>
            </div>
            <div className="settings__segmented" role="group" aria-label="Colour theme">
              {MODE_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`settings__segment ${colorMode === id ? 'is-active' : ''}`}
                  aria-pressed={colorMode === id}
                  onClick={() => setColorMode(id)}
                >
                  {COLOR_MODE_LABEL[id]}
                </button>
              ))}
            </div>

            <div className="settings__label-row settings__label-row--accent">
              <h3>Accent</h3>
              <span className="settings__value">{ACCENTS[accent].label}</span>
            </div>
            <div className="settings__accent-grid">
              {ACCENT_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`accent-tile ${accent === id ? 'is-active' : ''}`}
                  aria-pressed={accent === id}
                  title={ACCENTS[id].hint}
                  onClick={() => setAccent(id)}
                >
                  <span
                    className="accent-tile__dot"
                    style={{ background: ACCENTS[id][theme] }}
                    aria-hidden="true"
                  />
                  <span>{ACCENTS[id].label}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="settings__section" style={{ animationDelay: '90ms' }}>
            <div className="settings__label-row">
              <h3>Board palette</h3>
              <span className="settings__value">{palette.label}</span>
            </div>
            <div className="settings__grid">
              {PALETTE_IDS.map((id) => {
                const option = BOARD_PALETTES[id];
                return (
                  <button
                    key={id}
                    type="button"
                    className={`palette-tile ${appearance.palette === id ? 'is-active' : ''}`}
                    aria-pressed={appearance.palette === id}
                    onClick={() => setPalette(id)}
                  >
                    <span
                      className="palette-tile__board"
                      style={{
                        background: `conic-gradient(${option.light} 0 25%, ${option.dark} 0 50%, ${option.light} 0 75%, ${option.dark} 0)`,
                      }}
                    />
                    <span className="palette-tile__text">
                      <strong>{option.label}</strong>
                      <small>{option.hint}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="settings__section" style={{ animationDelay: '130ms' }}>
            <div className="settings__label-row">
              <h3>Piece style</h3>
              <span className="settings__value">{PIECE_SETS[appearance.pieceSet].label}</span>
            </div>
            <div className="settings__grid settings__grid--four">
              {PIECE_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`piece-tile ${appearance.pieceSet === id ? 'is-active' : ''}`}
                  aria-pressed={appearance.pieceSet === id}
                  onClick={() => setPieceSet(id)}
                >
                  <img
                    src={assetUrl(`pieces/${id}/wN.svg`)}
                    alt=""
                    width={40}
                    height={40}
                    draggable={false}
                  />
                  <span>{PIECE_SETS[id].label}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="settings__section" style={{ animationDelay: '180ms' }}>
            <div className="settings__label-row">
              <div>
                <h3>Board sounds</h3>
                <p className="settings__hint">
                  Moves, captures, checks, castling, promotion and game end.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={soundOn}
                aria-label={soundOn ? 'Mute board sounds' : 'Unmute board sounds'}
                className={`settings-switch ${soundOn ? 'is-on' : ''}`}
                onClick={() => setSoundOn(!soundOn)}
              >
                <span />
              </button>
            </div>

            <div className="settings__volume">
              <label htmlFor="sound-volume">Volume</label>
              <input
                id="sound-volume"
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(soundVolume * 100)}
                disabled={!soundOn}
                aria-valuetext={`${Math.round(soundVolume * 100)} percent`}
                onChange={(event) => setSoundVolume(Number(event.target.value) / 100)}
              />
              <span className="settings__value">{Math.round(soundVolume * 100)}%</span>
            </div>
          </section>

          <section className="settings__section" style={{ animationDelay: '220ms' }}>
            <div className="settings__label-row">
              <div>
                <h3>Premoves</h3>
                <p className="settings__hint">
                  Queue moves during your opponent's turn. Each executed premove costs 0.1
                  seconds on the clock.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={premovesEnabled}
                aria-label={premovesEnabled ? 'Disable premoves' : 'Enable premoves'}
                className={`settings-switch ${premovesEnabled ? 'is-on' : ''}`}
                onClick={() => savePremovesEnabled(!premovesEnabled)}
              >
                <span />
              </button>
            </div>
          </section>

        </div>

        <footer className="settings__foot">
          <button type="button" className="settings__reset" onClick={reset}>
            Reset to defaults
          </button>
          <button type="button" className="settings__done" onClick={onClose}>
            Done
          </button>
        </footer>
      </aside>
    </div>
  );
}
