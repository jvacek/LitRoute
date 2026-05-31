// Cap on the longest edge of downscaled images. Matches the native horizontal
// resolution of a Retina 13" MacBook (2560 px) — large enough that a
// full-bleed photo still looks crisp on retina, small enough that a 12MP
// iPhone shot drops to ~25% of its pixel count and well under 1 MB at JPEG
// 0.85. Multiplied across 5 photos, this keeps the upload comfortably under
// the 20 MB nginx cap.
// Mirrored on the backend (CHECKIN_IMAGE_MAX_EDGE_PX in config/constants.py).
// Keep both values in sync — the backend's ResizedImageField is sized to
// match so a properly-downscaled upload doesn't get re-resized server-side.
const MAX_EDGE_PX = 2560;

// Upper bound on the encoded upload, mirroring the backend's
// CHECKIN_IMAGE_MAX_UPLOAD_BYTES (config/constants.py). A 2560px JPEG never
// realistically approaches this; the guard exists so a pathological image
// surfaces a real client-side error instead of a server 400.
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

// We encode to JPEG, not WebP. The canvas API has no HEIF encoder on any
// browser (incl. Safari), so a downscaled HEIF can't be produced client-side;
// and WebKit's `toBlob('image/webp', q)` is unreliable (silent PNG fallback /
// near-lossless output that blows past the size cap). JPEG's quality arg is
// honoured everywhere, and it doesn't matter for storage: the server always
// re-encodes to WebP via force_format, so the client format is pure transport.
const JPEG_QUALITY = 0.85;
const JPEG_QUALITY_FALLBACK = 0.7;

function encodeJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('Image encoding failed')),
      'image/jpeg',
      quality,
    );
  });
}

/**
 * Decode `file` (HEIF/JPEG/PNG/…), downscale its longest edge to MAX_EDGE_PX,
 * and re-encode as JPEG. Returns a new `File`. The server re-encodes the result
 * to WebP and strips metadata, so this is only a transport-size optimisation.
 *
 * Rejects if decoding fails (e.g. HEIC on a non-WebKit browser) or if the
 * encoded output stays above MAX_OUTPUT_BYTES even after a lower-quality retry;
 * the caller falls back to uploading the original on rejection.
 */
export async function downscaleImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(
    1,
    MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height),
  );
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  let blob = await encodeJpeg(canvas, JPEG_QUALITY);
  if (blob.size > MAX_OUTPUT_BYTES) {
    blob = await encodeJpeg(canvas, JPEG_QUALITY_FALLBACK);
  }
  if (blob.size > MAX_OUTPUT_BYTES) {
    throw new Error('Image too large after downscaling');
  }
  const name = file.name.replace(/\.[^.]+$/, '.jpg');
  return new File([blob], name, { type: 'image/jpeg' });
}
