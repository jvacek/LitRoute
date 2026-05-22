// Build-time loader for CHANGELOG.md.
//
// Splits the file at `## YYYY-MM-DD` H2 boundaries and emits one HTML blob
// per entry. The result is an ESM module the bundle imports — no markdown
// parser ships to the browser.
//
//   import { entries } from '../../../../CHANGELOG.md';
//   // entries: Array<{ date: string, html: string }>

const { marked } = require('marked');

marked.use({
  gfm: true,
  breaks: false,
  // The H2 heading is stripped before parsing each entry's body, so the body
  // markdown never contains an `<h1>` — we don't need to remap heading levels.
});

module.exports = function changelogLoader(source) {
  const re = /^##\s+(.+?)\s*$/gm;
  const matches = [...source.matchAll(re)];
  const entries = matches.map((m, i) => {
    const next = matches[i + 1];
    const bodyStart = m.index + m[0].length;
    const bodyEnd = next ? next.index : source.length;
    const body = source.slice(bodyStart, bodyEnd).trim();
    return { date: m[1].trim(), html: marked.parse(body) };
  });
  return `export const entries = ${JSON.stringify(entries)};\nexport default entries;\n`;
};
