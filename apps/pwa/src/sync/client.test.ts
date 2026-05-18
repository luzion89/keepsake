/**
 * PWA sync/client.ts — push-first ordering and fetchWithRetry tests.
 * Tests are driven by mocking fetch and navigator.onLine.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock Dexie ────────────────────────────────────────────────────────────────
const mockOutboxRows: any[] = [];
let mockKvStore: Record<string, unknown> = {};
let mockConflicts: unknown[] = [];

vi.mock('../db/dexie.js', () => ({
  db: {
    outbox: {
      orderBy: vi.fn(() => ({
        limit: vi.fn(() => ({
          toArray: vi.fn(async () => mockOutboxRows),
        })),
      })),
      where: vi.fn(() => ({
        belowOrEqual: vi.fn(() => ({
          delete: vi.fn(async () => undefined),
        })),
      })),
    },
    conflicts: {
      add: vi.fn(async (row: unknown) => { mockConflicts.push(row); }),
    },
    blobs: { toArray: vi.fn(async () => []) },
    photos: { toArray: vi.fn(async () => []) },
    error_logs: {
      where: vi.fn(() => ({ equals: vi.fn(() => ({ limit: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })) })),
    },
  },
  getDeviceId: vi.fn(async () => 'test-device'),
  kvGet: vi.fn(async (k: string) => mockKvStore[k]),
  kvSet: vi.fn(async (k: string, v: unknown) => { mockKvStore[k] = v; }),
}));

// ── Mock AI router (imported in client.ts) ────────────────────────────────────
vi.mock('../ai/router.js', () => ({
  pullAiConfigFromServer: vi.fn(async () => {}),
}));

// ── Mock blobs sync ───────────────────────────────────────────────────────────
vi.mock('./blobs.js', () => ({
  pushPendingBlobs: vi.fn(async () => {}),
  pullMissingBlobs: vi.fn(async () => {}),
}));

// ── Mock logger ───────────────────────────────────────────────────────────────
vi.mock('../logging/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  pushLogs: vi.fn(async () => {}),
}));

// ── Stub navigator.onLine ─────────────────────────────────────────────────────
Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });

// ── Pull / Push mock responses ────────────────────────────────────────────────
function makePullResp(serverTime = 9999) {
  return { ok: true, json: async () => ({ serverTime, changes: [] }) };
}
function makePushResp(accepted: string[] = [], conflicts: any[] = [], rejected: any[] = []) {
  return { ok: true, json: async () => ({ serverTime: 9999, accepted, conflicts, rejected }) };
}

beforeEach(() => {
  mockKvStore = {};
  mockConflicts = [];
  // Reset outbox to empty
  mockOutboxRows.length = 0;
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('syncOnce — push-first ordering', () => {
  it('calls push before pull when outbox is non-empty', async () => {
    const callOrder: string[] = [];

    // Seed one outbox entry
    mockOutboxRows.push({ client_seq: 1, op: { kind: 'upsert', table: 'room', row: { id: 'room-1' } } });

    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      if (init?.method === 'POST') { callOrder.push('push'); return makePushResp(['room-1']); }
      if (String(url).includes('/health')) { callOrder.push('health'); return { ok: true }; }
      callOrder.push('pull');
      return makePullResp();
    }));

    const { syncOnce } = await import('./client.js');
    await syncOnce();

    expect(callOrder).toContain('push');
    expect(callOrder).toContain('pull');
    // push must come before pull
    expect(callOrder.indexOf('push')).toBeLessThan(callOrder.indexOf('pull'));
  });

  it('conflicts from push are stored in the conflicts table', async () => {
    mockOutboxRows.push({ client_seq: 1, op: { kind: 'upsert', table: 'room', row: { id: 'r1' } } });

    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      if (init?.method === 'POST') {
        return makePushResp([], [{ id: 'r1', table: 'room', field: 'name', client: 'A', server: 'B' }]);
      }
      if (String(url).includes('/health')) return { ok: true };
      return makePullResp();
    }));

    const { syncOnce } = await import('./client.js');
    const result = await syncOnce();
    expect(result?.conflicts).toBe(1);
    expect(mockConflicts).toHaveLength(1);
  });

  it('returns null when server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('NetworkError'); }));

    const { syncOnce } = await import('./client.js');
    const result = await syncOnce();
    expect(result).toBeNull();
  });

  it('returns result with pushed=0 when outbox is empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/health')) return { ok: true };
      return makePullResp(5000);
    }));

    const { syncOnce } = await import('./client.js');
    const result = await syncOnce();
    expect(result?.pushed).toBe(0);
    expect(result?.pulled).toBe(0);
  });
});
