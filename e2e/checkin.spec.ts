/**
 * Anonymous check-in smoke tests against an isolated Docker stack running
 * `DJANGO_SETTINGS_MODULE=config.settings.e2e` (always-passes Turnstile keys).
 *
 * Two flows, both anonymous (no login), each uploading a 3000×3000 PNG. The
 * frontend's convertToWebP() (flamerelay/static/js/lib/imageConversion.ts)
 * must downscale to MAX_EDGE_PX (2560) and reencode as webp BEFORE the
 * pending-images POST goes out — the backend mirrors the cap server-side
 * (CHECKIN_IMAGE_MAX_EDGE_PX in config/constants.py), so verifying the
 * stored file isn't enough on its own. We capture the outgoing multipart
 * body and parse the WebP header to read the FE-side dimensions.
 *
 * Flow today (see uploadPendingImage.ts):
 *   - Each photo is POSTed to /api/units/<id>/pending-images/ on selection,
 *     gated by a Turnstile token. The server returns an attach token.
 *   - The check-in POST to /api/units/<id>/checkins/ is JSON containing
 *     `pending_image_tokens: [...]` — no image data on that request.
 *
 * Pre-conditions: `just e2e` orchestrates everything. Standalone runs need
 *   - `python manage.py migrate && python manage.py seed_e2e_units`
 *   - `E2E_BASE_URL=http://<host>:<port>` pointing at the e2e webpack server
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';

const LARGE_IMAGE = path.join(__dirname, 'fixtures', 'large-image.png');
const ORIGINAL_EDGE_PX = 3000; // matches the fixture
const MAX_EDGE_PX = 2560; // mirrors imageConversion.ts:7 / CHECKIN_IMAGE_MAX_EDGE_PX
const LONDON = { latitude: 51.5074, longitude: -0.1278, accuracy: 18 };

test.use({
  geolocation: LONDON,
  permissions: ['geolocation'],
});

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * With the always-passes Turnstile test key the widget renders no iframe —
 * it just sets `XXXX.DUMMY.TOKEN.XXXX` directly into the hidden
 * `cf-turnstile-response` input. The pending-image upload requires this
 * token on the first call of an anon session, so we wait for it before
 * adding photos.
 */
async function waitForTurnstileReady(page: import('@playwright/test').Page) {
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
 * Minimal multipart parser focused on the single-file "image" part the
 * pending-images endpoint receives. Returns the part's filename and (if the
 * body is a WebP) the encoded dimensions read straight from the WebP header.
 */
function parseUploadedImage(body: Buffer): {
  filename: string | null;
  dimensions: { width: number; height: number } | null;
} {
  const filenameMatch = body
    .toString('binary', 0, Math.min(body.length, 8192))
    .match(/name="image";\s*filename="([^"]+)"/i);
  const filename = filenameMatch?.[1] ?? null;

  const boundaryEnd = body.indexOf('\r\n');
  if (boundaryEnd < 0) return { filename, dimensions: null };
  const boundary = body.subarray(0, boundaryEnd); // includes leading "--"

  const nameIdx = body.indexOf('name="image"');
  if (nameIdx < 0) return { filename, dimensions: null };
  const dataStart = body.indexOf('\r\n\r\n', nameIdx);
  if (dataStart < 0) return { filename, dimensions: null };
  const fileStart = dataStart + 4;
  const nextBoundary = body.indexOf(boundary, fileStart);
  if (nextBoundary < 0) return { filename, dimensions: null };
  const fileBuf = body.subarray(fileStart, nextBoundary - 2); // strip trailing \r\n

  if (
    fileBuf.length < 30 ||
    fileBuf.toString('ascii', 0, 4) !== 'RIFF' ||
    fileBuf.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return { filename, dimensions: null };
  }
  const fmt = fileBuf.toString('ascii', 12, 16);
  let width = 0;
  let height = 0;
  if (fmt === 'VP8 ') {
    width = fileBuf.readUInt16LE(26) & 0x3fff;
    height = fileBuf.readUInt16LE(28) & 0x3fff;
  } else if (fmt === 'VP8L') {
    const v = fileBuf.readUInt32LE(21);
    width = (v & 0x3fff) + 1;
    height = ((v >> 14) & 0x3fff) + 1;
  } else if (fmt === 'VP8X') {
    width = fileBuf.readUIntLE(24, 3) + 1;
    height = fileBuf.readUIntLE(27, 3) + 1;
  }
  return { filename, dimensions: { width, height } };
}

