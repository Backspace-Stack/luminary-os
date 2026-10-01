import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Self-hosted variable fonts for the Theme Center. Declaring all
// families is cheap — the browser downloads a font only when the
// active theme actually uses it.
import '@fontsource-variable/inter';
import '@fontsource-variable/source-serif-4';
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/sora';
import '@fontsource-variable/manrope';
import '@fontsource-variable/jetbrains-mono';

import { bootTheme } from './theme/engine';

// Project the persisted theme onto CSS variables BEFORE React
// renders — the first painted frame is already in-theme.
bootTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
