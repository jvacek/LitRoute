import type { TFunction } from 'i18next';

export function humanizeHours(t: TFunction, totalHours: number): string {
  const h = Math.max(0, Math.round(totalHours));
  const days = Math.floor(h / 24);
  const hours = h % 24;
  const parts: string[] = [];
  if (days > 0) parts.push(t('common.duration.day', { count: days }));
  if (hours > 0 || days === 0) {
    parts.push(t('common.duration.hour', { count: hours }));
  }
  if (parts.length === 1) return parts[0];
  return parts.join(' ' + t('common.duration.and') + ' ');
}
