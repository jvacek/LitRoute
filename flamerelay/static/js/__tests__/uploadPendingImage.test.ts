/**
 * Direct tests for `uploadPendingImage`. The integration tests in
 * `CheckinForm.shrinking.test.tsx` only exercise success + one error code;
 * here we cover every branch of the response → typed-error mapping so a
 * server-side change can't silently break the UI's targeted-message logic.
 */
import {
  PendingUploadError,
  uploadPendingImage,
} from '../lib/uploadPendingImage';

jest.mock('../api', () => ({ apiFetch: jest.fn() }));

import { apiFetch } from '../api';

const mockApiFetch = jest.mocked(apiFetch);

// jsdom doesn't ship Response. uploadPendingImage only reads `.status` and
// calls `.json()`, so a duck-typed stand-in is sufficient.
function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function emptyResponse(status: number): Response {
  return {
    status,
    json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')),
  } as unknown as Response;
}

const FILE = new File(['bytes'], 'p.png', { type: 'image/png' });

describe('uploadPendingImage', () => {
  beforeEach(() => mockApiFetch.mockReset());

  it('returns { token, previewUrl } on 201', async () => {
    mockApiFetch.mockResolvedValueOnce(
      jsonResponse(201, { token: 'tok-1', preview_url: '/media/p.webp' }),
    );
    const res = await uploadPendingImage('abc', FILE);
    expect(res).toEqual({ token: 'tok-1', previewUrl: '/media/p.webp' });
  });

  it('sends the file under the "image" field and skips turnstile_token when omitted', async () => {
    mockApiFetch.mockResolvedValueOnce(
      jsonResponse(201, { token: 't', preview_url: '/p' }),
    );
    await uploadPendingImage('abc', FILE);
    const [url, options] = mockApiFetch.mock.calls[0];
    expect(url).toBe('/api/units/abc/pending-images/');
    expect(options?.method).toBe('POST');
    const body = options?.body as FormData;
    expect((body.get('image') as File).name).toBe('p.png');
    expect(body.get('turnstile_token')).toBeNull();
  });

  it('forwards turnstile_token when provided', async () => {
    mockApiFetch.mockResolvedValueOnce(
      jsonResponse(201, { token: 't', preview_url: '/p' }),
    );
    await uploadPendingImage('abc', FILE, { turnstileToken: 'ts-1' });
    const body = mockApiFetch.mock.calls[0][1]?.body as FormData;
    expect(body.get('turnstile_token')).toBe('ts-1');
  });

  it('maps 413 to a too_large error', async () => {
    mockApiFetch.mockResolvedValueOnce(emptyResponse(413));
    await expect(uploadPendingImage('abc', FILE)).rejects.toMatchObject({
      name: 'PendingUploadError',
      code: 'too_large',
    });
  });

  it('maps 403 to a forbidden error', async () => {
    mockApiFetch.mockResolvedValueOnce(
      jsonResponse(403, { detail: 'Not allowed.' }),
    );
    await expect(uploadPendingImage('abc', FILE)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('maps 400 with a captcha field to captcha_required', async () => {
    mockApiFetch.mockResolvedValueOnce(
      jsonResponse(400, { captcha: ['Captcha verification failed.'] }),
    );
    await expect(uploadPendingImage('abc', FILE)).rejects.toMatchObject({
      code: 'captcha_required',
    });
  });

  it('maps 400 + "too large" image error to too_large', async () => {
    mockApiFetch.mockResolvedValueOnce(
      jsonResponse(400, {
        image: ['Image file too large. Maximum size is 10 MB.'],
      }),
    );
    await expect(uploadPendingImage('abc', FILE)).rejects.toMatchObject({
      code: 'too_large',
    });
  });

  it('maps 400 + other image error to rate_limited (per-session cap)', async () => {
    mockApiFetch.mockResolvedValueOnce(
      jsonResponse(400, {
        image: [
          'You have 20 photos waiting to be attached to a check-in. Finish that check-in or wait for the cleanup sweep before uploading more.',
        ],
      }),
    );
    await expect(uploadPendingImage('abc', FILE)).rejects.toMatchObject({
      code: 'rate_limited',
    });
  });

  it('falls back to "server" for unrecognized error shapes', async () => {
    mockApiFetch.mockResolvedValueOnce(emptyResponse(500));
    await expect(uploadPendingImage('abc', FILE)).rejects.toMatchObject({
      code: 'server',
    });
  });

  it('raises a network error when the fetch promise rejects', async () => {
    mockApiFetch.mockRejectedValueOnce(new TypeError('Load failed'));
    await expect(uploadPendingImage('abc', FILE)).rejects.toMatchObject({
      code: 'network',
    });
  });

  it('wraps every rejection in PendingUploadError', async () => {
    // Belt-and-suspenders — callers `instanceof`-check this, so any path
    // that throws a raw Error or a generic object would break their
    // typed-error handling.
    mockApiFetch.mockResolvedValueOnce(emptyResponse(502));
    try {
      await uploadPendingImage('abc', FILE);
      throw new Error('should have rejected');
    } catch (err) {
      expect(err).toBeInstanceOf(PendingUploadError);
    }
  });
});
