export async function convertToWebP(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
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
