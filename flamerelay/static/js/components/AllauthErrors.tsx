import type { AllauthError } from '../lib/allauthApi';

export function FieldErrors({
  param,
  errors,
}: {
  param: string;
  errors: AllauthError[];
}) {
  const msgs = errors.filter((e) => e.param === param);
  if (!msgs.length) return null;
  return (
    <ul className="mt-1 space-y-0.5">
      {msgs.map((e, i) => (
        <li key={i} className="text-xs text-ember">
          {e.message}
        </li>
      ))}
    </ul>
  );
}

export function NonFieldErrors({ errors }: { errors: AllauthError[] }) {
  const msgs = errors.filter((e) => !e.param);
  if (!msgs.length) return null;
  return (
    <ul className="mb-4 space-y-1 rounded-card border border-ember/30 bg-ember/10 px-4 py-3">
      {msgs.map((e, i) => (
        <li key={i} className="text-sm text-ember">
          {e.message}
        </li>
      ))}
    </ul>
  );
}
