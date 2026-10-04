/**
 * Unit map smoke test: MapLibre must draw the style background, the route
 * line and the check-in markers.
 *
 * Regression guard: MapLibre v6 resolves its worker relative to
 * `import.meta.url`, which webpack bakes to a build-machine `file://` path —
 * the runtime fallback is an empty URL that resolves to the page URL and gets
 * blocked by the CSP's `worker-src`. Workers parse vector tiles AND GeoJSON,
 * so a blocked worker means a blank map with no route (JAVASCRIPT-REACT-X et
 * al.). Fixed by emitting maplibre-gl-worker.mjs from webpack + pointing
 * MapLibre at it (lib/maplibreWorker.ts) + `worker-src 'self'`.
 *
 * The MapTiler style is stubbed so the spec runs without the API key or
 * external network: the solid background proves the map pipeline renders, and
 * the route/marker colors prove the GeoJSON overlay was parsed in a worker and
 * painted on top. `e2emap-01` is seeded with three open-ocean check-ins so the
 * amber/ember marker pixels can't be confused with map-style features.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import sharp from 'sharp';

const STUB_STYLE = {
  version: 8,
  name: 'e2e-stub',
  sources: {},
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#1d3b5c' },
    },
  ],
};

// Expected on-canvas colors, blended over the background where the source uses
// opacity: background (opaque), route line smoke @0.7, marker amber @0.85,
// marker ember @0.85. Tolerance absorbs antialiasing and GPU color rounding.
const TARGETS = {
  background: { rgb: [29, 59, 92], tolerance: 20 },
  smoke: { rgb: [95, 118, 140], tolerance: 25 },
  amber: { rgb: [202, 145, 55], tolerance: 35 },
  ember: { rgb: [175, 74, 59], tolerance: 35 },
} as const;

type ColorName = keyof typeof TARGETS;

function matches(
  r: number,
  g: number,
  b: number,
  target: { rgb: readonly [number, number, number]; tolerance: number },
): boolean {
  const [tr, tg, tb] = target.rgb;
  return (
    Math.abs(r - tr) <= target.tolerance &&
    Math.abs(g - tg) <= target.tolerance &&
    Math.abs(b - tb) <= target.tolerance
  );
}

/** Count pixels per target color in a PNG screenshot. */
async function countPixels(png: Buffer): Promise<Record<ColorName, number>> {
  const { data, info } = await sharp(png)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const counts: Record<ColorName, number> = {
    background: 0,
    smoke: 0,
    amber: 0,
    ember: 0,
  };
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    for (const name of Object.keys(TARGETS) as ColorName[]) {
      if (matches(r, g, b, TARGETS[name])) counts[name]++;
    }
  }
  return counts;
}

/**
 * Screenshot the map canvas WITHOUT scrolling: locator.screenshot() scrolls
 * the element into view, which fires the Unit page's scroll handler and pans
 * the map away from its initial fit. The tall viewport keeps the map fully
 * visible, so a clipped page screenshot captures it in place.
 */
async function snapMap(page: Page, canvas: Locator): Promise<Buffer> {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('map canvas has no bounding box');
  return page.screenshot({ clip: box });
}

// Tall enough that the map sits fully above the fold (no scroll needed).
test.use({ viewport: { width: 1280, height: 1100 } });

test('unit map renders the background, route line and markers', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.route('https://api.maptiler.com/maps/**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(STUB_STYLE),
    }),
  );

  await page.goto('/unit/e2emap-01/');

  const canvas = page.locator('.maplibregl-canvas');
  await expect(canvas).toBeVisible();

  // Markers fade in one-by-one (visibleCount); wait until the first (amber)
  // and last (ember) check-ins have both been drawn.
  await expect
    .poll(
      async () => {
        const counts = await countPixels(await snapMap(page, canvas));
        return counts.amber > 30 && counts.ember > 30;
      },
      { message: 'route markers should render on the map', timeout: 15_000 },
    )
    .toBe(true);

  const counts = await countPixels(await snapMap(page, canvas));
  expect(
    counts.background,
    'style background should cover the canvas',
  ).toBeGreaterThan(5000);
  expect(
    counts.smoke,
    'route line should be drawn between the markers',
  ).toBeGreaterThan(100);
  expect(counts.amber, 'first-check-in marker should be drawn').toBeGreaterThan(
    30,
  );
  expect(counts.ember, 'last-check-in marker should be drawn').toBeGreaterThan(
    30,
  );

  expect(
    consoleErrors.filter((m) => /worker|content security policy/i.test(m)),
    'no CSP/worker errors',
  ).toEqual([]);
  expect(pageErrors, 'no uncaught page errors').toEqual([]);
});
