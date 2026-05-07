export function getCsrfToken(): string {
  const match = document.cookie.match(
    /(?:^|;)\s*(?:__Secure-)?csrftoken=([^;]+)/,
  );
  return match ? decodeURIComponent(match[1]) : '';
}

export async function apiFetch(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const method = (options.method ?? 'GET').toUpperCase();
  const mutating = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method);
  return fetch(url, {
    ...options,
    headers: {
      ...(mutating ? { 'X-CSRFToken': getCsrfToken() } : {}),
      ...options.headers,
    },
  });
}

export async function requestLocationClaim(
  lat: number,
  lng: number,
  accuracy: number,
  unitIdentifier: string,
): Promise<string> {
  const r = await apiFetch('/api/location-claim/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lat,
      lng,
      accuracy,
      unit_identifier: unitIdentifier,
    }),
  });
  if (!r.ok) throw new Error('Failed to get location claim');
  const data = (await r.json()) as { token: string };
  return data.token;
}
