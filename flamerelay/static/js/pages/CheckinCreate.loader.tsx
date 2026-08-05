import { isRouteErrorResponse, useRouteError } from 'react-router';
import type { LoaderFunctionArgs } from 'react-router';
import { apiClient } from '../api/client';
import type { components } from '../api/schema';
import { UnitErrorElement } from './Unit.loader';

export type CheckinCreateLoaderData = {
  unit: components['schemas']['Unit'];
};

// Kept in a separate module so the loader stays eager — React Router can fire
// it the moment navigation starts, in parallel with the lazy CheckinCreate
// chunk download. (If it lived in CheckinCreate.tsx, the loader would only
// become available after the chunk arrived, defeating the parallelism.)
export async function checkinCreateLoader({
  params,
}: LoaderFunctionArgs): Promise<CheckinCreateLoaderData> {
  const identifier = params.identifier ?? '';
  const unitResp = await apiClient.GET('/api/units/{identifier}/', {
    params: { path: { identifier } },
  });
  if (unitResp.response.status === 404 || !unitResp.data) {
    throw new Response('Unit not found', { status: 404 });
  }
  return { unit: unitResp.data };
}

// Same "unit not found" situation as the Unit page — delegate to its error
// element so the messaging stays consistent across the two routes.
export function CheckinCreateErrorElement() {
  const error = useRouteError();
  if (!isRouteErrorResponse(error) || error.status !== 404) {
    throw error;
  }
  return <UnitErrorElement />;
}
