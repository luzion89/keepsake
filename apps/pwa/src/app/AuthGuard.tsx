/**
 * Spike-A: AuthGuard — wraps routes that require authentication.
 * If no device_token in IDB → redirect to /pair.
 */
import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { kvGet } from '../db/dexie.js';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const [checked, setChecked] = useState(false);
  const [hasToken, setHasToken] = useState(false);

  useEffect(() => {
    kvGet<string>('device_token').then((token) => {
      setHasToken(!!token);
      setChecked(true);
    });
  }, []);

  if (!checked) return null; // Loading state — render nothing
  if (!hasToken) return <Navigate to="/pair" replace />;
  return <>{children}</>;
}
