import i18n from '../i18n';

export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(i18n.resolvedLanguage ?? 'en', options).format(
    value,
  );
}

export function formatKm(value: number): string {
  return formatNumber(value, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}
