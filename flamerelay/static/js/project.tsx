import '../css/project.css';
import './fonts';
import './i18n';

import * as Sentry from '@sentry/react';
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createRoutesFromChildren,
  matchRoutes,
  useLocation,
  useNavigationType,
} from 'react-router-dom';
import App from './App';
import { GIT_COMMIT, SENTRY_DSN, SENTRY_ENVIRONMENT } from './env';

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: SENTRY_ENVIRONMENT || undefined,
    release: GIT_COMMIT || undefined,
    sendDefaultPii: true,
    // Forward envelopes through a same-origin endpoint so Safari ITP and
    // ad blockers don't drop traffic to *.ingest.sentry.io.
    tunnel: '/api/sentry/envelope/',
    integrations: [
      Sentry.reactRouterV7BrowserTracingIntegration({
        useEffect,
        useLocation,
        useNavigationType,
        createRoutesFromChildren,
        matchRoutes,
      }),
    ],
    tracesSampleRate: 1.0,
    // Same-origin relative URLs only — adds sentry-trace + baggage headers
    // to /api/* calls so frontend traces stitch onto backend traces.
    tracePropagationTargets: [/^\//],
    // No background recording. Record the ~30s leading up to errors only.
    replaysSessionSampleRate: 0.0,
    replaysOnErrorSampleRate: 1.0,
  });

  // Replay's ~150 KB minified bundle is loaded after first paint to keep the
  // entry small. Errors before the integration lands are still captured;
  // they just won't carry replay footage.
  const loadReplay = () =>
    import('./lib/sentryReplay')
      .then((m) => m.enableReplay())
      .catch(() => {
        // Swallow chunk-load failures — replay is a nice-to-have.
      });
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(loadReplay, { timeout: 2000 });
  } else {
    setTimeout(loadReplay, 1000);
  }
}

const appRoot = document.getElementById('app-root');
if (appRoot) {
  const errorHandler = Sentry.reactErrorHandler();
  createRoot(appRoot, {
    onUncaughtError: errorHandler,
    onCaughtError: errorHandler,
    onRecoverableError: errorHandler,
  }).render(<App />);
}
