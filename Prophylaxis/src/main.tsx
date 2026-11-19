import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { ThemeProvider } from './theme/ThemeProvider.tsx';
/* Loaded last so the premium surface layer wins over feature stylesheets. */
import './premium.css';
/* After everything: the one viewport-height frame the board rooms share. */
import './workbench.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
