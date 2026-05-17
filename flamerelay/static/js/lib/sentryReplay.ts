import * as Sentry from '@sentry/react';

// Loaded via dynamic import from project.tsx after first paint so the ~150 KB
// minified @sentry-internal/replay payload stays out of the entry bundle.
// Sentry.init still runs synchronously above so early errors are captured;
// replay's rolling buffer only starts recording once this integration lands,
// so errors fired in the brief warmup window won't have replay footage.
export function enableReplay() {
  Sentry.addIntegration(
    Sentry.replayIntegration({
      maskAllText: false,
      maskAllInputs: true,
      blockAllMedia: true,
    }),
  );
}
