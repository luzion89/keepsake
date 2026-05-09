/**
 * Keepsake Application-Layer E2E Encryption
 * Spike-C: Field-level AES-256-GCM + HKDF key derivation
 *
 * All encryption uses Web Crypto API (browser) or node:crypto (server).
 * Zero external dependencies.
 *
 * Key hierarchy:
 *   root_secret (shared via QR scan)
 *     └─ HKDF-SHA256 → family_key (32 bytes, all devices in family share this)
 *
 * Each encrypted field:
 *   { nonce: base64(12 bytes), cipher: base64(ciphertext+tag), updated_at, device_id }
 */

// ── Platform-agnostic crypto ──────────────────────────────────────────────
// Node 18+ exposes globalThis.crypto (Web Crypto API compatible).
// Browsers have globalThis.crypto natively.
// We use the global directly — no need for conditional imports.

function getSubtle(): SubtleCrypto {
  return (globalThis as any).crypto.subtle as SubtleCrypto;
}

function getRandomBytes(n: number): Uint8Array {
  return (globalThis as any).crypto.getRandomValues(new Uint8Array(n)) as Uint8Array;
}

function b64encode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function b64decode(s: string): Uint8Array {
  const binary = atob(s);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  return buf;
}

// ── Key derivation ────────────────────────────────────────────────────────

/**
 * Derive the family_key from root_secret using HKDF-SHA256.
 * All devices with the same root_secret produce the same family_key.
 *
 * @param rootSecret  - hex or utf-8 string from QR payload
 * @param salt        - optional per-family salt (stored as family_key_salt in QR)
 */
export async function deriveFamilyKey(
  rootSecret: string,
  salt = 'keepsake-family-v1',
): Promise<CryptoKey> {
  const subtle = getSubtle();
  const enc = new TextEncoder();

  const baseKey = await subtle.importKey(
    'raw',
    enc.encode(rootSecret),
    { name: 'HKDF' },
    false,
    ['deriveKey'],
  );

  return subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: enc.encode(salt),
      info: enc.encode('data-encryption'),
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,          // not extractable
    ['encrypt', 'decrypt'],
  );
}

// ── Field-level encryption ────────────────────────────────────────────────

export interface EncField {
  nonce: string;        // base64, 12 bytes
  cipher: string;       // base64, ciphertext + 16-byte GCM auth tag
  updated_at: number;   // ms timestamp for field-level LWW
  device_id: string;    // for LWW tie-breaking
}

/**
 * Encrypt a single field value (any JSON-serialisable value).
 * Returns an EncField with a fresh random nonce.
 */
export async function encryptField(
  key: CryptoKey,
  value: unknown,
  updated_at: number,
  device_id: string,
): Promise<EncField> {
  const subtle = getSubtle();
  const nonce = getRandomBytes(12);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const cipherBuf = await subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as unknown as BufferSource },
    key,
    plaintext as unknown as BufferSource,
  );
  return {
    nonce: b64encode(nonce),
    cipher: b64encode(cipherBuf),
    updated_at,
    device_id,
  };
}

/**
 * Decrypt a single EncField back to its original value.
 * Throws if the key is wrong or the ciphertext is corrupted (GCM auth fail).
 */
export async function decryptField<T = unknown>(
  key: CryptoKey,
  field: EncField,
): Promise<T> {
  const subtle = getSubtle();
  const nonce = b64decode(field.nonce);
  const cipher = b64decode(field.cipher);
  const plainBuf = await subtle.decrypt(
    { name: 'AES-GCM', iv: nonce as unknown as BufferSource },
    key,
    cipher as unknown as BufferSource,
  );
  return JSON.parse(new TextDecoder().decode(plainBuf)) as T;
}

// ── Item-level encryption ─────────────────────────────────────────────────

/** Fields kept in plaintext (server needs for routing / LWW outer) */
export interface PlainItemFields {
  id: string;
  area_id: string;
  deleted: boolean;
  created_at: number;
  updated_at: number;   // outer LWW timestamp (= max of all enc fields)
  updated_by: string;   // outer device_id for outer LWW
  version: number;
  // Non-secret metadata kept plain:
  source: string;
  confidence?: number;
  bbox?: unknown;
}

/** Encrypted business content */
export interface EncItemFields {
  name: EncField;
  qty: EncField;
  unit: EncField;
  expires_at: EncField;
  notes: EncField;
  tags: EncField;
  photo_ids: EncField;
}

export interface EncryptedItem extends PlainItemFields {
  enc: EncItemFields;
}

/**
 * Encrypt all mutable business fields of an Item.
 * The caller should already have resolved the current updated_at / device_id.
 */
