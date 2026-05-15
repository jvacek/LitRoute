import {
  captureGpsLocation,
  GPS_LOW_PRECISION_THRESHOLD_M,
} from '../lib/captureGpsLocation';

/**
 * Build a fake Geolocation that drives `watchPosition` callbacks under test
 * control. `feed` lets each test push positions or errors at will and decide
 * when the watch resolves; the rest of the test reads the promise outcome.
 */
function makeFakeGeolocation() {
  let successCb: PositionCallback | null = null;
  let errorCb: PositionErrorCallback | null = null;
  let cleared = false;

  const geolocation = {
    watchPosition(
      onSuccess: PositionCallback,
      onError?: PositionErrorCallback | null,
    ): number {
      successCb = onSuccess;
      errorCb = onError ?? null;
      return 1;
    },
    clearWatch() {
      cleared = true;
    },
    getCurrentPosition() {
      // Unused by captureGpsLocation, but required to satisfy the Geolocation
      // structural type.
    },
  } as unknown as Geolocation;

  return {
    geolocation,
    feedPosition(coords: {
      latitude?: number;
      longitude?: number;
      accuracy: number;
      altitude?: number | null;
    }) {
      successCb?.({
        timestamp: Date.now(),
        coords: {
          latitude: coords.latitude ?? 51.5,
          longitude: coords.longitude ?? -0.12,
          accuracy: coords.accuracy,
          altitude: coords.altitude ?? null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
          toJSON() {
            return this;
          },
        },
        toJSON() {
          return this;
        },
      } as GeolocationPosition);
    },
    feedError(code: 1 | 2 | 3, message = '') {
      errorCb?.({
        code,
        message,
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      } as GeolocationPositionError);
    },
    isCleared() {
      return cleared;
    },
  };
}

/**
 * Hand-rolled timer harness — jest's fake-timers play poorly with the
 * watchPosition callbacks since both schedule onto the same queue and would
 * fire synchronously in a way that breaks fix-then-budget ordering tests.
 * The harness lets the test fire the budget timeout explicitly.
 */
function makeTimerHarness() {
  let pendingCb: (() => void) | null = null;
  let pendingId = 0;
  let nextId = 100;

  return {
    setTimeoutFn(cb: () => void): number {
      pendingCb = cb;
      pendingId = nextId++;
      return pendingId;
    },
    clearTimeoutFn(id: number) {
      if (id === pendingId) pendingCb = null;
    },
    fireBudget() {
      const cb = pendingCb;
      pendingCb = null;
      cb?.();
    },
    hasPending() {
      return pendingCb !== null;
    },
  };
}

describe('captureGpsLocation', () => {
  it('returns no-geolocation when the browser lacks the API', async () => {
    const result = await captureGpsLocation({
      geolocation: undefined,
    });
    expect(result).toEqual({ kind: 'no-geolocation' });
  });

  it('exits early on a sub-goodEnoughM fix without waiting for the budget', async () => {
    const fake = makeFakeGeolocation();
    const timers = makeTimerHarness();

    const promise = captureGpsLocation({
      geolocation: fake.geolocation,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });
    fake.feedPosition({ accuracy: 25, altitude: 12 });

    const result = await promise;
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.position.accuracyM).toBe(25);
      expect(result.isLowPrecision).toBe(false);
    }
    expect(fake.isCleared()).toBe(true);
    expect(timers.hasPending()).toBe(false);
  });

  it('flags isLowPrecision when the best fix is above the threshold', async () => {
    const fake = makeFakeGeolocation();
    const timers = makeTimerHarness();

    const promise = captureGpsLocation({
      geolocation: fake.geolocation,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });
    fake.feedPosition({ accuracy: GPS_LOW_PRECISION_THRESHOLD_M + 500 });
    timers.fireBudget();

    const result = await promise;
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.isLowPrecision).toBe(true);
    }
  });

  it('keeps the best (lowest-accuracy) reading across multiple updates', async () => {
    const fake = makeFakeGeolocation();
    const timers = makeTimerHarness();

    const promise = captureGpsLocation({
      geolocation: fake.geolocation,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });
    fake.feedPosition({ accuracy: 800 });
    fake.feedPosition({ accuracy: 200 });
    fake.feedPosition({ accuracy: 1200 }); // worse, should be ignored
    timers.fireBudget();

    const result = await promise;
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.position.accuracyM).toBe(200);
      expect(result.isLowPrecision).toBe(false);
    }
  });

  it('returns no-fix when the budget elapses with no callbacks', async () => {
    const fake = makeFakeGeolocation();
    const timers = makeTimerHarness();

    const promise = captureGpsLocation({
      geolocation: fake.geolocation,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });
    timers.fireBudget();

    const result = await promise;
    expect(result).toEqual({ kind: 'no-fix' });
  });

  it('returns denied on PERMISSION_DENIED', async () => {
    const fake = makeFakeGeolocation();
    const timers = makeTimerHarness();

    const promise = captureGpsLocation({
      geolocation: fake.geolocation,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });
    fake.feedError(1);

    const result = await promise;
    expect(result).toEqual({ kind: 'denied' });
    expect(fake.isCleared()).toBe(true);
  });

  it('returns denied on POSITION_UNAVAILABLE', async () => {
    const fake = makeFakeGeolocation();
    const timers = makeTimerHarness();

    const promise = captureGpsLocation({
      geolocation: fake.geolocation,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });
    fake.feedError(2);

    expect(await promise).toEqual({ kind: 'denied' });
  });

  it('settles with the best prior fix when TIMEOUT fires mid-watch', async () => {
    const fake = makeFakeGeolocation();
    const timers = makeTimerHarness();

    const promise = captureGpsLocation({
      geolocation: fake.geolocation,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });
    fake.feedPosition({ accuracy: 400 });
    fake.feedError(3); // TIMEOUT

    const result = await promise;
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.position.accuracyM).toBe(400);
  });

  it('returns no-fix when TIMEOUT fires without any prior reading', async () => {
    const fake = makeFakeGeolocation();
    const timers = makeTimerHarness();

    const promise = captureGpsLocation({
      geolocation: fake.geolocation,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });
    fake.feedError(3);

    expect(await promise).toEqual({ kind: 'no-fix' });
  });

  it('clears the watch and the timeout exactly once on settle', async () => {
    const fake = makeFakeGeolocation();
    const timers = makeTimerHarness();

    const promise = captureGpsLocation({
      geolocation: fake.geolocation,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });
    fake.feedPosition({ accuracy: 10 });
    await promise;
    // After settle the watch is cleared and the pending budget is cancelled.
    expect(fake.isCleared()).toBe(true);
    expect(timers.hasPending()).toBe(false);
  });
});
