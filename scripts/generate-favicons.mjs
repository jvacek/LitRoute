import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const faviconsDir = resolve(root, 'flamerelay/static/images/favicons');
const imagesDir = resolve(root, 'flamerelay/static/images');
const dest = (name) => resolve(faviconsDir, name);

const sizes = [
  { name: 'favicon-32x32.png', size: 32 },
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
];

// litroute.svg is logo-only (viewBox 540×540); blueprint-bg.svg is one pattern
// tile (viewBox 120×120). For local variants we tile the bg under the logo.
const MASTER_SIZE = 540;
const BG_TILE = 120;

const logoSvg = readFileSync(resolve(faviconsDir, 'litroute.svg'));
const blueprintBg = readFileSync(resolve(imagesDir, 'blueprint-bg.svg'));

// ── Derived dark variant of blueprint-bg for the Django admin ──────────────
// Same pattern as blueprint-bg.svg with the background rect's fill swapped to
// navy. The first hex fill in the source is always the bg rect (diamond paths
// use fill:none), so a one-shot replace is safe.
const ADMIN_BG_COLOR = '#0d3b66';
const blueprintBgDark =
  blueprintBg
    .toString()
    .trimEnd()
    .replace(/fill:#[0-9a-fA-F]{3,6}/, `fill:${ADMIN_BG_COLOR}`) + '\n';
writeFileSync(resolve(imagesDir, 'blueprint-bg-dark.svg'), blueprintBgDark);
console.log('generated blueprint-bg-dark.svg');

function innerContent(svg) {
  const open = svg.match(/<svg\b[^>]*>/);
  if (!open) throw new Error('No <svg> open tag found');
  return svg.slice(open.index + open[0].length, svg.lastIndexOf('</svg>'));
}

// ── Prod PNGs: logo flattened on linen ─────────────────────────────────────
for (const { name, size } of sizes) {
  await sharp(logoSvg)
    .resize(size, size)
    .flatten({ background: '#f0ead8' })
    .png()
    .toFile(dest(name));
  console.log(`generated ${name}`);
}

// ── Local PNGs: tile blueprint-bg under the logo ───────────────────────────
const bgTilePng = await sharp(blueprintBg)
  .resize(BG_TILE, BG_TILE)
  .png()
  .toBuffer();
const logoPng = await sharp(logoSvg)
  .resize(MASTER_SIZE, MASTER_SIZE)
  .png()
  .toBuffer();

const masterLocal = await sharp({
  create: {
    width: MASTER_SIZE,
    height: MASTER_SIZE,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite([{ input: bgTilePng, tile: true }, { input: logoPng }])
  .png()
  .toBuffer();

for (const { name, size } of sizes) {
  const outName = 'local-' + name;
  await sharp(masterLocal).resize(size, size).png().toFile(dest(outName));
  console.log(`generated ${outName}`);
}

// ── Local SVG favicon: same composition as a self-contained SVG file ───────
const composedSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MASTER_SIZE} ${MASTER_SIZE}" width="${MASTER_SIZE}" height="${MASTER_SIZE}">
  <defs>
    <pattern id="local-bg-tile" width="${BG_TILE}" height="${BG_TILE}" patternUnits="userSpaceOnUse">${innerContent(blueprintBg.toString())}</pattern>
  </defs>
  <rect width="${MASTER_SIZE}" height="${MASTER_SIZE}" fill="url(#local-bg-tile)"/>
  ${innerContent(logoSvg.toString())}
</svg>
`;
writeFileSync(dest('local-litroute.svg'), composedSvg);
console.log('generated local-litroute.svg');
