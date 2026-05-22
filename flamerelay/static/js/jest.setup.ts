import './i18n';

// jsdom does not implement matchMedia; components that gate on
// prefers-reduced-motion (e.g. PhotoUpload) read it at module load, so the
// polyfill has to happen before any component import.
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }),
  });
}

jest.mock('@sentry/react', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  setUser: jest.fn(),
  reactRouterV7BrowserTracingIntegration: jest.fn(),
  replayIntegration: jest.fn(),
  reactErrorHandler: jest.fn(),
}));
