/**
 * Anonymous check-in smoke tests against an isolated Docker stack running
 * `DJANGO_SETTINGS_MODULE=config.settings.e2e` (always-passes Turnstile keys).
 *
 * Each spec uploads a 3000×3000 PNG to verify the FE's downscaling pipeline.
 * `convertToWebP()` (flamerelay/static/js/lib/imageConversion.ts) must shrink
 * to MAX_EDGE_PX (2560) and reencode as webp BEFORE the pending-images POST
 * goes out — the backend mirrors the cap (CHECKIN_IMAGE_MAX_EDGE_PX in
 * config/constants.py), so verifying only the stored file would still pass
 * if the FE step did nothing. We intercept the multipart body, pull the
 * file out, and read the dimensions with `image-size`.
 *
 * Flow today (see uploadPendingImage.ts):
 *   - Each photo is POSTed to /api/units/<id>/pending-images/ on selection,
 *     gated by a Turnstile token. The server returns an attach token.
 *   - The check-in POST to /api/units/<id>/checkins/ is JSON carrying
 *     `pending_image_tokens: [...]` — no image data on that request.
 *
 * The maptiler-search variant hits the real https://api.maptiler.com — the
 * key flows from `MAPTILER_KEY` (env file) → /api/config/ → root loader →
 * the form's `useConfig()`. CI needs `MAPTILER_KEY` exported into the e2e
 * django env or that test will timeout waiting for dropdown results.
 *
 * Pre-conditions: `just e2e` orchestrates everything. Standalone runs need
 *   - `python manage.py migrate && python manage.py seed_e2e_units`
 *   - `E2E_BASE_URL=http://<host>:<port>` pointing at the e2e webpack server
 */
import { test, expect, type Page } from '@playwright/test';
import { imageSize } from 'image-size';
import path from 'node:path';

const LARGE_IMAGE = path.join(__dirname, 'fixtures', 'large-image.png');
const ORIGINAL_EDGE_PX = 3000; // matches the fixture
const MAX_EDGE_PX = 2560; // mirrors imageConversion.ts:7 / CHECKIN_IMAGE_MAX_EDGE_PX
const LONDON = { latitude: 51.5074, longitude: -0.1278, accuracy: 18 };

test.use({
  geolocation: LONDON,
  permissions: ['geolocation'],
});

// ─── Multipart-body parsing ───────────────────────────────────────────────

interface UploadedImageInfo {
  filename: string | null;
  dimensions: { width: number; height: number } | null;
}

/**
 * Pull the "image" file part out of a multipart body and read its dimensions
 * with image-size. Filename is grabbed via regex from the leading headers;
 * the file bytes are sliced out between the leading boundary and the next
 * boundary occurrence after the part's body-separator (\r\n\r\n).
 */
