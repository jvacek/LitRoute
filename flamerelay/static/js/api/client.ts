import createClient from 'openapi-fetch';
import { apiFetch } from '../api';
import type { paths } from './schema';

// Typed client backed by `apiFetch` so CSRF + cookie handling stay in one
// place. Regenerate types with `just specs`.
export const apiClient = createClient<paths>({
  fetch: apiFetch as typeof fetch,
});
