// Brand tokens — must mirror @theme in project.css.
const CHAR = '#1c1a15';
const WHITE = '#ffffff';

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const v = hex.replace('#', '');
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return (
    0.2126 * srgbToLinear(r) +
    0.7152 * srgbToLinear(g) +
    0.0722 * srgbToLinear(b)
  );
}

function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function readableTextColor(bgHex: string): string {
  return contrastRatio(bgHex, CHAR) >= contrastRatio(bgHex, WHITE)
    ? CHAR
    : WHITE;
}

interface Props {
  name: string;
  color: string;
}

export default function TeamBadge({ name, color }: Props) {
  return (
    <span
      className="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: color, color: readableTextColor(color) }}
    >
      {name}
    </span>
  );
}