function parseUploadedImage(body: Buffer): UploadedImageInfo {
  const filename =
    body
      .toString('binary', 0, Math.min(body.length, 8192))
      .match(/name="image";\s*filename="([^"]+)"/i)?.[1] ?? null;

  const boundaryEnd = body.indexOf('\r\n');
  if (boundaryEnd < 0) return { filename, dimensions: null };
  const boundary = body.subarray(0, boundaryEnd);

  const nameIdx = body.indexOf('name="image"');
  if (nameIdx < 0) return { filename, dimensions: null };
  const dataStart = body.indexOf('\r\n\r\n', nameIdx);
  if (dataStart < 0) return { filename, dimensions: null };
  const fileStart = dataStart + 4;
  const nextBoundary = body.indexOf(boundary, fileStart);
  if (nextBoundary < 0) return { filename, dimensions: null };
  const fileBuf = body.subarray(fileStart, nextBoundary - 2);

  try {
    const { width, height } = imageSize(fileBuf);
    return { filename, dimensions: { width, height } };
  } catch {
    return { filename, dimensions: null };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * With the always-passes Turnstile test key the widget renders no iframe —
 * it just sets `XXXX.DUMMY.TOKEN.XXXX` directly into the hidden
 * `cf-turnstile-response` input. The pending-image upload requires this
 * token on the first call of an anon session, so we wait for it before
 * adding photos.
 */
async function waitForTurnstileReady(page: Page) {
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
 * Set up a route() interceptor on the pending-image POST and return a
 * promise that resolves once the upload fires. Route() (not page.on(...))
 * because page.on('request') doesn't reliably surface the post body for
 * file uploads.
 */
function capturePendingImageUpload(page: Page, identifier: string) {
  return new Promise<UploadedImageInfo>((resolve) => {
    page.route(`**/api/units/${identifier}/pending-images/`, async (route) => {
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

function expectDownscaledWebPUpload(info: UploadedImageInfo) {
  expect(info.filename, 'frontend should rename the upload to .webp').toMatch(
    /\.webp$/i,
  );
  expect(
    info.dimensions,
    'multipart body should contain a valid image',
  ).not.toBeNull();
  const longest = Math.max(info.dimensions!.width, info.dimensions!.height);
  // Cap from imageConversion.ts — the uploaded image must be at or below it.
  expect(longest).toBeLessThanOrEqual(MAX_EDGE_PX);
  // The fixture is larger than the cap, so downscaling MUST have happened
  // (i.e. the FE step actually ran, not just a no-op for already-small files).
  expect(longest).toBeLessThan(ORIGINAL_EDGE_PX);
}

/**
 * Open the check-in form for `identifier` and register the upload capture.
 * Returns the upload promise wrapped in an object so the caller can `await`
 * this helper (which waits for `page.goto`) without auto-unwrapping the
 * inner promise — that would only resolve once the user uploads, hanging
 * the test before it ever interacted with the page.
 */
async function openCheckinForm(
  page: Page,
  identifier: string,
): Promise<{ upload: Promise<UploadedImageInfo> }> {
  const upload = capturePendingImageUpload(page, identifier);
  await page.goto(`/unit/${identifier}/checkin`);
  return { upload };
}

/**
 * Shared tail-end of every spec: fill remaining fields, upload the photo,
 * wait for the submit gate to release, click submit, assert success, and
 * verify the captured multipart body was a downscaled webp.
 *
 * Location must already be set on the form by the time this is called —
 * each spec picks its own location strategy first.
 */
async function fillAndSubmit(
  page: Page,
  opts: { name: string; place?: string },
  uploadPromise: Promise<UploadedImageInfo>,
) {
  await page.getByLabel(/^Your name/i).fill(opts.name);
  if (opts.place !== undefined) {
    await page.getByLabel(/^Place/i).fill(opts.place);
  }

  // Turnstile token is needed before the pending-image upload — the server
  // rejects the first anonymous upload without one (captcha_required).
  await waitForTurnstileReady(page);

  // setInputFiles triggers the pending-image POST immediately. Wait for
  // the "1/5 photos" indicator so the upload has settled before submitting.
  await page.locator('#images').setInputFiles(LARGE_IMAGE);
  await expect(page.getByText(/1\s*\/\s*5\s+photos/i)).toBeVisible();

  // The submit button is also gated on `hasPhotosInFlight` — toBeEnabled
  // polls until that releases.
  const submit = page.getByRole('button', { name: /^Check in$/i });
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(
    page.getByRole('heading', {
      name: /Want to know where this lighter goes next/i,
    }),
  ).toBeVisible();

  expectDownscaledWebPUpload(await uploadPromise);
}

// ─── Specs ────────────────────────────────────────────────────────────────

/**
 * Non-game flow varies only in how location is set; the rest of the form
 * is identical. Parametrize so adding a third location strategy is one row.
 */
const nonGameLocationStrategies: ReadonlyArray<
  readonly [label: string, setLocation: (page: Page) => Promise<void>]
> = [
  [
    '"Use my location" (browser geolocation)',
    async (page) => {
      await page
        .getByRole('button', { name: /Use my location/i })
        .first()
        .click();
      await expect(page.getByText(/Location set/i)).toBeVisible();
    },
  ],
  [
    'maptiler search dropdown',
    async (page) => {
      await page.getByPlaceholder(/Search for a place/i).fill('London');
      // The dropdown renders <ul><li><button>…</button></li></ul>; scoping
      // to a button inside a <ul> avoids matching the "Use my location"
      // button that lives outside the list. .first() picks the top maptiler
      // result — exact text varies, so don't pin on a specific match.
      await page.locator('ul button').first().click();
      await expect(page.getByText(/Location set/i)).toBeVisible();
    },
  ],
];

for (const [label, setLocation] of nonGameLocationStrategies) {
  test(`non-game unit: location set via ${label}`, async ({ page }) => {
    const { upload } = await openCheckinForm(page, 'e2enongame-01');
    await setLocation(page);
    await fillAndSubmit(page, { name: 'E2E Tester' }, upload);
  });
}

test('GPS-enforced (DISTANCE game) unit: location captured via real-time GPS', async ({
  page,
}) => {
  const { upload } = await openCheckinForm(page, 'e2egame-01');

  await page.getByRole('button', { name: /Use my location/i }).click();
  // No standalone "Location set" indicator for GPS-enforced — the next
  // gate is the submit button becoming enabled, which fillAndSubmit waits
  // on after we drop a photo in.

  await fillAndSubmit(
    page,
    { name: 'E2E Tester', place: 'Tower Bridge' },
    upload,
  );
});
