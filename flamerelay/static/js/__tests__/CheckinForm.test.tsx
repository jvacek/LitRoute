/**
 * Asserts the payload object that `CheckinForm` hands to `onSubmit` for the
 * two flows that have to keep working: a non-game unit (location + place
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
  useAuth: jest.fn(() => ({ isAuthenticated: true, refresh: jest.fn() })),
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
import { useAuth } from '../AuthContext';
import { captureGpsLocation } from '../lib/captureGpsLocation';

const mockCapture = jest.mocked(captureGpsLocation);
const mockUseAuth = jest.mocked(useAuth);

function gpsOk() {
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
}

async function captureAndWaitForReadySubmit() {
  fireEvent.click(screen.getByRole('button', { name: /Use my location/i }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: /^Check in$/i }),
    ).not.toBeDisabled(),
  );
}

// A no-op uploader is plenty for these payload-shape tests — no file is
// ever added through the input, so it should never actually be called.
const noopUpload = jest
  .fn<Promise<{ token: string; previewUrl: string }>, [File, string?]>()
  .mockResolvedValue({ token: 'unused', previewUrl: 'unused' });

describe('CheckinForm submit payload', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      username: 'tester',
      name: 'Tester',
      adminUrl: null,
      loading: false,
      refresh: jest.fn(),
    });
  });

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
        onUploadImage={noopUpload}
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
    const payload = onSubmit.mock.calls[0][0];

    expect(payload.location).toEqual({
      type: 'Point',
      coordinates: [-0.0876, 51.5079],
    });
    expect(payload.place).toBe('London Bridge, United Kingdom');
    expect(payload.message).toBe('Found it near the market!');
    expect(payload.gps_location).toBeUndefined();
    expect(payload.gps_accuracy_m).toBeUndefined();
    expect(payload.pending_image_tokens).toEqual([]);
  });

  it('GPS-enforced unit: posts location + gps_location + gps_accuracy_m + place', async () => {
    gpsOk();
    const onSubmit = jest.fn().mockResolvedValue(null);
    render(
      <CheckinForm
        mode="create"
        unitUrl="/unit/abc/"
        maptilerKey="TEST_KEY"
        isGpsEnforced
        gpsDriftFloorM={50}
        onUploadImage={noopUpload}
        onSubmit={onSubmit}
      />,
    );

    await captureAndWaitForReadySubmit();

    fireEvent.change(screen.getByLabelText(/^Place/i), {
      target: { value: 'London Bridge' },
    });

    fireEvent.click(screen.getByRole('button', { name: /^Check in$/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0][0];

    expect(payload.location).toEqual({
      type: 'Point',
      coordinates: [-0.1278, 51.5074],
    });
    expect(payload.gps_location).toEqual({
      type: 'Point',
      coordinates: [-0.1278, 51.5074],
    });
    expect(payload.gps_accuracy_m).toBe(18);
    expect(payload.place).toBe('London Bridge');
  });

  it('non-game unit: blocks submit + surfaces location error when no pin set', async () => {
    const onSubmit = jest.fn().mockResolvedValue(null);
    render(
      <CheckinForm
        mode="create"
        unitUrl="/unit/abc/"
        maptilerKey="TEST_KEY"
        gpsDriftFloorM={0}
        onUploadImage={noopUpload}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Check in$/i }));

    expect(
      await screen.findByText(/click the map to set your location/i),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('GPS-enforced unit: blocks submit when place has < 3 word chars', async () => {
    gpsOk();
    const onSubmit = jest.fn().mockResolvedValue(null);
    render(
      <CheckinForm
        mode="create"
        unitUrl="/unit/abc/"
        maptilerKey="TEST_KEY"
        isGpsEnforced
        gpsDriftFloorM={50}
        onUploadImage={noopUpload}
        onSubmit={onSubmit}
      />,
    );

    await captureAndWaitForReadySubmit();

    fireEvent.change(screen.getByLabelText(/^Place/i), {
      target: { value: 'ab' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Check in$/i }));

    expect(
      await screen.findByText(/at least 3 letters so your check-in counts/i),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('GPS-enforced + anonymous: blocks submit when anonymous_name is empty', async () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      username: '',
      name: '',
      adminUrl: null,
      loading: false,
      refresh: jest.fn(),
    });
    gpsOk();
    const onSubmit = jest.fn().mockResolvedValue(null);
    render(
      <CheckinForm
        mode="create"
        unitUrl="/unit/abc/"
        maptilerKey="TEST_KEY"
        isGpsEnforced
        gpsDriftFloorM={50}
        onUploadImage={noopUpload}
        onSubmit={onSubmit}
      />,
    );

    await captureAndWaitForReadySubmit();

    fireEvent.change(screen.getByLabelText(/^Place/i), {
      target: { value: 'London Bridge' },
    });
    // Leave the (required) Your name field blank.
    fireEvent.click(screen.getByRole('button', { name: /^Check in$/i }));

    expect(
      await screen.findByText(/add a name so your check-in counts/i),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
