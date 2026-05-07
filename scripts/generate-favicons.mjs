import sharp from 'sharp';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const dest = (name) => resolve(root, 'flamerelay/static/images/favicons', name);
const src = (name) => resolve(root, 'flamerelay/static/images/favicons', name);

const sizes = [
  { name: 'favicon-32x32.png', size: 32 },
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
];

const variants = [
  { prefix: '', svg: 'litroute.svg', bg: '#f0ead8' }, // prod (linen)
  { prefix: 'local-', svg: 'local-litroute.svg', bg: '#c94c35' }, // local (red bg)
];

for (const { prefix, svg, bg } of variants) {
  const buf = readFileSync(src(svg));
  for (const { name, size } of sizes) {
    const outName = prefix + name;
    await sharp(buf)
      .resize(size, size)
      .flatten({ background: bg })
      .png()
      .toFile(dest(outName));
    console.log(`generated ${outName} (${size}x${size}, src ${svg})`);
  }
}
