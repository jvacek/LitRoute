import { readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const localesDir = resolve(__dirname, '../flamerelay/static/locales');
const sourceDir = resolve(__dirname, '../flamerelay/static/js');

function leafPaths(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return typeof v === 'object' && v !== null ? leafPaths(v, path) : [path];
  });
}

function walkTsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== '__tests__')
      return walkTsFiles(full);
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) return [full];
    return [];
  });
}

const en = JSON.parse(
  readFileSync(join(localesDir, 'en', 'translation.json'), 'utf8'),
);
const allSource = walkTsFiles(sourceDir)
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

const unused = leafPaths(en).filter((key) => {
  // Plural keys (CLDR suffixes) are referenced by their base key in source
  const lookup = key.replace(/_(zero|one|two|few|many|other)$/, '');
  return (
    !allSource.includes(`'${lookup}'`) && !allSource.includes(`"${lookup}"`)
  );
});

if (unused.length === 0) {
  console.log('✓ All keys in en/translation.json are referenced in source.');
} else {
  console.log(`Found ${unused.length} potentially unused key(s):\n`);
  for (const key of unused) console.log(`  ${key}`);
  console.log(
    '\nNote: keys for un-migrated components appear here until their migration is complete.',
  );
}
