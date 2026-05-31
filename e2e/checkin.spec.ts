/**
 * Anonymous check-in smoke tests (Chromium) against an isolated Docker stack
 * running `DJANGO_SETTINGS_MODULE=config.settings.e2e` (always-passes Turnstile
 * keys).
 *
 * Each spec uploads a 3000×3000 PNG to verify the FE downscaling pipeline:
 * `downscaleImage()` (flamerelay/static/js/lib/imageConversion.ts) must shrink
 * to MAX_EDGE_PX (2560) and re-encode as JPEG BEFORE the pending-images POST
 * goes out. We intercept the multipart body and sniff it — verifying only the
 * stored file would still pass if the FE step did nothing, since the backend
 * mirrors the cap and re-encodes to WebP anyway.
 *
 * WebKit-specific coverage (HEIF + the Safari encode path) lives in
 * `checkin.webkit.spec.ts`; shared logic is in `helpers.ts`.
 *
 * The maptiler-search variant hits the real https://api.maptiler.com — the key
 * flows from `MAPTILER_KEY` (env file) → /api/config/ → root loader → the
 * form's `useConfig()`. CI needs `MAPTILER_KEY` in the e2e django env.
 *
 * Pre-conditions: `just e2e` orchestrates everything. Standalone runs need
 *   - `python manage.py migrate && python manage.py seed_e2e_units`
 *   - `E2E_BASE_URL=http://<host>:<port>` pointing at the e2e webpack server
 */
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

import {
  LONDON,
  expectDownscaledJpegUpload,
  openCheckinForm,
  uploadPhotoAndSubmit,
} from './helpers';

const LARGE_IMAGE = path.join(__dirname, 'fixtures', 'large-image.png');
const ORIGINAL_EDGE_PX = 3000; // matches the fixture

test.use({
  geolocation: LONDON,
  permissions: ['geolocation'],
});

/**
 * Non-game flow varies only in how location is set; the rest of the form is
 * identical. Parametrize so adding a third location strategy is one row.
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
      // The dropdown renders <ul><li><button>…</button></li></ul>; scoping to a
      // button inside a <ul> avoids matching the "Use my location" button
      // outside the list. .first() picks the top maptiler result.
      await page.locator('ul button').first().click();
      await expect(page.getByText(/Location set/i)).toBeVisible();
    },
  ],
];

for (const [label, setLocation] of nonGameLocationStrategies) {
  test(`non-game unit: location set via ${label}`, async ({ page }) => {
    const { upload } = await openCheckinForm(page, 'e2enongame-01');
    await setLocation(page);
    await uploadPhotoAndSubmit(page, {
      name: 'E2E Tester',
      imagePath: LARGE_IMAGE,
    });
    expectDownscaledJpegUpload(await upload, ORIGINAL_EDGE_PX);
  });
}

test('GPS-enforced (DISTANCE game) unit: location captured via real-time GPS', async ({
  page,
}) => {
  const { upload } = await openCheckinForm(page, 'e2egame-01');

  await page.getByRole('button', { name: /Use my location/i }).click();
  // No standalone "Location set" indicator for GPS-enforced — the next gate is
  // the submit button becoming enabled after a photo is dropped in.

  await uploadPhotoAndSubmit(page, {
    name: 'E2E Tester',
    place: 'Tower Bridge',
    imagePath: LARGE_IMAGE,
  });
  expectDownscaledJpegUpload(await upload, ORIGINAL_EDGE_PX);
});
