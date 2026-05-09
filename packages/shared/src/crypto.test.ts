/**
 * Spike-C: Crypto library tests (vitest)
 *
 * Coverage:
 *  1. Symmetric: encrypt → decrypt === original
 *  2. Cross-device consistency: same root_secret → same family_key behavior
 *  3. Wrong key rejection: GCM auth tag fails
 *  4. Field-level LWW: A changes name later + B changes qty later → both preserved
 *  5. Tombstone: deleted=true sticky across merge
 */
import { describe, it, expect } from 'vitest';
import {
  deriveFamilyKey,
  encryptField,
  decryptField,
  encryptItem,
  decryptItem,
  mergeEncField,
  mergeEncryptedItems,
} from './crypto.js';

const ROOT_SECRET = 'test-root-secret-abc123';
const DEVICE_A = 'device-aaaa';
const DEVICE_B = 'device-bbbb';

// Helper: build a minimal item for testing
function makeItem(overrides: Partial<Parameters<typeof encryptItem>[1]> = {}): Parameters<typeof encryptItem>[1] {
  return {
    id: 'item-0001',
    area_id: 'area-0001',
    deleted: false,
    created_at: 1000,
    updated_at: 2000,
    updated_by: DEVICE_A,
    version: 0,
    source: 'manual',
    name: 'Apple',
    qty: 5,
    unit: 'kg',
    expires_at: 9999999,
    notes: 'Fresh',
    tags: ['fruit', 'organic'],
    photo_ids: ['photo-001'],
    ...overrides,
  };
}

describe('deriveFamilyKey', () => {
  it('returns a CryptoKey', async () => {
    const key = await deriveFamilyKey(ROOT_SECRET);
    expect(key).toBeDefined();
    expect(key.type).toBe('secret');
    expect(key.algorithm.name).toBe('AES-GCM');
  });
});

describe('encryptField / decryptField', () => {
  it('symmetric: string round-trips', async () => {
    const key = await deriveFamilyKey(ROOT_SECRET);
    const ef = await encryptField(key, 'Hello World', 1000, DEVICE_A);
    const result = await decryptField<string>(key, ef);
    expect(result).toBe('Hello World');
  });

  it('symmetric: number round-trips', async () => {
    const key = await deriveFamilyKey(ROOT_SECRET);
    const ef = await encryptField(key, 42, 1000, DEVICE_A);
    const result = await decryptField<number>(key, ef);
    expect(result).toBe(42);
  });

  it('symmetric: array round-trips', async () => {
    const key = await deriveFamilyKey(ROOT_SECRET);
    const arr = ['fruit', 'organic'];
    const ef = await encryptField(key, arr, 1000, DEVICE_A);
    const result = await decryptField<string[]>(key, ef);
    expect(result).toEqual(arr);
  });

  it('symmetric: null round-trips', async () => {
    const key = await deriveFamilyKey(ROOT_SECRET);
    const ef = await encryptField(key, null, 1000, DEVICE_A);
    const result = await decryptField(key, ef);
    expect(result).toBeNull();
  });

  it('cross-device consistency: same root_secret → can decrypt', async () => {
    const keyA = await deriveFamilyKey(ROOT_SECRET);
    const keyB = await deriveFamilyKey(ROOT_SECRET);
    // Device A encrypts
    const ef = await encryptField(keyA, 'Shared secret data', 1000, DEVICE_A);
    // Device B decrypts using independently derived key
    const result = await decryptField<string>(keyB, ef);
    expect(result).toBe('Shared secret data');
  });

  it('wrong key rejection: different root_secret throws', async () => {
    const keyA = await deriveFamilyKey(ROOT_SECRET);
    const keyB = await deriveFamilyKey('completely-different-secret');
    const ef = await encryptField(keyA, 'secret', 1000, DEVICE_A);
    await expect(decryptField(keyB, ef)).rejects.toThrow();
  });
});

