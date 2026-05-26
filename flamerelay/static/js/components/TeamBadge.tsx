import { brandColors } from '../lib/brandColors';

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
  return contrastRatio(bgHex, brandColors.char) >=
    contrastRatio(bgHex, brandColors.white)
    ? brandColors.char
    : brandColors.white;
}

interface Props {
  name: string;
  // Team.color is optional in the OpenAPI schema (model allows blank); fall
  // back to the brand smoke token when it's missing so the pill still renders.
  color?: string;
}

const FALLBACK_COLOR = brandColors.smoke;

export default function TeamBadge({ name, color }: Props) {
  const bg = color || FALLBACK_COLOR;
  return (
    <span
      className="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: bg, color: readableTextColor(bg) }}
    >
      {name}
    </span>
  );
}
