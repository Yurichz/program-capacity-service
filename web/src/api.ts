import type { Result } from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: Record<string, unknown>,
    public code?: number,
  ) {
    super(message);
  }

  get uncertain() {
    return this.status === 0 || this.status >= 500;
  }
}
let accessToken: string | null = null;
let rotation: Promise<void> | null = null;
const refreshKey = 'capacity.refresh';
const pendingKey = 'capacity.pending';

export function clearSession() {
  accessToken = null;
  for (const key of Object.keys(sessionStorage))
    if (key.startsWith('capacity.')) sessionStorage.removeItem(key);
}
function savePair(pair: { accessToken: string; refreshToken: string }) {
  accessToken = pair.accessToken;
  sessionStorage.setItem(refreshKey, pair.refreshToken);
}
async function raw<T>(path: string, init: RequestInit = {}): Promise<Result<T>> {
  let response: Response;

  try {
    response = await fetch(path, {
      ...init,
      signal: init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;

    throw new ApiError(0, 'Connection interrupted. Please try again.');
  }

  if (response.status === 204) return { success: true, data: null as T };

  let value;

  try {
    value = await response.json();
  } catch {
    throw new ApiError(
      response.status >= 400 ? response.status : 503,
      'The service returned an unreadable response.',
    );
  }

  if (!response.ok)
    throw new ApiError(
      response.status,
      value?.error?.message ?? 'Request failed',
      value?.error?.details,
      value?.error?.code,
    );

  if (
    value === null ||
    typeof value !== 'object' ||
    value.success !== true ||
    !Object.hasOwn(value, 'data')
  )
    throw new ApiError(503, 'The service returned an unreadable response. Retry the same request.');

  return value;
}
export async function refreshSession() {
  if (!rotation)
    rotation = (async () => {
      const refreshToken = sessionStorage.getItem(refreshKey);

      if (!refreshToken) throw new ApiError(401, 'Please sign in to continue.');

      try {
        savePair(
          (
            await raw<{ accessToken: string; refreshToken: string }>('/api/v1/auth/token/refresh', {
              method: 'POST',
              body: JSON.stringify({ refreshToken }),
            })
          ).data,
        );
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          clearSession();
          window.dispatchEvent(new Event('capacity:unauthorized'));
        }

        throw error;
      }
    })().finally(() => {
      rotation = null;
    });

  return rotation;
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<Result<T>> {
  const send = () =>
    raw<T>(path, {
      ...init,
      headers: {
        ...init.headers,
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
    });

  if (!accessToken) await refreshSession();

  const attemptedToken = accessToken;

  try {
    return await send();
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;

    if (accessToken === attemptedToken) await refreshSession();

    try {
      return await send();
    } catch (retryError) {
      if (retryError instanceof ApiError && retryError.status === 401) {
        clearSession();
        window.dispatchEvent(new Event('capacity:unauthorized'));
      }

      throw retryError;
    }
  }
}
export async function signIn(email: string, password: string) {
  savePair(
    (
      await raw<{ accessToken: string; refreshToken: string }>('/api/v1/auth/sign-in', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
    ).data,
  );
}
export async function logout() {
  try {
    await api('/api/v1/auth/logout', { method: 'POST' });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
  }

  clearSession();
}
export function hasSession() {
  return !!sessionStorage.getItem(refreshKey);
}
export async function command<T>(path: string, body: object) {
  const signature = path + '\n' + JSON.stringify(body);
  const pending = JSON.parse(sessionStorage.getItem(pendingKey) ?? '{}') as Record<string, string>;
  const key = pending[signature] ?? crypto.randomUUID();

  pending[signature] = key;
  sessionStorage.setItem(pendingKey, JSON.stringify(pending));
  const finish = () => {
    const current = JSON.parse(sessionStorage.getItem(pendingKey) ?? '{}');

    delete current[signature];
    sessionStorage.setItem(pendingKey, JSON.stringify(current));
  };

  try {
    const result = await api<T>(path, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Idempotency-Key': key },
    });

    finish();

    return result;
  } catch (error) {
    if (error instanceof ApiError && !error.uncertain) finish();

    throw error;
  }
}
export function message(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Please try again.';

  if (error.code === 401001)
    return 'Invalid email or password. Check your credentials and try again.';

  if (error.status === 401) return 'Your session has expired. Please sign in again.';

  if (error.status === 403) return 'Your account does not have permission for this action.';

  if (error.status === 422 && error.details)
    return (
      Object.values(error.details)
        .flatMap((value) => (typeof value === 'object' ? Object.values(value ?? {}) : value))
        .join(' · ') || error.message
    );

  return error.message;
}
