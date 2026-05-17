import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../api';
import { useAuth } from '../AuthContext';
import { getEditToken } from '../lib/editTokens';
import { reportError } from '../lib/sentry';
import { useConfig } from '../lib/useConfig';
import CheckinForm, {
  type CheckinFormInitialData,
  type ExistingImage,
} from '../components/CheckinForm';
import ErrorPage from './ErrorPage';

interface GeoPoint {
  type: 'Point';
  coordinates: [number, number]; // [lng, lat]
}

interface CheckInData {
  id: number;
  location: GeoPoint;
  place: string;
  message: string;
  images: ExistingImage[];
}

export default function CheckinEdit() {
  const { t } = useTranslation();
  const { identifier = '', checkinId = '' } = useParams<{
    identifier: string;
    checkinId: string;
  }>();
  const checkinIdNum = parseInt(checkinId, 10);
  const config = useConfig();
  const maptilerKey = config?.maptilerKey ?? '';
  const navigate = useNavigate();
  const { isAuthenticated, refresh } = useAuth();
  const unitUrl = `/unit/${identifier}/`;

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [initialData, setInitialData] = useState<CheckinFormInitialData>({});

  const editToken = !isAuthenticated ? getEditToken(checkinIdNum) : null;

  useEffect(() => {
    if (!isAuthenticated && editToken === null) {
      navigate(unitUrl, { replace: true });
      return;
    }
    apiFetch(`/api/units/${identifier}/checkins/`)
      .then((r) => {
        if (!r.ok) {
          setNotFound(true);
          return null;
        }
        return r.json() as Promise<CheckInData[] | { results: CheckInData[] }>;
      })
      .then((data) => {
        if (!data) return;
        const list = Array.isArray(data) ? data : data.results;
        const checkin = list.find((c) => c.id === checkinIdNum);
        if (!checkin) {
          setNotFound(true);
          return;
        }
        setInitialData({
          location: `${checkin.location.coordinates[1]},${checkin.location.coordinates[0]}`,
          place: checkin.place,
          message: checkin.message,
          images: checkin.images,
        });
      })
      .catch((err: unknown) => {
        reportError(err, { where: 'CheckinEdit.load' });
        setNotFound(true);
      })
      .finally(() => setLoading(false));
  }, [identifier, checkinIdNum, isAuthenticated, editToken, unitUrl, navigate]);

  async function handleSubmit(data: FormData) {
    const headers: Record<string, string> = {};
    if (!isAuthenticated && editToken) {
      headers['X-Edit-Token'] = editToken;
    }
    const res = await apiFetch(
      `/api/units/${identifier}/checkins/${checkinIdNum}/`,
      { method: 'PATCH', body: data, headers },
    );
    if (res.ok) {
      navigate(unitUrl);
      return null;
    }
    if (res.status === 401) {
      await refresh();
      navigate('/accounts/login/');
      return null;
    }
    return (await res.json()) as Record<string, string[]>;
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-center text-smoke">
        {t('common.loading')}…
      </div>
    );
  }

  if (notFound) return <ErrorPage code={404} />;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="font-heading mb-8 text-3xl font-bold text-char">
        {t('checkin.editTitle')}
      </h1>
      <CheckinForm
        mode="edit"
        initialData={initialData}
        unitUrl={unitUrl}
        maptilerKey={maptilerKey}
        gpsDriftFloorM={0}
        onSubmit={handleSubmit}
      />
    </main>
  );
}
