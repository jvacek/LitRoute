// Cap on the longest edge of converted images. Matches the native horizontal
// resolution of a Retina 13" MacBook (2560 px) — large enough that a
// full-bleed photo still looks crisp on retina, small enough that a 12MP
// iPhone shot drops to ~25% of its pixel count and well under 1 MB at webp
// 0.85. Multiplied across 5 photos, this keeps the upload comfortably under
// the 20 MB nginx cap.
// Mirrored on the backend (CHECKIN_IMAGE_MAX_EDGE_PX in config/constants.py).
// Keep both values in sync — the backend's ResizedImageField is sized to
// match so a properly-converted upload doesn't get re-resized server-side.
const MAX_EDGE_PX = 2560;

export async function convertToWebP(file: File): Promise<File> {
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
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Conversion failed'));
          return;
        }
        const name = file.name.replace(/\.[^.]+$/, '.webp');
        resolve(new File([blob], name, { type: 'image/webp' }));
      },
      'image/webp',
      0.85,
    );
  });
}
