/**
 * Heuristic for "this file was just taken with the in-page camera" vs "picked
 * from the existing photo library".
 *
 * `performance.timeOrigin` is the wall-clock time (ms since the Unix epoch —
 * the same scale as `Date.now()` and `File.lastModified`) at which this page
 * started loading. A photo whose `lastModified` is at or after that instant
 * must have been created *after* the page was already open, which on the
 * check-in form only happens when the user shoots a new photo through the
 * `<input type="file" accept="image/*">` camera. Files picked from the existing
 * library always predate the page load, so they fall on the other side.
 *
 * The web platform exposes no direct "camera vs library" signal, so this is a
 * heuristic — but a freshly captured photo is also the one at risk of being
 * lost, because on iOS a capture made through a web input is never written to
 * the camera roll. That's exactly the case we want to offer to save.
 */
export function isFreshCapture(file: File): boolean {
  return file.lastModified >= performance.timeOrigin;
}
