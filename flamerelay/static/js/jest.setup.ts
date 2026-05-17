import './i18n';

jest.mock('@sentry/react', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  setUser: jest.fn(),
  reactRouterV7BrowserTracingIntegration: jest.fn(),
  replayIntegration: jest.fn(),
  reactErrorHandler: jest.fn(),
}));
