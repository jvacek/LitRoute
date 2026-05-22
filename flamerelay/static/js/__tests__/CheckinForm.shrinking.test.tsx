/**
 * Covers the state-machine plumbing that connects `convertToWebP` to the
 * UI flags `PhotoUpload` reads. The visual rendering of those flags is
 * covered in `PhotoUpload.test.tsx`; here we drive a controllable mock of
 * `convertToWebP` and assert which `File` the form hands to `onUploadImage`
 * — i.e., whether the converted (resized webp) file or the original
 * (untouched) file survives a happy path, a rejection, and a remove-
 * mid-conversion race.
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
import { PendingUploadError } from '../lib/uploadPendingImage';
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

  it('hands the converted file to onUploadImage and forwards the token to onSubmit', async () => {
    const conv = deferredFile();
    convertMock.mockReset();
    convertMock.mockReturnValueOnce(conv.promise);
    const onUploadImage = jest
      .fn()
      .mockResolvedValue({ token: 'tok-1', previewUrl: '/media/x.webp' });
    const onSubmit = jest.fn().mockResolvedValue(null);

    render(
      <CheckinForm
        mode="create"
        unitUrl="/unit/abc/"
        maptilerKey="TEST_KEY"
        gpsDriftFloorM={0}
        onUploadImage={onUploadImage}
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

    await waitFor(() => expect(onUploadImage).toHaveBeenCalledTimes(1));
    const uploadedFile = onUploadImage.mock.calls[0][0] as File;
    expect(uploadedFile.name).toBe('photo.webp');

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].pending_image_tokens).toEqual(['tok-1']);
  });

  it('hands the original file to onUploadImage when conversion rejects, and surfaces the fallback badge', async () => {
    const conv = deferredFile();
    convertMock.mockReset();
    convertMock.mockReturnValueOnce(conv.promise);
    const onUploadImage = jest
      .fn()
      .mockResolvedValue({ token: 'tok-2', previewUrl: '/media/y.heic' });
    const onSubmit = jest.fn().mockResolvedValue(null);

    render(
      <CheckinForm
        mode="create"
        unitUrl="/unit/abc/"
        maptilerKey="TEST_KEY"
        gpsDriftFloorM={0}
        onUploadImage={onUploadImage}
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

    await waitFor(() => expect(onUploadImage).toHaveBeenCalledTimes(1));
    const uploadedFile = onUploadImage.mock.calls[0][0] as File;
    expect(uploadedFile.name).toBe('photo.heic');

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].pending_image_tokens).toEqual(['tok-2']);
  });

  it('drops a late-resolving conversion if the image was removed mid-shrink', async () => {
    const conv = deferredFile();
    convertMock.mockReset();
    convertMock.mockReturnValueOnce(conv.promise);
    const onUploadImage = jest.fn();

    render(
      <CheckinForm
        mode="create"
        unitUrl="/unit/abc/"
        maptilerKey="TEST_KEY"
        gpsDriftFloorM={0}
        onUploadImage={onUploadImage}
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

// ── Auto-upload (post-shrink) ────────────────────────────────────────────────

function deferredUpload() {
  let resolve!: (v: { token: string; previewUrl: string }) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<{ token: string; previewUrl: string }>(
    (res, rej) => {
      resolve = res;
      reject = rej;
    },
  );
  return { promise, resolve, reject };
}

describe('CheckinForm auto-upload after shrink', () => {
  beforeEach(() => {
    convertMock.mockReset();
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      username: 'tester',
      name: 'Tester',
      adminUrl: null,
      loading: false,
      refresh: jest.fn(),
    });
  });

  it('kicks off the upload as soon as conversion resolves, without waiting for submit', async () => {
    const conv = deferredFile();
    convertMock.mockReturnValueOnce(conv.promise);
    const onUploadImage = jest
      .fn()
      .mockResolvedValue({ token: 'tok-1', previewUrl: '/media/x.webp' });

    render(
      <CheckinForm
        mode="create"
        unitUrl="/unit/abc/"
        maptilerKey="TEST_KEY"
        gpsDriftFloorM={0}
        onUploadImage={onUploadImage}
        onSubmit={jest.fn()}
      />,
    );

    addFile(new File(['orig'], 'photo.heic', { type: 'image/heic' }));
    await screen.findByRole('status', { name: /Shrinking image/i });
    expect(onUploadImage).not.toHaveBeenCalled();

    // Resolving the shrink should auto-trigger an upload — no submit click.
    await act(async () => {
      conv.resolve(
        new File(['converted'], 'photo.webp', { type: 'image/webp' }),
      );
    });

    await waitFor(() => expect(onUploadImage).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByLabelText(/Uploaded/i)).toBeInTheDocument(),
    );
  });

  it('disables the submit button while an upload is in flight', async () => {
    const conv = deferredFile();
    convertMock.mockReturnValueOnce(conv.promise);
    const upload = deferredUpload();
    const onUploadImage = jest.fn().mockReturnValue(upload.promise);

    render(
      <CheckinForm
        mode="create"
        unitUrl="/unit/abc/"
        maptilerKey="TEST_KEY"
        gpsDriftFloorM={0}
        onUploadImage={onUploadImage}
        onSubmit={jest.fn()}
      />,
    );

    await pickLocationLondon();
    addFile(new File(['orig'], 'photo.heic', { type: 'image/heic' }));

    await act(async () => {
      conv.resolve(
        new File(['converted'], 'photo.webp', { type: 'image/webp' }),
      );
    });

    // Upload is now in flight (the mock hasn't resolved yet).
    await screen.findByRole('status', { name: /Uploading photo/i });
    expect(screen.getByRole('button', { name: /^Check in$/i })).toBeDisabled();

    await act(async () => {
      upload.resolve({ token: 'tok-1', previewUrl: '/media/x.webp' });
    });

    // Upload settled → button re-enabled.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /^Check in$/i }),
      ).not.toBeDisabled(),
    );
  });

  it('surfaces background upload errors via the per-photo popup and retries on click', async () => {
    const conv = deferredFile();
    convertMock.mockReturnValueOnce(conv.promise);
    const onUploadImage = jest
      .fn()
      // First attempt: network error. Retry: success.
      .mockRejectedValueOnce(new PendingUploadError('network', 'Load failed'))
      .mockResolvedValueOnce({ token: 'tok-1', previewUrl: '/media/x.webp' });

    render(
      <CheckinForm
        mode="create"
        unitUrl="/unit/abc/"
        maptilerKey="TEST_KEY"
        gpsDriftFloorM={0}
        onUploadImage={onUploadImage}
        onSubmit={jest.fn()}
      />,
    );

    addFile(new File(['orig'], 'photo.heic', { type: 'image/heic' }));
    await act(async () => {
      conv.resolve(
        new File(['converted'], 'photo.webp', { type: 'image/webp' }),
      );
    });

    // Initial upload failed → error badge visible, popup hidden.
    const badge = await screen.findByLabelText(/Upload failed/i);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(badge);
    const popup = screen.getByRole('dialog');
    expect(popup).toHaveTextContent(/Couldn't reach the server/i);

    // Retry → onUploadImage called again; on success, checkmark replaces
    // the error badge.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
    });
    await waitFor(() => expect(onUploadImage).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByLabelText(/Uploaded/i)).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText(/Upload failed/i)).not.toBeInTheDocument();
  });
});