/**
 * Intercept the pending-image POST with page.route(), capture its multipart
 * body, then pass the request through to the real server. Using route()
 * instead of page.on('request') because the latter doesn't reliably surface
 * the post body for file uploads.
 */
function capturePendingImageUpload(
  page: import('@playwright/test').Page,
  identifier: string,
) {
  return new Promise<ReturnType<typeof parseUploadedImage>>((resolve) => {
    const url = `**/api/units/${identifier}/pending-images/`;
    page.route(url, async (route) => {
      const req = route.request();
      if (req.method() === 'POST') {
        const buf = req.postDataBuffer();
        resolve(
          buf ? parseUploadedImage(buf) : { filename: null, dimensions: null },
        );
      }
      await route.continue();
    });
  });
}

function expectDownscaledWebPUpload(info: {
  filename: string | null;
  dimensions: { width: number; height: number } | null;
}) {
  expect(info.filename, 'frontend should rename the upload to .webp').toMatch(
    /\.webp$/i,
  );
  expect(
    info.dimensions,
    'multipart body should contain a valid WebP',
  ).not.toBeNull();
  const longest = Math.max(info.dimensions!.width, info.dimensions!.height);
  // Cap from imageConversion.ts — the uploaded image must be at or below it.
  expect(longest).toBeLessThanOrEqual(MAX_EDGE_PX);
  // The fixture is larger than the cap, so downscaling MUST have happened
  // (i.e. the FE step actually ran, not just a no-op for already-small files).
  expect(longest).toBeLessThan(ORIGINAL_EDGE_PX);
}

// ─── Specs ────────────────────────────────────────────────────────────────

test('anonymous check-in to a non-game unit (large image downscaled + converted to webp)', async ({
  page,
}) => {
  const uploadPromise = capturePendingImageUpload(page, 'e2enongame-01');
  await page.goto('/unit/e2enongame-01/checkin');

  await page
    .getByRole('button', { name: /Use my location/i })
    .first()
    .click();
  await expect(page.getByText(/Location set/i)).toBeVisible();

  await page.getByLabel(/^Your name/i).fill('E2E Tester');

  // Turnstile token is needed before the pending-image upload — the server
  // rejects the first anonymous upload without one (captcha_required).
  await waitForTurnstileReady(page);

  // setInputFiles triggers the pending-image POST immediately. Wait for the
  // "1/5 photos" indicator so the upload has settled before we submit.
  await page.locator('#images').setInputFiles(LARGE_IMAGE);
  await expect(page.getByText(/1\s*\/\s*5\s+photos/i)).toBeVisible();

  // Submit button waits on `hasPhotosInFlight` — toBeEnabled poll handles it.
  const submit = page.getByRole('button', { name: /^Check in$/i });
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(
    page.getByRole('heading', {
      name: /Want to know where this lighter goes next/i,
    }),
  ).toBeVisible();

  expectDownscaledWebPUpload(await uploadPromise);
});

test('anonymous check-in to a GPS-enforced (DISTANCE game) unit (large image downscaled + converted to webp)', async ({
  page,
}) => {
  const uploadPromise = capturePendingImageUpload(page, 'e2egame-01');
  await page.goto('/unit/e2egame-01/checkin');

  await page.getByRole('button', { name: /Use my location/i }).click();

  await page.getByLabel(/^Place/i).fill('Tower Bridge');
  await page.getByLabel(/^Your name/i).fill('E2E Tester');

  await waitForTurnstileReady(page);

  await page.locator('#images').setInputFiles(LARGE_IMAGE);
  await expect(page.getByText(/1\s*\/\s*5\s+photos/i)).toBeVisible();

  const submit = page.getByRole('button', { name: /^Check in$/i });
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(
    page.getByRole('heading', {
      name: /Want to know where this lighter goes next/i,
    }),
  ).toBeVisible();

  expectDownscaledWebPUpload(await uploadPromise);
});
