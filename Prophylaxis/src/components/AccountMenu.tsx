import { useEffect, useState, type FormEvent } from 'react';
import { metadataFor } from '../sync/accountProfile.ts';
import { supabase } from '../sync/client.ts';
import { useSync } from '../sync/useSync.ts';
import {
  clampPlayerElo,
  normalisePlayerName,
  playerDisplayName,
  playerInitials,
  type PlayerProfile,
} from '../profile/playerProfile.ts';
import { updatePlayerProfile, usePlayerProfile } from '../profile/usePlayerProfile.ts';
import './AccountMenu.css';

/**
 * The account corner: one button at the top right of the shell.
 *
 * Signed out it says "Sign in" and opens a panel that can also create an
 * account; signed in it shows the player's initials and opens their details —
 * name, rating, email, password. The panel is an overlay rather than a page, so
 * signing in never loses the game or the study in progress behind it.
 */

type Mode = 'sign-in' | 'create' | 'profile';

export default function AccountMenu() {
  const sync = useSync();
  const profile = usePlayerProfile();

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('sign-in');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [elo, setElo] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');

  /* Follow the session: signed in opens the details, signed out the form. */
  useEffect(() => {
    setMode(sync.email ? 'profile' : 'sign-in');
    setError(null);
    setNotice(null);
    if (!sync.email) {
      setPassword('');
      setNewPassword('');
    }
  }, [sync.email]);

  /* Seed the fields from the profile the boards already show. */
  useEffect(() => {
    if (!open) return;
    setFirstName(profile.firstName);
    setLastName(profile.lastName);
    setElo(profile.elo ? String(profile.elo) : '');
  }, [open, profile]);

  if (!sync.configured) return null;

  const close = () => {
    setOpen(false);
    setError(null);
    setNotice(null);
  };

  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    if (mode === 'create') {
      const failure = await sync.signUp(email.trim(), password, {
        first_name: normalisePlayerName(firstName),
        last_name: normalisePlayerName(lastName),
        elo: elo.trim() ? clampPlayerElo(elo) : 0,
      });
      setBusy(false);
      if (failure) {
        setError(failure);
        return;
      }
      setPassword('');
      setNotice('Account created. If your project asks for confirmation, confirm by email, then sign in.');
      return;
    }

    const failure = await sync.signIn(email.trim(), password);
    setBusy(false);
    if (failure) {
      setError(failure);
      return;
    }
    setPassword('');
  };

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    const next: PlayerProfile = {
      firstName: normalisePlayerName(firstName),
      lastName: normalisePlayerName(lastName),
      elo: elo.trim() ? clampPlayerElo(elo) : 0,
    };

    /* Local first: the nameplate updates instantly, online or not. */
    updatePlayerProfile(next);

    const result = await supabase?.auth.updateUser({ data: metadataFor(next) });
    setBusy(false);
    if (result?.error) {
      setError(result.error.message);
      return;
    }
    setNotice('Profile saved.');
  };

  const changeEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase || busy || !newEmail.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await supabase.auth.updateUser({ email: newEmail.trim() });
    setBusy(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setNewEmail('');
    setNotice('Check the new address for a confirmation link.');
  };

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase || busy || newPassword.length < 6) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await supabase.auth.updateUser({ password: newPassword });
    setBusy(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setNewPassword('');
    setNotice('Password updated.');
  };

  const signOut = async () => {
    setBusy(true);
    await sync.signOut();
    setBusy(false);
    close();
  };

  const displayName = playerDisplayName(profile);

  return (
    <div className="account-corner">
      <button
        type="button"
        className="account-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        title={sync.email ? `Signed in as ${sync.email}` : 'Sign in or create an account'}
      >
        {sync.email ? (
          <span className="account-trigger__initials">{playerInitials(profile)}</span>
        ) : (
          'Sign in'
        )}
      </button>

      {open && (
        <>
          <button
            type="button"
            className="account-scrim"
            aria-label="Close account panel"
            onClick={close}
          />
          <section className="account-popover" role="dialog" aria-label="Account">
            <header className="account-popover__head">
              <div>
                <p className="account-eyebrow">{sync.email ? 'Account' : 'Welcome'}</p>
                <h2 className="account-title">
                  {sync.email ? displayName : mode === 'create' ? 'Create account' : 'Sign in'}
                </h2>
                {sync.email && <p className="account-muted">{sync.email}</p>}
              </div>
              <button type="button" className="account-close" onClick={close} aria-label="Close">
                ✕
              </button>
            </header>

            {mode !== 'profile' && (
              <>
                <div className="account-tabs" role="tablist" aria-label="Account mode">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === 'sign-in'}
                    className={`account-tab ${mode === 'sign-in' ? 'is-active' : ''}`}
                    onClick={() => {
                      setMode('sign-in');
                      setError(null);
                    }}
                  >
                    Sign in
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === 'create'}
                    className={`account-tab ${mode === 'create' ? 'is-active' : ''}`}
                    onClick={() => {
                      setMode('create');
                      setError(null);
                    }}
                  >
                    Create account
                  </button>
                </div>

                <form className="account-form" onSubmit={submitAuth}>
                  {mode === 'create' && (
                    <div className="account-row">
                      <label className="account-field">
                        <span>First name</span>
                        <input
                          value={firstName}
                          onChange={(event) => setFirstName(event.target.value)}
                          autoComplete="given-name"
                          placeholder="Magnus"
                        />
                      </label>
                      <label className="account-field">
                        <span>Last name</span>
                        <input
                          value={lastName}
                          onChange={(event) => setLastName(event.target.value)}
                          autoComplete="family-name"
                          placeholder="Carlsen"
                        />
                      </label>
                    </div>
                  )}

                  <label className="account-field">
                    <span>Email</span>
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      autoComplete="email"
                      required
                    />
                  </label>

                  <label className="account-field">
                    <span>Password</span>
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
                      minLength={6}
                      required
                    />
                  </label>

                  <button type="submit" className="account-submit" disabled={busy}>
                    {busy ? 'Working…' : mode === 'create' ? 'Create account' : 'Sign in'}
                  </button>
                </form>
              </>
            )}

            {mode === 'profile' && sync.email && (
              <>
                <form className="account-form" onSubmit={saveProfile}>
                  <div className="account-row">
                    <label className="account-field">
                      <span>First name</span>
                      <input
                        value={firstName}
                        onChange={(event) => setFirstName(event.target.value)}
                        autoComplete="given-name"
                      />
                    </label>
                    <label className="account-field">
                      <span>Last name</span>
                      <input
                        value={lastName}
                        onChange={(event) => setLastName(event.target.value)}
                        autoComplete="family-name"
                      />
                    </label>
                  </div>

                  <label className="account-field">
                    <span>Elo</span>
                    <input
                      inputMode="numeric"
                      value={elo}
                      onChange={(event) => setElo(event.target.value)}
                      placeholder="1200"
                    />
                  </label>

                  <button type="submit" className="account-submit" disabled={busy}>
                    Save profile
                  </button>
                </form>

                <form className="account-form account-form--divider" onSubmit={changeEmail}>
                  <label className="account-field">
                    <span>Change email</span>
                    <input
                      type="email"
                      value={newEmail}
                      onChange={(event) => setNewEmail(event.target.value)}
                      placeholder={sync.email}
                      autoComplete="email"
                    />
                  </label>
                  <button
                    type="submit"
                    className="account-secondary"
                    disabled={busy || !newEmail.trim()}
                  >
                    Send confirmation link
                  </button>
                </form>

                <form className="account-form account-form--divider" onSubmit={changePassword}>
                  <label className="account-field">
                    <span>New password</span>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      autoComplete="new-password"
                      minLength={6}
                      placeholder="At least 6 characters"
                    />
                  </label>
                  <button
                    type="submit"
                    className="account-secondary"
                    disabled={busy || newPassword.length < 6}
                  >
                    Update password
                  </button>
                </form>

                <div className="account-foot">
                  <span className="account-muted">{sync.pending} queued</span>
                  <button type="button" className="account-signout" onClick={() => void signOut()}>
                    Sign out
                  </button>
                </div>
              </>
            )}

            {error ? (
              <p className="account-status is-error" role="alert">
                {error}
              </p>
            ) : notice || sync.message ? (
              <p className="account-status" role="status">
                {notice ?? sync.message}
              </p>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