describe('encryptItem / decryptItem', () => {
  it('full item round-trip', async () => {
    const key = await deriveFamilyKey(ROOT_SECRET);
    const item = makeItem();
    const encrypted = await encryptItem(key, item);
    // Check plain fields are in plaintext
    expect(encrypted.id).toBe(item.id);
    expect(encrypted.area_id).toBe(item.area_id);
    expect(encrypted.deleted).toBe(false);
    // Encrypted fields should NOT be readable as plain strings
    expect(typeof encrypted.enc.name.cipher).toBe('string');
    expect(encrypted.enc.name.cipher).not.toBe(item.name);

    const decrypted = await decryptItem(key, encrypted);
    expect(decrypted.name).toBe(item.name);
    expect(decrypted.qty).toBe(item.qty);
    expect(decrypted.unit).toBe(item.unit);
    expect(decrypted.expires_at).toBe(item.expires_at);
    expect(decrypted.notes).toBe(item.notes);
    expect(decrypted.tags).toEqual(item.tags);
    expect(decrypted.photo_ids).toEqual(item.photo_ids);
  });
});

describe('mergeEncField (field-level LWW)', () => {
  it('higher updated_at wins', async () => {
    const key = await deriveFamilyKey(ROOT_SECRET);
    const early = await encryptField(key, 'old', 1000, DEVICE_A);
    const late  = await encryptField(key, 'new', 2000, DEVICE_B);
    const merged = mergeEncField(early, late);
    expect(merged.updated_at).toBe(2000);
    expect(merged.device_id).toBe(DEVICE_B);
    // Verify decryption
    const val = await decryptField<string>(key, merged);
    expect(val).toBe('new');
  });

  it('tie-break by device_id lexicographic', async () => {
    const key = await deriveFamilyKey(ROOT_SECRET);
    const fa = await encryptField(key, 'aval', 1000, DEVICE_A);
    const fb = await encryptField(key, 'bval', 1000, DEVICE_B);
    // DEVICE_B ('device-bbbb') > DEVICE_A ('device-aaaa') lexicographically → B wins
    const merged = mergeEncField(fa, fb);
    expect(merged.device_id).toBe(DEVICE_B);
  });
});

describe('mergeEncryptedItems (field-level LWW full item)', () => {
  it('A changes name later + B changes qty later → both preserved', async () => {
    const key = await deriveFamilyKey(ROOT_SECRET);
    const base = makeItem();

    // Device A encrypts item with updated name at t=3000
    const itemA = makeItem({ name: 'Banana', qty: 5, updated_at: 3000, updated_by: DEVICE_A });
    const encA = await encryptItem(key, itemA);
    // Manually give name field t=3000, qty field t=1000 (simulating partial field update)
    encA.enc.name = await encryptField(key, 'Banana', 3000, DEVICE_A);
    encA.enc.qty  = await encryptField(key, 5, 1000, DEVICE_A);

    // Device B encrypts item with updated qty at t=4000
    const itemB = makeItem({ name: 'Apple', qty: 99, updated_at: 4000, updated_by: DEVICE_B });
    const encB = await encryptItem(key, itemB);
    encB.enc.name = await encryptField(key, 'Apple', 1000, DEVICE_B);
    encB.enc.qty  = await encryptField(key, 99, 4000, DEVICE_B);

    const merged = mergeEncryptedItems(encA, encB);
    const decrypted = await decryptItem(key, merged);

    // A's name update (t=3000) beats B's name (t=1000)
    expect(decrypted.name).toBe('Banana');
    // B's qty update (t=4000) beats A's qty (t=1000)
    expect(decrypted.qty).toBe(99);
  });

  it('deleted=true is sticky (tombstone wins over live)', async () => {
    const key = await deriveFamilyKey(ROOT_SECRET);
    const live = await encryptItem(key, makeItem({ deleted: false, updated_at: 9999 }));
    const dead = await encryptItem(key, makeItem({ deleted: true,  updated_at: 1 }));
    const merged = mergeEncryptedItems(live, dead);
    expect(merged.deleted).toBe(true);
  });

  it('tombstone syncs across devices (deleted can still be merged)', async () => {
    const key = await deriveFamilyKey(ROOT_SECRET);
    const dead = await encryptItem(key, makeItem({ deleted: true, updated_at: 5000, updated_by: DEVICE_A }));
    const alsoLive = await encryptItem(key, makeItem({ deleted: false, updated_at: 3000, updated_by: DEVICE_B }));
    const merged = mergeEncryptedItems(dead, alsoLive);
    expect(merged.deleted).toBe(true);
    expect(merged.id).toBe('item-0001');
  });
});
