import { apiClient } from '../api/client';

export type UserFormLoaderData = {
  name: string;
};

// PrivateRoute redirects anon users before this component renders, but the
// loader fires unconditionally first. A 403 just returns an empty name —
// the user will be bounced to /accounts/login/ before they see the form.
export async function userFormLoader(): Promise<UserFormLoaderData> {
  const { data } = await apiClient.GET('/api/account/');
  return { name: data?.name ?? '' };
}
