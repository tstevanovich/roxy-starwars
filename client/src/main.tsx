import './styles.scss';

import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App.tsx';
import AuthGate from './AuthGate.tsx';
import { theme } from './theme.ts';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthGate>{(account) => <App account={account} />}</AuthGate>
    </ThemeProvider>
  </StrictMode>
);
