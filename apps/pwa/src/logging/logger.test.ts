/**
 * #44 logger tests
 * Tests ring-buffer eviction and server POST /logs schema validation logic.
 * Avoids Dexie/IndexedDB by testing pure functions in isolation.
 */
import { describe, it, expect } from 'vitest';

// ---- Ring-buffer logic ----

const RING_SIZE = 200;

interface LogEntry {
  ts: number;
  level: 'error' | 'warn' | 'info';
  code: string;
  message: string;
  context?: unknown;
}

function makeRing() {
  const ring: LogEntry[] = [];
  function push(entry: LogEntry) {
    if (ring.length >= RING_SIZE) ring.shift();
    ring.push(entry);
  }
  return { ring, push };
}

describe('ring buffer', () => {
  it('holds up to 200 entries', () => {
    const { ring, push } = makeRing();
    for (let i = 0; i < 200; i++) push({ ts: i, level: 'info', code: 'test', message: `msg ${i}` });
    expect(ring.length).toBe(200);
  });

  it('evicts oldest when over capacity', () => {
    const { ring, push } = makeRing();
    for (let i = 0; i < 201; i++) push({ ts: i, level: 'info', code: 'test', message: `msg ${i}` });
    expect(ring.length).toBe(200);
    // ts=0 evicted; first remaining is ts=1
    expect(ring[0]!.ts).toBe(1);
    expect(ring[199]!.ts).toBe(200);
  });

  it('evicts multiple oldest when adding in bulk', () => {
    const { ring, push } = makeRing();
    for (let i = 0; i < 250; i++) push({ ts: i, level: 'error', code: 'x', message: `m${i}` });
    expect(ring.length).toBe(200);
    expect(ring[0]!.ts).toBe(50);
  });
});

// ---- POST /logs schema validation (mirrors server-side BodySchema) ----

const VALID_LEVELS = new Set(['error', 'warn', 'info']);

interface RawLogEntry { ts?: unknown; level?: unknown; code?: unknown; message?: unknown; context?: unknown; }
interface RawBody { logs?: unknown }

function validateLogsBody(body: RawBody): { ok: true; logs: LogEntry[] } | { ok: false; error: string } {
  if (!Array.isArray(body.logs)) return { ok: false, error: 'logs must be an array' };
  if (body.logs.length === 0) return { ok: false, error: 'logs must not be empty' };
  if (body.logs.length > 500) return { ok: false, error: 'logs exceeds max 500' };
  const logs: LogEntry[] = [];
  for (const entry of body.logs as RawLogEntry[]) {
    if (typeof entry.ts !== 'number' || !Number.isInteger(entry.ts)) return { ok: false, error: 'ts must be int' };
    if (!VALID_LEVELS.has(entry.level as string)) return { ok: false, error: `invalid level: ${entry.level}` };
    if (typeof entry.code !== 'string' || (entry.code as string).length > 64) return { ok: false, error: 'invalid code' };
    if (typeof entry.message !== 'string' || (entry.message as string).length > 1000) return { ok: false, error: 'invalid message' };
    logs.push({ ts: entry.ts, level: entry.level as LogEntry['level'], code: entry.code, message: entry.message, context: entry.context });
  }
  return { ok: true, logs };
}

describe('POST /logs schema', () => {
  it('accepts valid payload', () => {
    const result = validateLogsBody({ logs: [{ ts: Date.now(), level: 'error', code: 'vision_failed', message: 'oops' }] });
    expect(result.ok).toBe(true);
  });

  it('rejects unknown level', () => {
    const result = validateLogsBody({ logs: [{ ts: 1, level: 'critical', code: 'x', message: 'y' }] });
    expect(result.ok).toBe(false);
  });

  it('rejects empty logs array', () => {
    const result = validateLogsBody({ logs: [] });
    expect(result.ok).toBe(false);
  });

  it('rejects missing ts', () => {
    const result = validateLogsBody({ logs: [{ level: 'info', code: 'x', message: 'y' }] });
    expect(result.ok).toBe(false);
  });

  it('rejects code longer than 64 chars', () => {
    const result = validateLogsBody({ logs: [{ ts: 1, level: 'warn', code: 'x'.repeat(65), message: 'y' }] });
    expect(result.ok).toBe(false);
  });

  it('accepts optional context', () => {
    const result = validateLogsBody({ logs: [{ ts: 1, level: 'info', code: 'x', message: 'y', context: { foo: 'bar' } }] });
    expect(result.ok).toBe(true);
  });
});
