// Brand palette consumed from TypeScript. MUST mirror the @theme tokens in
// flamerelay/static/css/project.css — if a token changes there, update here.
//
// Use these in places that need a literal hex string: MapLibre `paint` props
// (which can't take Tailwind class names), inline `style={{ background: ... }}`,
// SVG fills, and canvas/RAF color values. For HTML class strings, prefer the
// Tailwind named tokens (text-amber, bg-char, border-ember/30, etc.).
export const brandColors = {
  amber: '#e8a030',
  char: '#1c1a15',
  ember: '#c94c35',
  smoke: '#7b8fa1',
  parchment: '#faf6ee',
  linen: '#f0ead8',
  blueprint: '#c1dffb',
  moss: '#3a7d44',
  white: '#ffffff',
} as const;
