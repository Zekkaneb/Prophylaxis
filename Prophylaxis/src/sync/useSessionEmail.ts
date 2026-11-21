import { useEffect, useState } from 'react';
import { supabase } from './client.ts';

/**
 * Who is signed in, for screens that only need to know whether this is an
 * account or the anonymous app.
 *
 * Deliberately smaller than `useSync`: no polling, no queue bookkeeping, just the
 * session and a subscription, so a page can branch on it without starting a
 * second sync loop.
 */
export function useSessionEmail(): string | null {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let active = true;

    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) setEmail(data.session?.user.email ?? null);
      })
      .catch(() => {
        /* a session read that fails is the same as being signed out here */
      });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setEmail(session?.user.email ?? null);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return email;
}
