import React from 'react';
import ReactDOM from 'react-dom/client';
import { HotkeysProvider } from 'react-hotkeys-hook';

import App from './App';
import { AccessTokenGate } from './components/AccessTokenGate';
import { sweepExpiredDrafts } from './hooks/useCommentDrafts';
import './styles/fonts';
import './styles/global.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

sweepExpiredDrafts();

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <HotkeysProvider initiallyActiveScopes={['navigation']}>
      <AccessTokenGate>
        <App />
      </AccessTokenGate>
    </HotkeysProvider>
  </React.StrictMode>,
);
