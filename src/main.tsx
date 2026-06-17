import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import './styles/panels.css';
import './styles/timeline.css';
import './styles/components.css';
import App from './App';

// #region agent log
const debugMainLog = (hypothesisId: string, message: string, data: Record<string, unknown> = {}) => {
  fetch('/__debug_ingest', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': '262bcc',
    },
    body: JSON.stringify({
      sessionId: '262bcc',
      runId: 'pre-fix',
      hypothesisId,
      location: 'main.tsx',
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
};

window.addEventListener('error', (e) => {
  debugMainLog('H0', 'window.error', {
    message: e.message,
    filename: (e as ErrorEvent).filename,
    lineno: (e as ErrorEvent).lineno,
    colno: (e as ErrorEvent).colno,
  });
});

window.addEventListener('unhandledrejection', (e) => {
  const reason = (e as PromiseRejectionEvent).reason;
  debugMainLog('H0', 'window.unhandledrejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
});
// #endregion

debugMainLog('H0', 'main.tsx starting');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
