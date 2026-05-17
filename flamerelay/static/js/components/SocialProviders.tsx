import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getConfig,
  redirectToProvider,
  type SocialProvider,
} from '../lib/allauthApi';

interface SocialProvidersProps {
  callbackUrl: string;
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}

function FacebookLogo() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="#1877F2"
    >
      <path d="M24 12.073C24 5.404 18.627 0 12 0S0 5.404 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.514c-1.491 0-1.956.93-1.956 1.886v2.267h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z" />
    </svg>
  );
}

const LOGOS: Record<string, () => React.ReactElement> = {
  google: GoogleLogo,
  facebook: FacebookLogo,
};

function ProviderButton({
  provider,
  callbackUrl,
}: {
  provider: SocialProvider;
  callbackUrl: string;
}) {
  const Logo = LOGOS[provider.id];
  return (
    <button
      type="button"
      onClick={() => redirectToProvider(provider.id, callbackUrl)}
      className="flex w-full items-center justify-center gap-3 rounded-btn border border-char/15 px-4 py-[9px] text-sm font-medium tracking-wide text-char transition-colors hover:bg-linen"
    >
      {Logo && <Logo />}
      {provider.name}
    </button>
  );
}

export default function SocialProviders({ callbackUrl }: SocialProvidersProps) {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<SocialProvider[]>([]);

  useEffect(() => {
    getConfig().then((cfg) => setProviders(cfg.socialaccount?.providers ?? []));
  }, []);

  if (!providers.length) return null;

  return (
    <div className="mt-6">
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-char/10" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-white px-2 text-char/40">
            {t('socialProviders.orContinueWith')}
          </span>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        {providers.map((provider) => (
          <ProviderButton
            key={provider.id}
            provider={provider}
            callbackUrl={callbackUrl}
          />
        ))}
      </div>
    </div>
  );
}
