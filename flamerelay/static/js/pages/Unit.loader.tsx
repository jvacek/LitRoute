import { Trans, useTranslation } from 'react-i18next';
import {
  Link,
  isRouteErrorResponse,
  useParams,
  useRouteError,
  type LoaderFunctionArgs,
} from 'react-router-dom';
import { apiClient } from '../api/client';
import type { components } from '../api/schema';

export type UnitLoaderData = {
  unit: components['schemas']['Unit'];
  checkins: components['schemas']['CheckIn'][];
};

// Kept in a separate module so the loader stays eager — React Router can fire
// it the moment navigation starts, in parallel with the lazy Unit chunk
// download. (If it lived in Unit.tsx, the loader would only become available
// after the chunk arrived, defeating the parallelism.)
export async function unitLoader({
  params,
}: LoaderFunctionArgs): Promise<UnitLoaderData> {
  const identifier = params.identifier ?? '';
  const [unitResp, checkinsResp] = await Promise.all([
    apiClient.GET('/api/units/{identifier}/', {
      params: { path: { identifier } },
    }),
    apiClient.GET('/api/units/{identifier}/checkins/', {
      params: { path: { identifier } },
    }),
  ]);
  if (unitResp.response.status === 404 || !unitResp.data) {
    throw new Response('Unit not found', { status: 404 });
  }
  return {
    unit: unitResp.data,
    checkins: checkinsResp.data ?? [],
  };
}

export function UnitErrorElement() {
  const error = useRouteError();
  const { identifier = '' } = useParams<{ identifier: string }>();
  const { t } = useTranslation();
  if (!isRouteErrorResponse(error) || error.status !== 404) {
    throw error;
  }
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 py-16 text-center">
      <p className="font-heading mb-4 text-[6rem] font-bold leading-none text-char/10">
        ?
      </p>
      <h1 className="font-heading mb-2 text-2xl font-semibold text-char">
        {t('unit.notFound.heading')}
      </h1>
      <p className="mb-1 max-w-sm text-smoke">
        <Trans
          i18nKey="unit.notFound.body1"
          values={{ identifier }}
          components={{ strong: <strong className="text-char" /> }}
        />
      </p>
      <p className="mb-8 max-w-sm text-smoke">
        <Trans
          i18nKey="unit.notFound.body2"
          components={{
            handwriting: (
              <strong className="font-handwriting text-lg text-char" />
            ),
          }}
        />
      </p>
      <Link
        to="/"
        className="rounded-btn bg-amber px-[22px] py-[9px] text-sm font-semibold tracking-wide text-char transition-transform hover:-translate-y-px active:translate-y-0"
      >
        {t('unit.notFound.cta')}
      </Link>
    </div>
  );
}
