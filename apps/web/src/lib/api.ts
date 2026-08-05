import axios, { AxiosError, type AxiosRequestConfig } from 'axios';

const ACCESS_TOKEN_KEY = 'bizpilot.accessToken';
const REFRESH_TOKEN_KEY = 'bizpilot.refreshToken';

export const tokenStore = {
  get access() {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  },
  get refresh() {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  },
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS_TOKEN_KEY, access);
    localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  },
};

/**
 * In dev the Vite proxy forwards /api to the backend, so a relative base keeps
 * everything same-origin. On Render the frontend is a static site on its own
 * domain, so VITE_API_URL points at the API service and CORS_ORIGINS on the
 * API must list this site.
 */
const baseURL = import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? '/api';

export const api = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = tokenStore.access;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * Access tokens last 15 minutes, so a shopkeeper who leaves the till open over
 * lunch would otherwise be logged out mid-sale. On a 401 we refresh once and
 * replay the request.
 *
 * Concurrent 401s share a single refresh promise — five parallel dashboard
 * queries must not each burn a refresh token, since rotation invalidates the
 * previous one and the losers would all be logged out.
 */
let refreshInFlight: Promise<string> | null = null;

async function refreshSession(): Promise<string> {
  const refreshToken = tokenStore.refresh;
  if (!refreshToken) throw new Error('No refresh token');

  // A bare axios instance on purpose: going through `api` would re-enter the
  // 401 interceptor below and loop if the refresh itself is rejected.
  const response = await axios.post(`${baseURL}/auth/refresh`, { refreshToken });
  const { accessToken, refreshToken: nextRefresh } = response.data;
  tokenStore.set(accessToken, nextRefresh);
  return accessToken;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as AxiosRequestConfig & { _retried?: boolean };

    const isAuthCall = original?.url?.includes('/auth/');
    if (error.response?.status !== 401 || original?._retried || isAuthCall) {
      return Promise.reject(error);
    }

    original._retried = true;

    try {
      refreshInFlight ??= refreshSession().finally(() => {
        refreshInFlight = null;
      });
      const accessToken = await refreshInFlight;

      original.headers = { ...original.headers, Authorization: `Bearer ${accessToken}` };
      return api.request(original);
    } catch {
      tokenStore.clear();
      // A hard redirect rather than a router navigation: the refresh failed, so
      // every cached query in memory is now for a session that no longer exists.
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
      return Promise.reject(error);
    }
  },
);

/** Pulls a human-readable message out of whatever the API returned. */
export function errorMessage(error: unknown, fallback = 'Something went wrong.'): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string | string[] } | undefined;
    if (Array.isArray(data?.message)) return data.message[0];
    if (typeof data?.message === 'string') return data.message;
    if (error.code === 'ERR_NETWORK') return 'No connection. Check your internet and try again.';
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

/** True when the API refused because the business needs a bigger plan. */
export function isPlanLimitError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const data = error.response?.data as { error?: string } | undefined;
  return data?.error === 'PlanLimitReached' || data?.error === 'PlanUpgradeRequired';
}
