/**
 * Spike-A: Global fetch interceptor
 *
 * - Adds Authorization: Bearer <token> to all requests
 * - On 401: clears token + redirects to /pair
 *
 * Call initFetchInterceptor() once at app startup (before any fetch).
 */
import { kvGet, kvSet } from '../db/dexie.js';
import { setAuthToken, getAuthToken } from '../pages/Pair.js';

const originalFetch = globalThis.fetch.bind(globalThis);

let _interceptorInstalled = false;

export async function initFetchInterceptor() {
  if (_interceptorInstalled) return;
  _interceptorInstalled = true;

  // Load token from IDB on startup
  const token = await kvGet<string>('device_token');
  if (token) setAuthToken(token);

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const token = getAuthToken();

    // Build headers with auth if we have a token
    let headers: HeadersInit = init?.headers ?? {};
    if (token) {
      headers = {
        ...flattenHeaders(headers),
        Authorization: `Bearer ${token}`,
      };
    }

    const response = await originalFetch(input, { ...init, headers });

    if (response.status === 401) {
      console.warn('[Auth] 401 received — clearing token and redirecting to /pair');
      await kvSet('device_token', null);
      setAuthToken(null);
      // Redirect to /pair without full reload (react-router-dom navigate is not accessible here,
      // so we use replaceState + dispatch popstate)
      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', '/pair');
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    }

    return response;
  };
}

function flattenHeaders(headers: HeadersInit): Record<string, string> {
  if (headers instanceof Headers) {
    const obj: Record<string, string> = {};
    headers.forEach((v, k) => { obj[k] = v; });
    return obj;
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return headers as Record<string, string>;
}
