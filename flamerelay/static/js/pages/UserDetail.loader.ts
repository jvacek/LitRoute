import { apiClient } from '../api/client';
import type { components } from '../api/schema';

export type UserDetailLoaderData = {
  followedUnits: components['schemas']['Unit'][];
};

// PrivateRoute redirects anon users to /accounts/login/ when this route
// renders, but the loader fires unconditionally before that. A 403 here just
// returns an empty list — PrivateRoute will redirect before the user ever
// sees the empty state. Network errors fall through to the route boundary.
export async function userDetailLoader(): Promise<UserDetailLoaderData> {
  const { data } = await apiClient.GET('/api/account/follows/');
  return { followedUnits: data ?? [] };
}
