import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, syncConfigured } from './client.ts';
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
  /** False until the stored session has been read once. */
  ready: boolean;
  email: string | null;
  status: SyncStatus;
  /** Human-readable result or failure of the last attempt. */
  message: string | null;
  /** Local changes not yet uploaded. */
  pending: number;
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
      const report = await runSync(session.user.id);
      setStatus('idle');
      setMessage(
        report.pulled + report.pushed === 0
          ? 'Everything is up to date.'
          : `Synced ${report.pushed} up, ${report.pulled} down.`,
      );
      await refreshPending();
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

  /* Keep the pending count honest even when signed out. */
  useEffect(() => {
    void refreshPending();
  }, [refreshPending]);

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
    ready,
    email: session?.user?.email ?? null,
    status,
    message,
    pending,
    signIn,
    signUp,
    signOut,
    syncNow,
  };
}
