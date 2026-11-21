import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { activeDatabaseName } from '../db.ts';
import { ensureDatabaseFor, readDatabaseOwner, LOCAL_OWNER } from './accountDatabase.ts';
import { supabase, syncConfigured, syncDisabledReason, type SyncDisabledReason } from './client.ts';
import { QUEUE_EVENT } from './outbox.ts';
import { pendingChangeCount, runSync } from './sync.ts';

/**
 * Signed-in state plus a background sync loop.
 *
 * Nothing here gates the app: without a session every feature works exactly as
 * before and the outbox simply accumulates (empty until something is saved).
 * Signing in starts pulling and pushing; signing out stops the loop and leaves
 * the local rows alone.
 */

export type SyncStatus = 'idle' | 'syncing' | 'error';

export interface SyncController {
  /** False in the single-file/offline build, which has no backend. */
  configured: boolean;
  /** Why it is off, so the panel can say something useful. */
  disabledReason: SyncDisabledReason | null;
  /** False until the stored session has been read once. */
  ready: boolean;
  email: string | null;
  status: SyncStatus;
  /** Human-readable result or failure of the last attempt. */
  message: string | null;
  /** Local changes not yet uploaded. */
  pending: number;
  /** Which local database the count belongs to. */
  database: string;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  syncNow: () => Promise<void>;
}

const SYNC_INTERVAL_MS = 60_000;

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

export function useSync(): SyncController {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!syncConfigured);
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [database, setDatabase] = useState(() => (syncConfigured ? activeDatabaseName() : ''));
  const busyRef = useRef(false);

  const refreshPending = useCallback(async () => {
    if (!syncConfigured) return;
    try {
      setPending(await pendingChangeCount());
    } catch {
      /* counting is cosmetic */
    }
  }, []);

  const syncNow = useCallback(async () => {
    if (!supabase || !session?.user || busyRef.current) return;
    busyRef.current = true;
    setStatus('syncing');
    try {
      /* Another account's rows must never be uploaded under this session. */
      if ((await readDatabaseOwner()) !== session.user.id) {
        setStatus('idle');
        setMessage('Opening this account’s database…');
        return;
      }

      const report = await runSync(session.user.id);
      await refreshPending();

      /* "Nothing was downloaded" and "could not download" must not read the
         same: only the first means everything is up to date. */
      if (report.pullFailed) {
        setStatus('error');
        setMessage(
          `Could not download other devices’ games (${report.pullError ?? 'unknown error'}). ` +
            `Nothing here was lost${report.pushed > 0 ? `, and ${report.pushed} were uploaded` : ''}.`,
        );
        return;
      }

      /* Some rows were refused outright. Say so plainly and point at the
         queue: they are not lost, but they will not arrive either. */
      if (report.pushRejected > 0) {
        const tables = report.pushRejectedRows.length
          ? ` from ${report.pushRejectedRows.join(', ')}`
          : '';
        /* Name the fix when the server's own message identifies it: this is
           the one rejection a user can resolve and the app can recognise. */
        const hint = /sync_rows_known_table/.test(report.pushError ?? '')
          ? ' Run supabase/migrations/0003_woodpecker_sets.sql in the Supabase SQL editor: the allow-list still excludes woodpecker_sets.'
          : '';
        setStatus('error');
        setMessage(
          `The server refused ${report.pushRejected} change(s)${tables}: ${report.pushError ?? 'unknown error'}. ` +
            `They stay queued here; ${report.pushed} other change(s) were uploaded.${hint}`,
        );
        return;
      }

      setStatus('idle');
      setMessage(
        report.pushed + report.pulled === 0
          ? 'Everything is up to date.'
          : `Synced ${report.pushed} up, ${report.pulled} down.`,
      );
    } catch (cause) {
      setStatus('error');
      setMessage(`Sync failed: ${describe(cause)}. Your games are still saved here.`);
    } finally {
      busyRef.current = false;
    }
  }, [refreshPending, session]);

  /* Read the stored session once, then follow every change. */
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        setSession(data.session ?? null);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });

    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setMessage(null);
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  /*
   * Keep the pending count honest even when signed out.
   *
   * The event is what makes it live: a puzzle set created while the panel is
   * open must show up as "2 to upload" immediately, not only after the next
   * sync. The interval is a slow safety net for writes that bypass the outbox
   * helpers, and it also picks up a database switch.
   */
  useEffect(() => {
    void refreshPending();
    setDatabase(syncConfigured ? activeDatabaseName() : '');

    const onQueued = () => void refreshPending();
    window.addEventListener(QUEUE_EVENT, onQueued);
    const timer = window.setInterval(() => void refreshPending(), 15_000);

    return () => {
      window.removeEventListener(QUEUE_EVENT, onQueued);
      window.clearInterval(timer);
    };
  }, [refreshPending]);

  /*
   * Each account reads and writes its own database. The boot step opens the
   * right one before the first render; this handles a sign-in or sign-out that
   * happens while the app is already running, where the cheapest correct
   * answer is to reload onto the new database rather than unpick the state
   * every view is holding.
   */
  useEffect(() => {
    if (!syncConfigured || !ready) return;
    const desired = session?.user?.id ?? LOCAL_OWNER;
    let cancelled = false;

    void (async () => {
      const current = await readDatabaseOwner();
      if (cancelled || current === desired) return;

      setMessage('Opening this account’s database…');
      try {
        await ensureDatabaseFor(desired);
      } catch (cause) {
        setStatus('error');
        setMessage(`Could not open that account’s database: ${describe(cause)}`);
        return;
      }
      window.location.reload();
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, session]);

  /* Sync on sign-in, on reconnect, and on a slow timer. */
  useEffect(() => {
    if (!supabase || !session?.user) return;

    void syncNow();

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void syncNow();
    }, SYNC_INTERVAL_MS);

    const onOnline = () => void syncNow();
    window.addEventListener('online', onOnline);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', onOnline);
    };
  }, [session, syncNow]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) return 'This build has no backend.';
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? error.message : null;
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    if (!supabase) return 'This build has no backend.';
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) return error.message;
    setMessage('Account created. If your project asks for confirmation, check your email first.');
    return null;
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setStatus('idle');
    setMessage('Signed out. Games stay saved on this device.');
  }, []);

  return {
    configured: syncConfigured,
    disabledReason: syncDisabledReason,
    ready,
    email: session?.user?.email ?? null,
    status,
    message,
    pending,
    database,
    signIn,
    signUp,
    signOut,
    syncNow,
  };
}