export async function encryptItem(
  key: CryptoKey,
  item: {
    id: string;
    area_id: string;
    deleted: boolean;
    created_at: number;
    updated_at: number;
    updated_by: string;
    version: number;
    source: string;
    confidence?: number;
    bbox?: unknown;
    name: string;
    qty: number;
    unit?: string;
    expires_at?: number;
    notes?: string;
    tags: string[];
    photo_ids: string[];
  },
): Promise<EncryptedItem> {
  const ts = item.updated_at;
  const did = item.updated_by;
  const [name, qty, unit, expires_at, notes, tags, photo_ids] = await Promise.all([
    encryptField(key, item.name, ts, did),
    encryptField(key, item.qty, ts, did),
    encryptField(key, item.unit ?? null, ts, did),
    encryptField(key, item.expires_at ?? null, ts, did),
    encryptField(key, item.notes ?? null, ts, did),
    encryptField(key, item.tags, ts, did),
    encryptField(key, item.photo_ids, ts, did),
  ]);
  return {
    id: item.id,
    area_id: item.area_id,
    deleted: item.deleted,
    created_at: item.created_at,
    updated_at: item.updated_at,
    updated_by: item.updated_by,
    version: item.version,
    source: item.source,
    confidence: item.confidence,
    bbox: item.bbox,
    enc: { name, qty, unit, expires_at, notes, tags, photo_ids },
  };
}

/**
 * Decrypt an EncryptedItem back to a plain Item.
 * Throws if the key is wrong or any field's GCM tag fails.
 */
export async function decryptItem(
  key: CryptoKey,
  enc: EncryptedItem,
): Promise<{
  id: string; area_id: string; deleted: boolean; created_at: number;
  updated_at: number; updated_by: string; version: number;
  source: string; confidence?: number; bbox?: unknown;
  name: string; qty: number; unit?: string; expires_at?: number;
  notes?: string; tags: string[]; photo_ids: string[];
}> {
  const [name, qty, unit, expires_at, notes, tags, photo_ids] = await Promise.all([
    decryptField<string>(key, enc.enc.name),
    decryptField<number>(key, enc.enc.qty),
    decryptField<string | null>(key, enc.enc.unit),
    decryptField<number | null>(key, enc.enc.expires_at),
    decryptField<string | null>(key, enc.enc.notes),
    decryptField<string[]>(key, enc.enc.tags),
    decryptField<string[]>(key, enc.enc.photo_ids),
  ]);
  return {
    id: enc.id,
    area_id: enc.area_id,
    deleted: enc.deleted,
    created_at: enc.created_at,
    updated_at: enc.updated_at,
    updated_by: enc.updated_by,
    version: enc.version,
    source: enc.source,
    confidence: enc.confidence,
    bbox: enc.bbox,
    name,
    qty,
    unit: unit ?? undefined,
    expires_at: expires_at ?? undefined,
    notes: notes ?? undefined,
    tags,
    photo_ids,
  };
}

// ── Field-level LWW merge ─────────────────────────────────────────────────

/**
 * Merge two EncField values using Last-Write-Wins:
 *   1. Higher updated_at wins.
 *   2. Tie: higher device_id string wins (deterministic).
 */
export function mergeEncField(a: EncField, b: EncField): EncField {
  if (a.updated_at > b.updated_at) return a;
  if (b.updated_at > a.updated_at) return b;
  // Tie-break by device_id (lexicographic, larger wins)
  return a.device_id >= b.device_id ? a : b;
}

/**
 * Merge two EncryptedItems field-by-field using LWW on each EncField.
 * Plain fields (id, area_id, deleted, etc.) use outer LWW.
 * deleted=true is sticky (beats any concurrent live update).
 */
export function mergeEncryptedItems(local: EncryptedItem, remote: EncryptedItem): EncryptedItem {
  // deleted=true beats concurrent live edits
  if (local.deleted && !remote.deleted) return local;
  if (remote.deleted && !local.deleted) return remote;

  const enc: EncItemFields = {
    name: mergeEncField(local.enc.name, remote.enc.name),
    qty: mergeEncField(local.enc.qty, remote.enc.qty),
    unit: mergeEncField(local.enc.unit, remote.enc.unit),
    expires_at: mergeEncField(local.enc.expires_at, remote.enc.expires_at),
    notes: mergeEncField(local.enc.notes, remote.enc.notes),
    tags: mergeEncField(local.enc.tags, remote.enc.tags),
    photo_ids: mergeEncField(local.enc.photo_ids, remote.enc.photo_ids),
  };

  // Outer updated_at = max of all fields' updated_at
  const outerTs = Math.max(
    ...Object.values(enc).map((f) => (f as EncField).updated_at),
  );

  // Pick outer updated_by from field that produced outerTs
  const winnerField = Object.values(enc).find(
    (f) => (f as EncField).updated_at === outerTs,
  ) as EncField;

  return {
    id: local.id,
    area_id: local.area_id,
    deleted: local.deleted,
    created_at: Math.min(local.created_at, remote.created_at),
    updated_at: outerTs,
    updated_by: winnerField.device_id,
    version: Math.max(local.version, remote.version) + 1,
    source: local.source,
    confidence: local.confidence ?? remote.confidence,
    bbox: local.bbox ?? remote.bbox,
    enc,
  };
}
