import { useTranslation } from 'react-i18next';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from './AuthContext';

export default function PrivateRoute({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-center text-smoke">
        {t('common.loading')}…
      </div>
    );
  }

  if (!isAuthenticated) {
    const next = location.pathname + location.search + location.hash;
    return (
      <Navigate
        to={`/accounts/login/?next=${encodeURIComponent(next)}`}
        replace
      />
    );
  }

  return <>{children}</>;
}
