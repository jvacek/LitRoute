import { useTranslation } from 'react-i18next';
import {
  Link,
  isRouteErrorResponse,
  useRouteError,
  type LoaderFunctionArgs,
} from 'react-router-dom';
import { apiClient } from '../api/client';
import type { components } from '../api/schema';

export type CheckinEditLoaderData = {
  checkin: components['schemas']['CheckIn'];
};

// Kept in a separate module so the loader stays eager — React Router can fire
// it the moment navigation starts, in parallel with the lazy CheckinEdit chunk
// download. (If it lived in CheckinEdit.tsx, the loader would only become
// available after the chunk arrived, defeating the parallelism.)
export async function checkinEditLoader({
  params,
}: LoaderFunctionArgs): Promise<CheckinEditLoaderData> {
  const identifier = params.identifier ?? '';
  const checkinId = Number(params.checkinId);
  const { data, response } = await apiClient.GET(
    '/api/units/{identifier}/checkins/',
    { params: { path: { identifier } } },
  );
  if (!response.ok || !data) {
    throw new Response('Not Found', { status: 404 });
  }
  const checkin = data.find((c) => c.id === checkinId);
  if (!checkin) {
    throw new Response('Not Found', { status: 404 });
  }
  return { checkin };
}

export function CheckinEditErrorElement() {
  const error = useRouteError();
  const { t } = useTranslation();
  if (!isRouteErrorResponse(error) || error.status !== 404) {
    throw error;
  }
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 py-16 text-center">
      <p className="font-heading mb-4 text-[6rem] font-bold leading-none text-char/10">
        404
      </p>
      <h1 className="font-heading mb-2 text-2xl font-semibold text-char">
        {t('errorPage.404.headline')}
      </h1>
      <p className="mb-8 max-w-sm text-smoke">
        {t('errorPage.404.description')}
      </p>
      <Link
        to="/"
        className="rounded-btn bg-amber px-[22px] py-[9px] text-sm font-semibold tracking-wide text-char transition-transform hover:-translate-y-px active:translate-y-0"
      >
        {t('errorPage.backToHome')}
      </Link>
    </div>
  );
}
