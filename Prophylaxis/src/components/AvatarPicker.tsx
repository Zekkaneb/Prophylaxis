import { useRef, useState } from 'react';
import { AvatarError, fileToAvatar } from '../profile/avatar.ts';
import './AvatarPicker.css';

export interface AvatarPickerProps {
  /** The picture already on the profile, if any. */
  avatar?: string;
  /** What the face shows when there is no picture. */
  initials: string;
  /** Hands back the shrunk data URL, or undefined when the photo is removed. */
  onChange: (avatar: string | undefined) => void;
  /** One line of feedback; the parent owns where it is shown. */
  onStatus?: (message: string | null) => void;
}

/**
 * The profile photo control: a face, a picker, and a way back to initials.
 * The file never leaves the device — it is squared and shrunk into the same
 * localStorage profile the nameplate already uses.
 */
export default function AvatarPicker({
  avatar,
  initials,
  onChange,
  onStatus,
}: AvatarPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    onStatus?.(null);
    try {
      const next = await fileToAvatar(file);
      onChange(next);
      onStatus?.('Photo updated.');
    } catch (cause) {
      onStatus?.(
        cause instanceof AvatarError ? cause.message : 'That picture could not be used.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="avatar-picker">
      <span className="avatar-picker__face" aria-hidden="true">
        {avatar ? <img src={avatar} alt="" /> : initials}
      </span>

      <div className="avatar-picker__body">
        <span className="avatar-picker__label">Photo</span>
        <div className="avatar-picker__actions">
          <button
            type="button"
            className="secondary-btn avatar-picker__btn"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? 'Reading…' : avatar ? 'Change photo…' : 'Add photo…'}
          </button>
          {avatar ? (
            <button
              type="button"
              className="button button--ghost button--small"
              disabled={busy}
              onClick={() => {
                onChange(undefined);
                onStatus?.('Photo removed.');
              }}
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          /* Read the File before resetting the input: assigning `value = ''`
             empties the live FileList, so a captured reference would be gone. */
          const file = event.target.files?.[0] ?? null;
          event.target.value = '';
          void handleFile(file);
        }}
      />
    </div>
  );
}
