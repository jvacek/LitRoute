import { isNetworkError } from '../lib/sentry';

describe('isNetworkError', () => {
  // Each browser's fetch() throws a TypeError with its own message when the
  // request dies on the wire. Keep these in sync with the patterns matched in
  // sentry.ts — false positives in either direction matter here.
  it.each([
    ['iOS Safari', 'Load failed'],
    ['Chromium', 'Failed to fetch'],
    ['Firefox', 'NetworkError when attempting to fetch resource.'],
  ])('flags %s fetch failures', (_browser, message) => {
    expect(isNetworkError(new TypeError(message))).toBe(true);
  });

  it('flags AbortError DOMExceptions (user/page aborted the request)', () => {
    expect(isNetworkError(new DOMException('aborted', 'AbortError'))).toBe(
      true,
    );
  });

  it('ignores unrelated TypeErrors', () => {
    expect(isNetworkError(new TypeError("Cannot read 'x' of undefined"))).toBe(
      false,
    );
  });

  it('ignores non-Error inputs and other error shapes', () => {
    expect(isNetworkError(new Error('Load failed'))).toBe(false);
    expect(isNetworkError('Load failed')).toBe(false);
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
  });
});
