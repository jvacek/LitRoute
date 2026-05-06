import { useTranslation } from 'react-i18next';
import { useAuth } from '../AuthContext';
import { apiFetch } from '../api';
import { LANGUAGES } from '../i18n';

export default function LanguagePicker() {
  const { i18n, t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const current = i18n.language ?? 'en';

  async function handleChange(code: string) {
    void i18n.changeLanguage(code);
    if (isAuthenticated) {
      await apiFetch('/api/account/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: code }),
      });
    }
  }

  return (
    <div className="relative inline-flex items-center">
      <select
        value={current}
        onChange={(e) => void handleChange(e.target.value)}
        aria-label={t('nav.languageLabel')}
        className="cursor-pointer appearance-none rounded border border-char/15 bg-transparent py-1 pl-2 pr-6 text-sm font-medium text-char/60 transition-colors hover:border-char/30 hover:text-char focus:outline-none focus:ring-2 focus:ring-amber/40"
      >
        {LANGUAGES.map(({ code, label }) => (
          <option key={code} value={code}>
            {label}
          </option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute right-1.5 h-3 w-3 text-char/40"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M2 4l4 4 4-4" />
      </svg>
    </div>
  );
}
