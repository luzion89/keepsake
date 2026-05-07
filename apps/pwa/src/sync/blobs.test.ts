/**
 * Tests for gcSyncedBlobs() — issue #50
 *
 * Uses fake implementations of db and kvGet/kvSet so we don't need a real
 * IndexedDB instance.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal fake DB
// ---------------------------------------------------------------------------
type PhotoRow = { id: string; [k: string]: unknown };
type BlobRow = { id: string; blob: Blob };

let fakeBlobs: BlobRow[] = [];
let fakePhotos: PhotoRow[] = [];
let fakeKv: Map<string, unknown> = new Map();

vi.mock('../db/dexie.js', () => ({
  db: {
    blobs: {
      toArray: async () => [...fakeBlobs],
      delete: async (id: string) => {
        fakeBlobs = fakeBlobs.filter(b => b.id !== id);
      },
    },
    photos: {
      toArray: async () => [...fakePhotos],
    },
  },
  kvGet: async (key: string) => fakeKv.get(key),
  kvSet: async (key: string, value: unknown) => { fakeKv.set(key, value); },
}));

// Import AFTER mock is set up
const { gcSyncedBlobs } = await import('./blobs.js');

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function makeBlob() { return new Blob(['x'], { type: 'image/jpeg' }); }

beforeEach(() => {
  fakeBlobs = [];
  fakePhotos = [];
  fakeKv = new Map();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('gcSyncedBlobs()', () => {
  it('空库返回 0', async () => {
    expect(await gcSyncedBlobs()).toBe(0);
  });

  it('未同步的孤立 blob 不删除', async () => {
    fakeBlobs = [{ id: 'b1', blob: makeBlob() }];
    // blob_uploaded flag is absent → not synced yet
    expect(await gcSyncedBlobs()).toBe(0);
    expect(fakeBlobs).toHaveLength(1);
  });

  it('已同步且无引用的 blob 被删除', async () => {
    fakeBlobs = [{ id: 'b1', blob: makeBlob() }];
    fakeKv.set('blob_uploaded:b1', true);
    const count = await gcSyncedBlobs();
    expect(count).toBe(1);
    expect(fakeBlobs).toHaveLength(0);
  });

  it('已同步但仍被 photo 引用的 blob 不删除', async () => {
    fakeBlobs = [{ id: 'p1', blob: makeBlob() }];
    fakePhotos = [{ id: 'p1' }];
    fakeKv.set('blob_uploaded:p1', true);
    expect(await gcSyncedBlobs()).toBe(0);
    expect(fakeBlobs).toHaveLength(1);
  });

  it('混合场景：只删孤立且已同步的', async () => {
    fakeBlobs = [
      { id: 'keep-ref', blob: makeBlob() },   // referenced, uploaded → keep
      { id: 'keep-notsync', blob: makeBlob() }, // orphan, NOT uploaded → keep
      { id: 'del', blob: makeBlob() },          // orphan, uploaded → delete
    ];
    fakePhotos = [{ id: 'keep-ref' }];
    fakeKv.set('blob_uploaded:keep-ref', true);
    fakeKv.set('blob_uploaded:del', true);
    // blob_uploaded:keep-notsync is absent

    const count = await gcSyncedBlobs();
    expect(count).toBe(1);
    expect(fakeBlobs.map(b => b.id).sort()).toEqual(['keep-notsync', 'keep-ref'].sort());
  });
});
