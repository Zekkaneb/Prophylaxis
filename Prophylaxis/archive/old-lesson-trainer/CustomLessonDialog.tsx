import { useEffect, useRef, useState, type FormEvent } from 'react';
import { db, type CustomLessonRecord } from '../db';
import { parseLessonPgn } from '../lessons/customLessons';
import './CustomLessonDialog.css';

interface CustomLessonDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (lessonId: string) => void;
}

export default function CustomLessonDialog({
  open,
  onClose,
  onCreated,
}: CustomLessonDialogProps) {
  const [title, setTitle] = useState('');
  const [color, setColor] = useState<'white' | 'black'>('white');
  const [pgn, setPgn] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    const focus = setTimeout(() => titleRef.current?.focus(), 30);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(focus);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setError(null);
    setSaving(true);
    try {
      const parsed = parseLessonPgn(pgn);
      const record: CustomLessonRecord = {
        lesson_id: `custom-${Date.now().toString(36)}`,
        title: title.trim() || 'Custom lesson',
        repertoire_color: color,
        ...(parsed.startingFen ? { starting_fen: parsed.startingFen } : {}),
        moves: parsed.moves,
        created_at: Date.now(),
      };
      await db.custom_lessons.put(record);
      setTitle('');
      setPgn('');
      setColor('white');
      onCreated(record.lesson_id);
      onClose();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="lesson-modal" role="dialog" aria-modal="true" aria-labelledby="lesson-modal-title">
      <div className="lesson-modal__backdrop" onClick={onClose} />
      <form className="lesson-modal__card" onSubmit={(event) => void submit(event)}>
        <header className="lesson-modal__head">
          <h2 id="lesson-modal-title">Create custom lesson</h2>
          <button
            type="button"
            className="lesson-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <label className="lesson-modal__field">
          <span>Lesson title</span>
          <input
            ref={titleRef}
            value={title}
            maxLength={80}
            placeholder="e.g. Najdorf — English Attack"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>

        <fieldset className="lesson-modal__field">
          <legend>Repertoire colour</legend>
          <div className="lesson-modal__segmented">
            <label className={color === 'white' ? 'is-active' : ''}>
              <input
                type="radio"
                name="repertoire-color"
                checked={color === 'white'}
                onChange={() => setColor('white')}
              />
              <span>White</span>
              <small>3-move chunks</small>
            </label>
            <label className={color === 'black' ? 'is-active' : ''}>
              <input
                type="radio"
                name="repertoire-color"
                checked={color === 'black'}
                onChange={() => setColor('black')}
              />
              <span>Black</span>
              <small>2-move chunks</small>
            </label>
          </div>
        </fieldset>

        <label className="lesson-modal__field">
          <span>PGN line</span>
          <textarea
            value={pgn}
            rows={8}
            spellCheck={false}
            placeholder={'1. e4 {King pawn} e5 2. Nf3 {Develops, eyes d4} Nc6'}
            onChange={(event) => setPgn(event.target.value)}
          />
        </label>

        <p className="lesson-modal__hint">
          Comments in <code>{'{ braces }'}</code> become that move&apos;s explanation in Learn
          mode.
        </p>

        {error && (
          <p className="lesson-modal__error" role="alert">
            {error}
          </p>
        )}

        <footer className="lesson-modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={saving}>
            {saving ? 'Saving…' : 'Create lesson'}
          </button>
        </footer>
      </form>
    </div>
  );
}
