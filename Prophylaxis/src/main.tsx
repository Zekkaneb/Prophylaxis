import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { ThemeProvider } from './theme/ThemeProvider.tsx';
import { bootstrapDatabase, bootstrapSyncQueue } from './sync/bootstrap.ts';
/* Loaded last so the premium surface layer wins over feature stylesheets. */
import './premium.css';
/* After everything: the one viewport-height frame the board rooms share. */
import './workbench.css';
/* Last: the phone layout that settles the workbench rules at hand size. */
import './mobile.css';

/* Open the signed-in account's own database before the first paint, so the app
   never shows one person's library for a frame on the way to another's. */
const root = createRoot(document.getElementById('root')!);

void bootstrapDatabase()
  .then(() => bootstrapSyncQueue())
  .finally(() => {
  root.render(
    <StrictMode>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </StrictMode>,
  );
  });
