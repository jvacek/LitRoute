import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import SocialAccountManager from '../components/SocialAccountManager';

export default function SocialConnections() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <main className="mx-4 mt-16 max-w-xl rounded-card border border-char/10 bg-white px-8 py-10 shadow-sm sm:mx-auto">
      <h1 className="font-heading mb-6 text-2xl font-bold text-char">
        {t('common.connectedAccounts')}
      </h1>
      <SocialAccountManager
        callbackUrl="/accounts/login/"
        onUnauthorized={() => navigate('/accounts/login/')}
      />
    </main>
  );
}
