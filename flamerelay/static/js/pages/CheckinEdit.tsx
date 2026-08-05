import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLoaderData, useNavigate, useParams } from 'react-router';
import { apiFetch } from '../api';
import { useAuth } from '../AuthContext';
import { getEditToken } from '../lib/editTokens';
import { uploadPendingImage } from '../lib/uploadPendingImage';
import { useConfig } from '../lib/useConfig';
import CheckinForm, {
  type CheckinFormInitialData,
  type CheckinSubmitPayload,
} from '../components/CheckinForm';
import type { CheckinEditLoaderData } from './CheckinEdit.loader';

export default function CheckinEdit() {
  const { t } = useTranslation();
  const { identifier = '', checkinId = '' } = useParams<{
    identifier: string;
    checkinId: string;
  }>();
  const checkinIdNum = parseInt(checkinId, 10);
  const { maptilerKey } = useConfig();
  const navigate = useNavigate();
  const { isAuthenticated, refresh } = useAuth();
  const unitUrl = `/unit/${identifier}/`;

  const loaderData = useLoaderData() as CheckinEditLoaderData;
  const { checkin } = loaderData;

  const editToken = !isAuthenticated ? getEditToken(checkinIdNum) : null;

  // Anonymous users without an edit token cannot edit. Redirect at mount;
  // the loader doesn't have access to AuthContext, so this guard lives here.
  useEffect(() => {
    if (!isAuthenticated && editToken === null) {
      navigate(unitUrl, { replace: true });
    }
  }, [isAuthenticated, editToken, navigate, unitUrl]);

  // GeoJSON coordinates are `number[]` in the generated schema (Spectacular
  // widens the tuple); narrow at the boundary when seeding form values.
  const [initialData] = useState<CheckinFormInitialData>(() => {
    const coords = (checkin.location.coordinates ?? []) as number[];
    const lng = coords[0] ?? 0;
    const lat = coords[1] ?? 0;
    return {
      location: `${lat},${lng}`,
      place: checkin.place ?? '',
      message: checkin.message ?? '',
      images: checkin.images,
    };
  });

  async function handleUploadImage(file: File, turnstileToken?: string) {
    return await uploadPendingImage(identifier, file, { turnstileToken });
  }

  async function handleSubmit(payload: CheckinSubmitPayload) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (!isAuthenticated && editToken) {
      headers['X-Edit-Token'] = editToken;
    }
    const res = await apiFetch(
      `/api/units/${identifier}/checkins/${checkinIdNum}/`,
      { method: 'PATCH', body: JSON.stringify(payload), headers },
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
    try {
      return (await res.json()) as Record<string, string[]>;
    } catch {
      return { non_field_errors: [t('common.unexpectedError')] };
    }
  }

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
        onUploadImage={handleUploadImage}
        onSubmit={handleSubmit}
      />
    </main>
  );
}
