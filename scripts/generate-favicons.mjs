import sharp from 'sharp';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const src = resolve(root, 'flamerelay/static/images/favicons/litroute.svg');
const dest = (name) => resolve(root, 'flamerelay/static/images/favicons', name);
const svg = readFileSync(src);

const sizes = [
  { name: 'favicon-32x32.png', size: 32 },
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
];

const variants = [
  { prefix: '', bg: '#f0ead8' }, // prod (linen)
  { prefix: 'local-', bg: '#faf6ee' }, // local (parchment)
];

for (const { prefix, bg } of variants) {
  for (const { name, size } of sizes) {
    const outName = prefix + name;
    await sharp(svg)
      .resize(size, size)
      .flatten({ background: bg })
      .png()
      .toFile(dest(outName));
    console.log(`generated ${outName} (${size}x${size}, bg ${bg})`);
  }
}
