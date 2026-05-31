/**
 * Covers the local state machine that wraps Cloudflare's invisible Turnstile
 * widget: surfacing a retry UI on `onError`, resetting the widget on retry
 * and `onExpire`, and reacting to a server-side `captcha` error returned by
 * `onSubmit`. The widget itself is stubbed — these tests assert what
 * `CheckinForm` does with the callbacks Cloudflare hands it, not Cloudflare's
 * own behavior.
 */
import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';

jest.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));

jest.mock('react-map-gl/maplibre', () => ({
  __esModule: true,
  default: () => null,
  Layer: () => null,
  Source: () => null,
  Marker: () => null,
}));

jest.mock('@maptiler/client', () => ({
  config: {},
  geocoding: { forward: jest.fn().mockResolvedValue({ features: [] }) },
}));

// Capture the latest Turnstile props so tests can fire onSuccess/onError/
// onExpire by hand, and assert that `.reset()` was called on the imperative
// handle the form holds via ref.
type TurnstileProps = {
  onSuccess?: (token: string) => void;
  onError?: () => void;
  onExpire?: () => void;
};
let lastTurnstileProps: TurnstileProps | null = null;
const mockTurnstileReset = jest.fn();
jest.mock('@marsidev/react-turnstile', () => {
  // Lazy-require React inside the factory: jest hoists `jest.mock` above
  // imports, so anything captured from the outer scope here would be
  // undefined at evaluation time.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactLazy = require('react');
  return {
    __esModule: true,
    Turnstile: ReactLazy.forwardRef(function MockTurnstile(
      props: TurnstileProps,
      ref: React.Ref<{ reset: () => void }>,
    ) {
      lastTurnstileProps = props;
      ReactLazy.useImperativeHandle(ref, () => ({
        reset: mockTurnstileReset,
      }));
      return null;
    }),
  };
});

jest.mock('../lib/captureGpsLocation', () => ({
  __esModule: true,
  captureGpsLocation: jest.fn(),
}));

jest.mock('../lib/imageConversion', () => ({
  __esModule: true,
  downscaleImage: async (f: File) => f,
}));

jest.mock('../lib/sentry', () => ({
  __esModule: true,
  reportError: jest.fn(),
  isNetworkError: () => false,
}));

jest.mock('../lib/maps', () => ({
  __esModule: true,
  geodesicCirclePolygon: () => ({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [] },
    properties: {},
  }),
  zoomForDriftRadius: () => 16,
}));

jest.mock('../lib/haversine', () => ({
  __esModule: true,
  clampToCircle: (
    _clat: number,
    _clng: number,
    _r: number,
    lat: number,
    lng: number,
  ) => [lat, lng],
}));

jest.mock('../AuthContext', () => ({
  __esModule: true,
  useAuth: () => ({
    isAuthenticated: false,
    username: '',
    name: '',
    adminUrl: null,
    loading: false,
    refresh: jest.fn(),
  }),
}));

jest.mock('../lib/useConfig', () => ({
  __esModule: true,
  useConfig: () => ({
    maptilerKey: 'TEST_KEY',
    turnstileSiteKey: 'TEST_TURNSTILE',
    allowRegistration: false,
  }),
}));

jest.mock('../components/PhotoUpload', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../components/LocationDeniedModal', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../components/LowPrecisionLocationModal', () => ({
  __esModule: true,
  default: () => null,
}));

import CheckinForm from '../components/CheckinForm';

function renderForm({
  onSubmit = jest.fn().mockResolvedValue(null),
  withLocation = false,
}: {
  onSubmit?: jest.Mock;
  withLocation?: boolean;
} = {}): jest.Mock {
  render(
    <CheckinForm
      mode="create"
      unitUrl="/unit/abc/"
      maptilerKey="TEST_KEY"
      gpsDriftFloorM={0}
      onUploadImage={jest.fn()}
      onSubmit={onSubmit}
      initialData={withLocation ? { location: '51.5074,-0.1278' } : undefined}
    />,
  );
  return onSubmit;
}

describe('CheckinForm Turnstile state', () => {
  beforeEach(() => {
    lastTurnstileProps = null;
    mockTurnstileReset.mockClear();
  });

  it('shows the retry UI when the widget fires onError', () => {
    renderForm();
    expect(lastTurnstileProps).not.toBeNull();

    act(() => {
      lastTurnstileProps?.onError?.();
    });

    expect(
      screen.getByText(/couldn't verify you weren't a bot/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /try the check again/i }),
    ).toBeInTheDocument();
  });

  it('retry button calls reset() and clears the error UI', () => {
    renderForm();

    act(() => {
      lastTurnstileProps?.onError?.();
    });
    fireEvent.click(
      screen.getByRole('button', { name: /try the check again/i }),
    );

    expect(mockTurnstileReset).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByText(/couldn't verify you weren't a bot/i),
    ).not.toBeInTheDocument();
  });

  it('onSuccess after an error clears the retry UI', () => {
    renderForm();

    act(() => {
      lastTurnstileProps?.onError?.();
    });
    expect(
      screen.getByText(/couldn't verify you weren't a bot/i),
    ).toBeInTheDocument();

    act(() => {
      lastTurnstileProps?.onSuccess?.('new-token');
    });

    expect(
      screen.queryByText(/couldn't verify you weren't a bot/i),
    ).not.toBeInTheDocument();
  });

  it('onExpire resets the widget so a fresh token can be issued', () => {
    renderForm();

    act(() => {
      lastTurnstileProps?.onSuccess?.('first-token');
    });
    act(() => {
      lastTurnstileProps?.onExpire?.();
    });

    expect(mockTurnstileReset).toHaveBeenCalledTimes(1);
  });

  it('surfaces the retry UI when onSubmit returns a captcha field error', async () => {
    const onSubmit = jest
      .fn()
      .mockResolvedValue({ captcha: ['Captcha verification failed.'] });
    renderForm({ onSubmit, withLocation: true });

    // Hand the form a token so it actually reaches the server (the server
    // is what rejects in this scenario, simulating a stale or replayed
    // token).
    act(() => {
      lastTurnstileProps?.onSuccess?.('stale-token');
    });

    fireEvent.click(screen.getByRole('button', { name: /^Check in$/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].turnstile_token).toBe('stale-token');

    expect(
      await screen.findByText(/couldn't verify you weren't a bot/i),
    ).toBeInTheDocument();

    // Retry clears the field error on top of resetting the widget.
    fireEvent.click(
      screen.getByRole('button', { name: /try the check again/i }),
    );
    expect(mockTurnstileReset).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByText(/couldn't verify you weren't a bot/i),
    ).not.toBeInTheDocument();
  });
});
