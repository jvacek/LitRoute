import { useTranslation } from 'react-i18next';
import SocialAccountManager from '../../components/SocialAccountManager';
import DeleteAccountSection from './DeleteAccountSection';
import EmailSection from './EmailSection';
import MfaSection from './MfaSection';
import NotificationsSection from './NotificationsSection';
import PasskeySection from './PasskeySection';
import ProfileSection from './ProfileSection';

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-card bg-white p-6 shadow-card">
      <h2 className="font-heading mb-5 text-lg font-semibold text-char">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function UserSettings() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto max-w-xl px-6 py-10">
      <h1 className="font-heading mb-8 text-3xl font-bold text-char">
        {t('common.settings')}
      </h1>
      <div className="space-y-8">
        <Section title={t('common.profile')}>
          <ProfileSection />
        </Section>
        <Section title={t('settings.email.sectionTitle')}>
          <EmailSection />
        </Section>
        <Section title={t('settings.notifications.sectionTitle')}>
          <NotificationsSection />
        </Section>
        <Section title={t('common.twoFactorAuth')}>
          <MfaSection />
        </Section>
        <Section title={t('settings.passkeys.sectionTitle')}>
          <PasskeySection />
        </Section>
        <Section title={t('common.connectedAccounts')}>
          <SocialAccountManager callbackUrl="/accounts/login/" />
        </Section>
        <Section title={t('settings.deleteAccount.sectionTitle')}>
          <DeleteAccountSection />
        </Section>
      </div>
    </main>
  );
}
