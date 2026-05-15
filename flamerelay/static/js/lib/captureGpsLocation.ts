// Pure GPS-capture helper for the check-in flow. Lives in lib/ (not in the
// component) so it can be unit-tested without rendering the whole form.
//
// Strategy: use `watchPosition` rather than `getCurrentPosition` because the
// first reading is often a cached Wi-Fi/cell fix that upgrades to GNSS within
// a few seconds. We track the best (lowest-accuracy) reading and exit early
// once it crosses `goodEnoughM`, or settle with the best-so-far when the
// budget elapses.

export const GPS_GOOD_ENOUGH_M = 50;
export const GPS_LOW_PRECISION_THRESHOLD_M = 1000;
export const GPS_WATCH_BUDGET_MS = 6000;

export interface CapturedPosition {
  latitude: number;
  longitude: number;
  accuracyM: number;
  altitude: number | null;
}

export type CaptureGpsResult =
  | {
      kind: 'ok';
      position: CapturedPosition;
      // True when the best fix is coarser than `lowPrecisionThresholdM`.
      // Caller decides whether to prompt the user (we still accept the fix).
      isLowPrecision: boolean;
    }
  // PERMISSION_DENIED or POSITION_UNAVAILABLE — needs a system-level fix.
  | { kind: 'denied' }
  // No `navigator.geolocation` at all (very old browser / insecure context).
  | { kind: 'no-geolocation' }
  // Watch budget elapsed without a single callback, or TIMEOUT with no
  // prior reading. Caller should show an inline retry message.
  | { kind: 'no-fix' };

export interface CaptureGpsOptions {
  goodEnoughM?: number;
  lowPrecisionThresholdM?: number;
  watchBudgetMs?: number;
  // Inject for tests; defaults to the real browser APIs.
  geolocation?: Geolocation;
  setTimeoutFn?: (cb: () => void, ms: number) => number;
  clearTimeoutFn?: (id: number) => void;
}

export function captureGpsLocation(
  opts: CaptureGpsOptions = {},
): Promise<CaptureGpsResult> {
  const goodEnoughM = opts.goodEnoughM ?? GPS_GOOD_ENOUGH_M;
  const lowPrecisionThresholdM =
    opts.lowPrecisionThresholdM ?? GPS_LOW_PRECISION_THRESHOLD_M;
  const watchBudgetMs = opts.watchBudgetMs ?? GPS_WATCH_BUDGET_MS;
  const geolocationOrNull =
    opts.geolocation ??
    (typeof navigator !== 'undefined' ? navigator.geolocation : undefined);
  const setTimeoutFn =
    opts.setTimeoutFn ?? ((cb, ms) => window.setTimeout(cb, ms));
  const clearTimeoutFn =
    opts.clearTimeoutFn ?? ((id) => window.clearTimeout(id));

  if (!geolocationOrNull) {
    return Promise.resolve({ kind: 'no-geolocation' });
  }
  // Bind to a non-nullable local so the closure below doesn't need re-narrowing.
  const geolocation: Geolocation = geolocationOrNull;

  return new Promise((resolve) => {
    let bestPos: GeolocationPosition | null = null;
    let settled = false;
    let watchId: number | null = null;
    let budgetTimeoutId: number | null = null;

    function finish(result: CaptureGpsResult) {
      if (settled) return;
      settled = true;
      if (watchId !== null) geolocation.clearWatch(watchId);
      if (budgetTimeoutId !== null) clearTimeoutFn(budgetTimeoutId);
      resolve(result);
    }

    function settleWithBestPos() {
      if (!bestPos) {
        finish({ kind: 'no-fix' });
        return;
      }
      const { latitude, longitude, accuracy, altitude } = bestPos.coords;
      finish({
        kind: 'ok',
        position: { latitude, longitude, accuracyM: accuracy, altitude },
        isLowPrecision: accuracy > lowPrecisionThresholdM,
      });
    }

    watchId = geolocation.watchPosition(
      (pos) => {
        if (!bestPos || pos.coords.accuracy < bestPos.coords.accuracy) {
          bestPos = pos;
        }
        if (pos.coords.accuracy <= goodEnoughM) {
          settleWithBestPos();
        }
      },
      (err) => {
        if (settled) return;
        if (
          err.code === err.PERMISSION_DENIED ||
          err.code === err.POSITION_UNAVAILABLE
        ) {
          finish({ kind: 'denied' });
        } else {
          // TIMEOUT — if we have any fix we use it; otherwise no-fix.
          settleWithBestPos();
        }
      },
      // maximumAge: 60_000 sidesteps the Chrome-on-macOS CoreLocation hang on
      // back-to-back calls — the first callback can fire from cache, then
      // the browser delivers fresh fixes as the radio warms up.
      { enableHighAccuracy: true, maximumAge: 60_000, timeout: 15_000 },
    );

    budgetTimeoutId = setTimeoutFn(settleWithBestPos, watchBudgetMs);
  });
}
