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
