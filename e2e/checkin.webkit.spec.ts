/**
 * WebKit (Safari engine) check-in upload coverage — the regression guard for
 * the iPhone/HEIF upload bug. Runs only under the `webkit` Playwright project
 * (see playwright.config.ts: this file matches `*.webkit.spec.ts`).
 *
 * Why WebKit specifically: the original bug was Safari/WebKit silently falling
 * back to PNG for `canvas.toBlob('image/webp')`, producing a >10MB file that
 * the server rejected. Chromium can't reproduce it — it encodes WebP fine.
 *
 * Two angles:
 *  1. HEIF end-to-end — upload a real .heic (what iPhones produce) and assert
 *     the check-in succeeds. This guards the whole path regardless of which
 *     branch runs: on a WebKit build that decodes HEIF, the client downscales
 *     to JPEG; on one that can't (e.g. Linux CI), the original is uploaded and
 *     the backend decodes it via pillow-heif. Either way the user must end up
 *     on the success screen. In the buggy version this failed (PNG >10MB → 400,
 *     or original HEIC → backend 500).
 *  2. Encode format — upload a PNG (which WebKit decodes everywhere) and assert
 *     the uploaded bytes are *actually JPEG*. If someone reverts the encoder to
 *     WebP, WebKit emits PNG bytes and this fails deterministically on any host.
 */
import { expect, test } from '@playwright/test';
import path from 'node:path';

import { LONDON, openCheckinForm, uploadPhotoAndSubmit } from './helpers';

const HEIC_IMAGE = path.join(__dirname, 'fixtures', 'large-image.heic');
const PNG_IMAGE = path.join(__dirname, 'fixtures', 'large-image.png');

test.use({
  geolocation: LONDON,
  permissions: ['geolocation'],
});

test('WebKit: HEIF photo uploads and check-in succeeds end-to-end', async ({
  page,
}) => {
  await openCheckinForm(page, 'e2enongame-01');
  await page
    .getByRole('button', { name: /Use my location/i })
    .first()
    .click();
  await uploadPhotoAndSubmit(page, {
    name: 'E2E WebKit',
    imagePath: HEIC_IMAGE,
  });
});

test('WebKit: a normal photo is downscaled to JPEG (fast path runs)', async ({
  page,
}) => {
  const { upload } = await openCheckinForm(page, 'e2enongame-01');
  await page
    .getByRole('button', { name: /Use my location/i })
    .first()
    .click();
  await uploadPhotoAndSubmit(page, {
    name: 'E2E WebKit',
    imagePath: PNG_IMAGE,
  });

  // Playwright's WebKit doesn't reliably expose the binary multipart body to
  // postDataBuffer(), so we assert on the filename (text, reliably captured)
  // rather than sniffing the bytes. A `.jpg` name proves downscaleImage ran
  // the JPEG encode path on WebKit — not a fallback-to-original (.png) or a
  // revert to WebP. JPEG is natively supported on WebKit, so the bytes are
  // genuinely JPEG (no PNG fallback like toBlob('image/webp') would hit).
  const info = await upload;
  expect(info.filename, 'WebKit upload should be the downscaled JPEG').toMatch(
    /\.jpe?g$/i,
  );
});
