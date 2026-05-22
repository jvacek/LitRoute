/**
 * Covers the state-machine plumbing that connects `convertToWebP` to the
 * UI flags `PhotoUpload` reads. The visual rendering of those flags is
 * covered in `PhotoUpload.test.tsx`; here we drive a controllable mock of
 * `convertToWebP` and assert what ends up in the FormData that `CheckinForm`
 * hands to `onSubmit` — i.e., whether the converted file or the original
 * survives a happy path, a rejection, and a remove-mid-conversion race.
 */
import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

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
  convertToWebP: jest.fn(),
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

jest.mock('../components/LocationDeniedModal', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../components/LowPrecisionLocationModal', () => ({
  __esModule: true,
  default: () => null,
}));

// PhotoUpload's preview useEffect calls URL.createObjectURL on each new
// File; jsdom doesn't implement it.
beforeAll(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    value: () => `blob:test-${Math.random().toString(36).slice(2)}`,
    writable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: () => undefined,
    writable: true,
  });
});

import CheckinForm from '../components/CheckinForm';
import { convertToWebP } from '../lib/imageConversion';
import { useAuth } from '../AuthContext';

const convertMock = jest.mocked(convertToWebP);
const mockUseAuth = jest.mocked(useAuth);

function deferredFile() {
  let resolve!: (f: File) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<File>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function pickLocationLondon() {
  fireEvent.change(screen.getByPlaceholderText(/Search for a place/i), {
    target: { value: 'London' },
  });
  const result = await screen.findByRole('button', {
    name: /London Bridge/i,
  });
  fireEvent.click(result);
}

function addFile(file: File) {
  const input = document.getElementById('images') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], writable: true });
  fireEvent.change(input);
}

describe('CheckinForm shrinking state machine', () => {
  beforeEach(() => {
    convertMock.mockReset();
    // Default: conversion hangs. Individual tests resolve or reject as needed.
    convertMock.mockReturnValue(new Promise<File>(() => undefined));
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      username: 'tester',
      name: 'Tester',
      adminUrl: null,
      loading: false,
      refresh: jest.fn(),
    });
  });

  it('swaps the original file for the converted file in the submit payload', async () => {
    const conv = deferredFile();
    convertMock.mockReset();
    convertMock.mockReturnValueOnce(conv.promise);
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

    await pickLocationLondon();
    addFile(new File(['orig'], 'photo.heic', { type: 'image/heic' }));

    // Spinner is visible while convertToWebP is pending.
    await screen.findByRole('status', { name: /Shrinking image/i });

    await act(async () => {
      conv.resolve(
        new File(['converted'], 'photo.webp', { type: 'image/webp' }),
      );
    });

    await waitFor(() =>
      expect(
        screen.queryByRole('status', { name: /Shrinking image/i }),
      ).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /^Check in$/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const fd = onSubmit.mock.calls[0][0] as FormData;
    const uploaded = fd.getAll('images') as File[];
    expect(uploaded.map((f) => f.name)).toEqual(['photo.webp']);
  });

  it('keeps the original file and surfaces the fallback badge on rejection', async () => {
    const conv = deferredFile();
    convertMock.mockReset();
    convertMock.mockReturnValueOnce(conv.promise);
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

    await pickLocationLondon();
    addFile(new File(['orig'], 'photo.heic', { type: 'image/heic' }));

    await screen.findByRole('status', { name: /Shrinking image/i });

    await act(async () => {
      conv.reject(new Error('decode failed'));
    });

    expect(
      await screen.findByLabelText(/Couldn't shrink — uploading original/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Check in$/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const fd = onSubmit.mock.calls[0][0] as FormData;
    const uploaded = fd.getAll('images') as File[];
    expect(uploaded.map((f) => f.name)).toEqual(['photo.heic']);
  });

  it('drops a late-resolving conversion if the image was removed mid-shrink', async () => {
    const conv = deferredFile();
    convertMock.mockReset();
    convertMock.mockReturnValueOnce(conv.promise);

    render(
      <CheckinForm
        mode="create"
        unitUrl="/unit/abc/"
        maptilerKey="TEST_KEY"
        gpsDriftFloorM={0}
        onSubmit={jest.fn()}
      />,
    );

    addFile(new File(['orig'], 'photo.heic', { type: 'image/heic' }));

    await screen.findByRole('status', { name: /Shrinking image/i });

    fireEvent.click(screen.getByRole('button', { name: /Remove photo/i }));

    expect(
      screen.queryByRole('status', { name: /Shrinking image/i }),
    ).not.toBeInTheDocument();

    // Late resolve must not resurrect the thumbnail or throw.
    await act(async () => {
      conv.resolve(
        new File(['converted'], 'photo.webp', { type: 'image/webp' }),
      );
    });

    expect(
      screen.queryByRole('status', { name: /Shrinking image/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByAltText(/Preview/i)).not.toBeInTheDocument();
  });
});
