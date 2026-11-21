import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { ThemeProvider } from './theme/ThemeProvider.tsx';
import {
  bootstrapDatabase,
  bootstrapPreferences,
  bootstrapSyncQueue,
} from './sync/bootstrap.ts';
/* Loaded last so the premium surface layer wins over feature stylesheets. */
import './premium.css';
/* After everything: the one viewport-height frame the board rooms share. */
import './workbench.css';
/* Last: the phone layout that settles the workbench rules at hand size. */
import './mobile.css';

const root = createRoot(document.getElementById('root')!);

let painted = false;

function paint() {
  if (painted) return;
  painted = true;
  root.render(
    <StrictMode>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </StrictMode>,
  );
}

/**
 * Open the signed-in account's own database before the first paint, so the app
 * never shows one person's library for a frame on the way to another's.
 *
 * The deadline matters as much as the switch: opening IndexedDB can hang — a
 * second window still holding an older schema version, a profile stuck
 * mid-upgrade, storage the browser refuses to open — and the old code waited on
 * it before rendering anything, so a reload could leave a blank page with no
 * error to look at. A slow start is recoverable; a blank window is not.
 */
const BOOT_DEADLINE_MS = 2500;
const deadline = new Promise<void>((resolve) => {
  window.setTimeout(resolve, BOOT_DEADLINE_MS);
});

void Promise.race([bootstrapDatabase().then(bootstrapPreferences), deadline])
  .catch((cause: unknown) => {
    if (import.meta.env.DEV) console.warn('[boot] the database switch failed', cause);
  })
  .finally(() => {
    paint();
    /* Seeding and the account's own name read the whole library and the
       network; neither belongs in front of the first frame, and a stalled
       request there must not surface as an unhandled rejection either. */
    void bootstrapSyncQueue().catch((cause: unknown) => {
      if (import.meta.env.DEV) console.warn('[boot] the sync queue did not start', cause);
    });
  });
