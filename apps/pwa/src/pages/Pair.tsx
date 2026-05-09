/**
 * Spike-A: Pair / scan QR page
 *
 * Flow:
 *  1. Show QR scanner (html5-qrcode) until a valid Keepsake QR is detected.
 *  2. Parse payload: { server, root_secret, v, family_key_salt?, invite_token? }
 *  3. If invite_token: POST <server>/auth/join
 *     Else:           POST <server>/auth/pair  (root_secret pairing)
 *  4. Store device_token + family_key_salt in IndexedDB kv.
 *  5. Derive family_key from root_secret, store in sessionStorage (ephemeral).
 *  6. Navigate to /.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';
import { kvSet } from '../db/dexie.js';

export interface QrPayload {
  server: string;
  root_secret?: string;
  invite_token?: string;
  family_key_salt?: string;
  v: number;
}

export function parseQrPayload(raw: string): QrPayload | null {
  try {
    const obj = JSON.parse(raw);
    if (typeof obj?.server !== 'string') return null;
    if (typeof obj?.v !== 'number') return null;
    return obj as QrPayload;
  } catch {
    return null;
  }
}

export function PairPage() {
  const [status, setStatus] = useState<'scanning' | 'pairing' | 'error' | 'done'>('scanning');
  const [errorMsg, setErrorMsg] = useState('');
  const [manualInput, setManualInput] = useState('');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const navigate = useNavigate();
  const scannerDivId = 'keepsake-qr-scanner';

  const startedRef = useRef(false);

  useEffect(() => {
    const scanner = new Html5Qrcode(scannerDivId, { verbose: false });
    scannerRef.current = scanner;
    startedRef.current = false;

    scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 240, height: 240 } },
      async (decodedText) => {
        if (!startedRef.current) return;
        startedRef.current = false;
        await scanner.stop().catch(() => {});
        handlePayload(decodedText);
      },
      () => { /* scan error: ignore, keep scanning */ },
    ).then(() => {
      startedRef.current = true;
    }).catch((err) => {
      // Camera not available — user can use manual input
      console.warn('[Pair] Camera unavailable:', err);
    });

    return () => {
      if (startedRef.current) {
        startedRef.current = false;
        scanner.stop().catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handlePayload(raw: string) {
    const payload = parseQrPayload(raw);
    if (!payload) {
      setErrorMsg('无法识别的 QR 码，请确认是 Keepsake 服务器二维码');
      setStatus('error');
      return;
    }
    setStatus('pairing');
    try {
      await doPair(payload);
      setStatus('done');
      navigate('/', { replace: true });
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }

  return (
    <div style={{ maxWidth: 400, margin: '0 auto', padding: '24px 16px', fontFamily: 'sans-serif' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>扫描配对二维码</h1>
      <p style={{ color: '#666', marginBottom: 16, fontSize: 14 }}>
        在 Keepsake 服务器页面打开二维码，用相机扫描配对
      </p>

      {status === 'scanning' && (
        <>
          <div id={scannerDivId} style={{ width: '100%', borderRadius: 12, overflow: 'hidden', background: '#111' }} />
          <p style={{ textAlign: 'center', marginTop: 12, color: '#888', fontSize: 13 }}>
            将服务器二维码对准框内
          </p>
        </>
      )}

      {status === 'pairing' && (
        <div style={{ textAlign: 'center', padding: 40, color: '#444' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🔐</div>
          正在配对…
        </div>
      )}

      {status === 'done' && (
        <div style={{ textAlign: 'center', padding: 40, color: '#16a34a' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
          配对成功！正在跳转…
        </div>
      )}

      {status === 'error' && (
        <div>
          <div style={{
            background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8,
            padding: 12, color: '#dc2626', marginBottom: 16, fontSize: 14,
          }}>
            {errorMsg}
          </div>
          <button
            style={{
              width: '100%', padding: '10px 0', background: '#111', color: '#fff',
              border: 'none', borderRadius: 8, fontSize: 15, cursor: 'pointer',
            }}
            onClick={() => { setStatus('scanning'); setErrorMsg(''); }}
          >
            重试
          </button>
        </div>
      )}

      {/* Manual input fallback (for demo / Playwright testing) */}
      <details style={{ marginTop: 24 }}>
        <summary style={{ cursor: 'pointer', color: '#888', fontSize: 13 }}>手动输入（调试用）</summary>
        <textarea
          rows={4}
          style={{ width: '100%', marginTop: 8, fontSize: 12, padding: 8, borderRadius: 6, border: '1px solid #ddd', boxSizing: 'border-box' }}
          placeholder='{"server":"http://...","root_secret":"...","v":1}'
          value={manualInput}
          onChange={(e) => setManualInput(e.target.value)}
        />
        <button
          style={{
            marginTop: 6, padding: '8px 16px', background: '#6366f1', color: '#fff',
            border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13,
          }}
          onClick={() => handlePayload(manualInput)}
        >
          确认
        </button>
      </details>
    </div>
  );
}

// ── Pairing logic ──────────────────────────────────────────────────────────

async function doPair(payload: QrPayload) {
  const { server, root_secret, invite_token, family_key_salt } = payload;

  let deviceToken: string;
  let deviceId: string;

  if (invite_token) {
    // Join via invite token
    const res = await fetch(`${server}/auth/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invite_token, device_name: getDeviceName() }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(`配对失败: ${err.error ?? res.status}`);
    }
    const data = await res.json();
    deviceToken = data.device_token;
    deviceId = data.device_id;
    if (data.family_id) await kvSet('family_id', data.family_id);
  } else if (root_secret) {
    // Direct pair via root_secret
    const res = await fetch(`${server}/auth/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root_secret, device_name: getDeviceName() }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(`配对失败: ${err.error ?? res.status}`);
    }
    const data = await res.json();
    deviceToken = data.device_token;
    deviceId = data.device_id;
    if (data.family_id) await kvSet('family_id', data.family_id);
  } else {
    throw new Error('QR 码格式错误：缺少 root_secret 或 invite_token');
  }

  // Store credentials
  await kvSet('device_token', deviceToken);
  await kvSet('device_id', deviceId);
  await kvSet('server_url', server);
  if (family_key_salt) {
    await kvSet('family_key_salt', family_key_salt);
  }
  if (root_secret) {
    // Derive and cache family_key_material in sessionStorage (ephemeral, not persisted to disk)
    await kvSet('root_secret_hint', root_secret); // stored in IDB (encrypted in prod, plain in spike)
  }

  // Update global fetch interceptor with new token
  setAuthToken(deviceToken);
}

function getDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  return `Browser (${ua.slice(0, 30)})`;
}

// ── Auth token global state ────────────────────────────────────────────────
// Stored in module scope so the fetch interceptor can read it synchronously.

let _authToken: string | null = null;

export function setAuthToken(token: string | null) {
  _authToken = token;
}
export function getAuthToken(): string | null {
  return _authToken;
}
