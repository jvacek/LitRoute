// Shared Tailwind class strings — single source of truth for buttons, inputs, labels.

const btnBase =
  'rounded-btn tracking-wide transition-transform hover:-translate-y-px active:translate-y-0 disabled:pointer-events-none disabled:opacity-50';

// Primary amber buttons
export const primaryBtnLg = `${btnBase} bg-amber px-[22px] py-[9px] text-sm font-semibold text-white`;
export const primaryBtnMd = `${btnBase} bg-amber px-[18px] py-[7px] text-sm font-semibold text-white`;
export const primaryBtn = `w-full ${primaryBtnMd}`; // full-width variant for auth pages

// Ember (destructive/warning) buttons
export const emberBtnMd = `${btnBase} bg-ember px-[18px] py-[7px] text-sm font-semibold text-white`;

// Outline / secondary buttons
export const outlineBtnLg =
  'rounded-btn border border-char/15 px-[22px] py-[9px] text-sm font-medium text-char transition-colors hover:bg-linen';
export const outlineBtnMd =
  'rounded-btn border border-char/15 px-[18px] py-[7px] text-sm font-medium text-char transition-colors hover:bg-linen';
export const outlineBtnSm =
  'rounded-btn border border-char/15 px-3 py-[5px] text-sm font-medium text-char transition-colors hover:bg-linen';

// Inputs and labels
export const inputClass =
  'w-full rounded-input border border-char/20 bg-white px-3 py-2.5 text-sm text-char placeholder-smoke/60 focus:border-amber focus:outline-none focus:ring-2 focus:ring-amber/20';
export const labelClass = 'mb-1 block text-sm font-medium text-char/70';

// Compact inline action button used in email/social management rows.
export const secondaryBtn =
  'rounded-btn px-2.5 py-1 text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-40';

// Inline form-field error: tinted red box with red text. Bigger and harder
// to miss than plain red text alone.
export const fieldErrorClass =
  'mt-1.5 rounded-card border border-ember/40 bg-ember/10 px-3 py-2 text-sm text-ember';
