/**
 * Asserts the FormData payload that `CheckinForm` hands to `onSubmit` for
 * the two flows that have to keep working: a non-game unit (location + place
 * + message, no GPS fields) and a GPS-enforced game unit (adds `gps_location`
 * and `gps_accuracy_m`). The page-level `CheckinCreate` only forwards this
 * payload to `apiFetch`, so the contract checked here is what hits the API.
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));

// No-op map stubs — the tests don't assert on map contents. React 19 treats
// `ref` as a regular prop, so an ignored ref on a function component is fine.
jest.mock('react-map-gl/maplibre', () => ({
  __esModule: true,
  default: () => null,
  Layer: () => null,
  Source: () => null,
  Marker: () => null,
}));

jest.mock('@maptiler/client', () => ({
  config: {},
  geocoding: {
    forward: jest.fn().mockResolvedValue({
      features: [
        {
          id: 'feat-1',
          text: 'London Bridge',
          place_name: 'London Bridge, London, United Kingdom',
          center: [-0.0876, 51.5079],
          context: [{ id: 'country.gb', text: 'United Kingdom' }],
        },
      ],
    }),
  },
}));

jest.mock('@marsidev/react-turnstile', () => ({
  __esModule: true,
  Turnstile: () => null,
}));

jest.mock('../lib/captureGpsLocation', () => ({
  __esModule: true,
  captureGpsLocation: jest.fn(),
}));

jest.mock('../lib/imageConversion', () => ({
  __esModule: true,
  convertToWebP: async (f: File) => f,
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
  // Identity — keep the pin where the user dropped it, no clamping.
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
  useAuth: () => ({ isAuthenticated: true, refresh: jest.fn() }),
}));

jest.mock('../lib/useConfig', () => ({
  __esModule: true,
  useConfig: () => ({
    maptilerKey: 'TEST_KEY',
    turnstileSiteKey: '',
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
import { captureGpsLocation } from '../lib/captureGpsLocation';

const mockCapture = jest.mocked(captureGpsLocation);

function readFormData(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) {
    out[k] = typeof v === 'string' ? v : '(file)';
  }
  return out;
}

describe('CheckinForm submit payload', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('non-game unit: posts location + place + message, no GPS fields', async () => {
    const onSubmit = jest.fn().mockResolvedValue(null);
    render(
      <CheckinForm
        mode="create"
        unitUrl="/unit/abc/"
        maptilerKey="TEST_KEY"
        gpsDriftFloorM={0}
        onSubmit={onSubmit}
      />,
    );

    // Select a location via the geocoding dropdown (cheaper than driving a
    // real map click — the form's setLocation runs the same code path).
    fireEvent.change(screen.getByPlaceholderText(/Search for a place/i), {
      target: { value: 'London' },
    });
    const result = await screen.findByRole('button', {
      name: /London Bridge/i,
    });
    fireEvent.click(result);

    fireEvent.change(screen.getByLabelText(/^Message/i), {
      target: { value: 'Found it near the market!' },
    });

    fireEvent.click(screen.getByRole('button', { name: /^Check in$/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const fd = onSubmit.mock.calls[0][0] as FormData;
    const entries = readFormData(fd);

    expect(JSON.parse(entries.location)).toEqual({
      type: 'Point',
      coordinates: [-0.0876, 51.5079],
    });
    expect(entries.place).toBe('London Bridge, United Kingdom');
    expect(entries.message).toBe('Found it near the market!');
    expect(fd.has('gps_location')).toBe(false);
    expect(fd.has('gps_accuracy_m')).toBe(false);
  });

  it('GPS-enforced unit: posts location + gps_location + gps_accuracy_m + place', async () => {
    mockCapture.mockResolvedValue({
      kind: 'ok',
      position: {
        latitude: 51.5074,
        longitude: -0.1278,
        accuracyM: 18,
        altitude: null,
      },
      isLowPrecision: false,
    });

    const onSubmit = jest.fn().mockResolvedValue(null);
    render(
      <CheckinForm
        mode="create"
        unitUrl="/unit/abc/"
        maptilerKey="TEST_KEY"
        isGpsEnforced
        gpsDriftFloorM={50}
        onSubmit={onSubmit}
      />,
    );

    // Pre-capture: only the "Use my location" button is rendered inside the
    // map placeholder. Submit stays disabled until confirmStep is set.
    fireEvent.click(screen.getByRole('button', { name: /Use my location/i }));

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /^Check in$/i }),
      ).not.toBeDisabled(),
    );

    fireEvent.change(screen.getByLabelText(/^Place/i), {
      target: { value: 'London Bridge' },
    });

    fireEvent.click(screen.getByRole('button', { name: /^Check in$/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const fd = onSubmit.mock.calls[0][0] as FormData;
    const entries = readFormData(fd);

    expect(JSON.parse(entries.location)).toEqual({
      type: 'Point',
      coordinates: [-0.1278, 51.5074],
    });
    expect(JSON.parse(entries.gps_location)).toEqual({
      type: 'Point',
      coordinates: [-0.1278, 51.5074],
    });
    expect(entries.gps_accuracy_m).toBe('18');
    expect(entries.place).toBe('London Bridge');
  });
});
