/**
 * Shared helpers for the check-in upload specs (Chromium and WebKit).
 *
 * The upload pipeline (flamerelay/static/js/lib/imageConversion.ts →
 * uploadPendingImage.ts):
 *   - On photo selection, `downscaleImage()` decodes, shrinks to MAX_EDGE_PX
 *     (2560) and re-encodes as **JPEG**, then POSTs the file to
 *     /api/units/<id>/pending-images/. (JPEG, not WebP: WebKit's
 *     `toBlob('image/webp')` is unreliable; the backend re-encodes to WebP via
 *     force_format regardless.) If decoding fails, the untouched original is
 *     uploaded and the backend handles it (HEIF via pillow-heif).
 *   - The check-in POST to /checkins/ is JSON carrying `pending_image_tokens`.
 *
 * We intercept the multipart body and sniff the uploaded file with `image-size`
 * so a spec can assert the FE step actually ran (right format + downscaled) —
 * verifying only the stored file would pass even if the FE did nothing, since
 * the backend mirrors the cap.
 */
import { expect, type Page } from '@playwright/test';
import { imageSize } from 'image-size';

export const MAX_EDGE_PX = 2560; // mirrors imageConversion.ts / CHECKIN_IMAGE_MAX_EDGE_PX
export const LONDON = { latitude: 51.5074, longitude: -0.1278, accuracy: 18 };

export interface UploadedImageInfo {
  filename: string | null;
  /** Container sniffed from the actual bytes (e.g. 'jpg', 'png', 'webp') —
   * independent of the filename, so a WebP-as-PNG fallback is detectable. */
  type: string | null;
  dimensions: { width: number; height: number } | null;
}

/**
 * Pull the "image" file part out of a multipart body and read its format +
 * dimensions with image-size. File bytes are sliced between the leading
 * boundary and the next boundary after the part's body separator (\r\n\r\n).
 */
export function parseUploadedImage(body: Buffer): UploadedImageInfo {
  const filename =
    body
      .toString('binary', 0, Math.min(body.length, 8192))
      .match(/name="image";\s*filename="([^"]+)"/i)?.[1] ?? null;

  const boundaryEnd = body.indexOf('\r\n');
  if (boundaryEnd < 0) return { filename, type: null, dimensions: null };
  const boundary = body.subarray(0, boundaryEnd);

  const nameIdx = body.indexOf('name="image"');
  if (nameIdx < 0) return { filename, type: null, dimensions: null };
  const dataStart = body.indexOf('\r\n\r\n', nameIdx);
  if (dataStart < 0) return { filename, type: null, dimensions: null };
  const fileStart = dataStart + 4;
  const nextBoundary = body.indexOf(boundary, fileStart);
  if (nextBoundary < 0) return { filename, type: null, dimensions: null };
  const fileBuf = body.subarray(fileStart, nextBoundary - 2);

  try {
    const { width, height, type } = imageSize(fileBuf);
    return { filename, type: type ?? null, dimensions: { width, height } };
  } catch {
    return { filename, type: null, dimensions: null };
  }
}

/**
 * With the always-passes Turnstile test key the widget renders no iframe — it
 * sets `XXXX.DUMMY.TOKEN.XXXX` directly into the hidden `cf-turnstile-response`
 * input. The first anon pending-image upload needs this, so wait for it.
 */
export async function waitForTurnstileReady(page: Page) {
  await expect
    .poll(
      async () =>
        await page
          .locator('input[name="cf-turnstile-response"]')
          .first()
          .inputValue()
          .catch(() => ''),
      { timeout: 10_000 },
    )
    .not.toBe('');
}

/**
 * Set up a route() interceptor on the pending-image POST and return a promise
 * that resolves once the upload fires. route() (not page.on) because
 * page.on('request') doesn't reliably surface the post body for file uploads.
 */
export function capturePendingImageUpload(page: Page, identifier: string) {
  return new Promise<UploadedImageInfo>((resolve) => {
    page.route(`**/api/units/${identifier}/pending-images/`, async (route) => {
      const req = route.request();
      if (req.method() === 'POST') {
        const buf = req.postDataBuffer();
        resolve(
          buf
            ? parseUploadedImage(buf)
            : { filename: null, type: null, dimensions: null },
        );
      }
      await route.continue();
    });
  });
}

/**
 * Open the check-in form and register the upload capture. Returns the upload
 * promise wrapped in an object so callers can `await` this helper (which waits
 * for goto) without auto-unwrapping the inner promise — that only resolves once
 * a photo is uploaded, which would hang the test before it interacts.
 */
export async function openCheckinForm(
  page: Page,
  identifier: string,
): Promise<{ upload: Promise<UploadedImageInfo> }> {
  const upload = capturePendingImageUpload(page, identifier);
  await page.goto(`/unit/${identifier}/checkin`);
  return { upload };
}

/**
 * Fill the remaining fields, upload `imagePath`, wait for the submit gate to
 * release, submit, and assert the success screen. Location must already be set.
 */
export async function uploadPhotoAndSubmit(
  page: Page,
  opts: { name: string; place?: string; imagePath: string },
) {
  await page.getByLabel(/^Your name/i).fill(opts.name);
  if (opts.place !== undefined) {
    await page.getByLabel(/^Place/i).fill(opts.place);
  }

  await waitForTurnstileReady(page);

  // setInputFiles triggers the pending-image POST. Wait for the "1/5 photos"
  // indicator so the upload has settled before submitting.
  await page.locator('#images').setInputFiles(opts.imagePath);
  await expect(page.getByText(/1\s*\/\s*5\s+photos/i)).toBeVisible();

  // Submit is gated on `hasPhotosInFlight` — toBeEnabled polls until it clears.
  const submit = page.getByRole('button', { name: /^Check in$/i });
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(
    page.getByRole('heading', {
      name: /Want to know where this lighter goes next/i,
    }),
  ).toBeVisible();
}

/** Assert the captured upload is a downscaled JPEG (the FE step actually ran). */
export function expectDownscaledJpegUpload(
  info: UploadedImageInfo,
  originalEdgePx: number,
) {
  expect(info.filename, 'FE should rename the upload to .jpg').toMatch(
    /\.jpe?g$/i,
  );
  expect(info.type, 'uploaded bytes must actually be JPEG, not a PNG fallback')
    // image-size reports JPEG as 'jpg'
    .toBe('jpg');
  expect(
    info.dimensions,
    'multipart body should contain a valid image',
  ).not.toBeNull();
  const longest = Math.max(info.dimensions!.width, info.dimensions!.height);
  expect(longest).toBeLessThanOrEqual(MAX_EDGE_PX);
  // Fixture is larger than the cap, so downscaling MUST have happened.
  expect(longest).toBeLessThan(originalEdgePx);
}
