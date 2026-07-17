/**
 * Forensic logging for photos we couldn't prepare for upload (the
 * `imageUnsupported` path in `CheckinForm`): the client couldn't downscale
 * them AND the original is over the upload cap, so they never reach the
 * server. Without this we'd be blind to *which* formats/devices fail — this
 * sends just enough detail to Sentry to decide what to support next.
 *
 * Best-effort: every step is guarded so diagnostics can never break the form.
 */
import { reportError } from './sentry';

// EXIF tags we read. NON-PII ONLY — we deliberately never touch GPS*. This app
// strips location metadata on purpose; it must not leak into Sentry. `exifr`
// only reads blocks needed for the picked tags, so GPS is never even parsed.
const EXIF_PICK = [
  'Make',
  'Model',
  'LensModel',
  'Software',
  'ExifImageWidth',
  'ExifImageHeight',
];

/** Recognise the container from magic bytes — more reliable than the (often
 * empty or wrong) File.type, and surfaces the HEIF brand / RAW formats that
 * the browser can't decode. */
async function sniffContainer(file: File): Promise<string> {
  try {
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const ascii = (start: number, end: number) =>
      String.fromCharCode(...head.subarray(start, end));
    if (head[0] === 0x89 && ascii(1, 4) === 'PNG') return 'png';
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
    if (ascii(4, 8) === 'ftyp') return `heif:${ascii(8, 12).trim()}`; // brand, e.g. heic/heix/mif1
    if (head[0] === 0x49 && head[1] === 0x49 && head[2] === 0x2a)
      return 'tiff/dng-le';
    if (head[0] === 0x4d && head[1] === 0x4d && head[3] === 0x2a)
      return 'tiff/dng-be';
    return `unknown:${Array.from(head.subarray(0, 4)).join(',')}`;
  } catch {
    return 'unreadable';
  }
}

export async function reportUnsupportedImage(
  file: File,
  cause: unknown,
): Promise<void> {
  const context: Record<string, unknown> = {
    where: 'CheckinForm.unsupportedImage',
    reason: cause instanceof Error ? cause.message : String(cause),
    fileName: file.name,
    fileType: file.type || '(empty)',
    fileSizeBytes: file.size,
    // Sentry's browser integration already tags browser/OS; keep the raw UA too
    // so we can distinguish in-app WebViews that share a browser name.
    userAgent: navigator.userAgent,
    container: await sniffContainer(file),
  };

  try {
    // Lazy: keep exifr and its parsers out of the main bundle — this only runs
    // on the rare unsupported-photo path. exifr reads metadata directly from
    // the bytes, so it works even for files the browser can't decode (HEIC,
    // DNG). Picking non-PII tags only; GPS is never read.
    const { parse } = await import('exifr');
    const meta = (await parse(file, { pick: EXIF_PICK })) as
      Record<string, unknown> | undefined;
    if (meta) {
      context.make = meta.Make;
      context.model = meta.Model;
      context.lens = meta.LensModel;
      context.software = meta.Software;
      context.exifWidth = meta.ExifImageWidth;
      context.exifHeight = meta.ExifImageHeight;
    }
  } catch {
    context.exifParse = 'failed';
  }

  // Stable message so all unsupported-image events group into one Sentry issue;
  // the real cause + format/device live in the attached context.
  reportError(new Error('Unsupported image upload'), context);
}
