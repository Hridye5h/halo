/**
 * API client.
 *
 * The access token lives in a module variable, never localStorage — anything
 * in localStorage is readable by any injected script. The refresh token is an
 * httpOnly cookie the JS here cannot see at all, which is the point.
 */
let accessToken = null;
let onUnauthorized = null;

export const setAccessToken = (token) => { accessToken = token; };
export const getAccessToken = () => accessToken;
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Collapses concurrent refreshes into one request.
 *
 * On page load several queries fire at once; without this each would trigger
 * its own refresh, and because refresh tokens rotate, the later ones would
 * present an already-used token and trip the server's theft detection —
 * logging the user out for doing nothing wrong.
 */
let refreshInFlight = null;

async function refreshAccessToken() {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return null;
      const data = await res.json();
      accessToken = data.accessToken;
      return data;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

async function request(method, path, body, { retry = true } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return request(method, path, body, { retry: false });

    accessToken = null;
    onUnauthorized?.();
  }

  if (res.status === 204) return null;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data.error?.code ?? 'error',
      data.error?.message ?? 'Something went wrong',
      data.error?.details,
    );
  }
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  patch: (path, body) => request('PATCH', path, body),
  delete: (path) => request('DELETE', path),
  refresh: refreshAccessToken,
};
