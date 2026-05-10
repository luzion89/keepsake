import { useState, useEffect } from 'react';

export type ServerStatus = 'checking' | 'online' | 'offline';

const POLL_INTERVAL_MS = 30_000;
const FETCH_TIMEOUT_MS = 5_000;

async function checkHealth(): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch('/health', { signal: ctrl.signal });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function useServerStatus(): ServerStatus {
  const [status, setStatus] = useState<ServerStatus>('checking');

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      const ok = await checkHealth();
      if (!cancelled) setStatus(ok ? 'online' : 'offline');
    };

    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return status;
}
