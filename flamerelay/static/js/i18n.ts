import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import en from '../locales/en/translation.json';
import fr from '../locales/fr/translation.json';
import nl from '../locales/nl/translation.json';

export const LANGUAGES = [
  { code: 'en', label: 'English', translation: en },
  { code: 'fr', label: 'Français', translation: fr },
  { code: 'nl', label: 'Nederlands', translation: nl },
] as const;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: Object.fromEntries(
      LANGUAGES.map(({ code, translation }) => [code, { translation }]),
    ),
    supportedLngs: LANGUAGES.map(({ code }) => code),
    load: 'languageOnly',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    detection: { order: ['localStorage', 'navigator'] },
  });

export default i18n;
