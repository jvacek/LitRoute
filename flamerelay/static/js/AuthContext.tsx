import * as Sentry from '@sentry/react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import i18n from './i18n';
import { apiFetch } from './api';
import type { components } from './api/schema';

type Account = components['schemas']['User'];

interface AuthContextValue {
  isAuthenticated: boolean;
  username: string;
  name: string;
  adminUrl: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  isAuthenticated: false,
  username: '',
  name: '',
  adminUrl: null,
  loading: true,
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const resp = await apiFetch('/api/account/');
      if (resp.ok) {
        const me = (await resp.json()) as Account;
        setUser(me);
        Sentry.setUser({ username: me.username });
        if (me.language && me.language !== i18n.resolvedLanguage) {
          void i18n.changeLanguage(me.language);
        }
      } else {
        setUser(null);
        Sentry.setUser(null);
      }
    } catch {
      setUser(null);
      Sentry.setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: user !== null,
        username: user?.username ?? '',
        name: user?.name ?? '',
        adminUrl: user?.admin_url ?? null,
        loading,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
