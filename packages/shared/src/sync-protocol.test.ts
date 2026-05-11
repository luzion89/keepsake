import { describe, it, expect } from 'vitest';
import { PushReqSchema } from './sync-protocol.js';

const DEVICE = 'device-test';
const ID = '11111111-1111-4111-8111-111111111111';

describe('sync-protocol: patch op', () => {
  it('PushReqSchema accepts a valid patch op', () => {
    const req = {
      deviceId: DEVICE,
      ops: [{
        kind: 'patch',
        table: 'item',
        id: ID,
        fields: { name: 'NewName', qty: 5 },
        updated_at: 1000,
        updated_by: 'deviceA',
        base_version: 0,
      }],
    };
    const result = PushReqSchema.safeParse(req);
    expect(result.success).toBe(true);
  });

  it('patch.fields must be a record', () => {
    const req = {
      deviceId: DEVICE,
      ops: [{
        kind: 'patch',
        table: 'item',
        id: ID,
        fields: 'not-a-record',
        updated_at: 1000,
        updated_by: 'deviceA',
        base_version: 0,
      }],
    };
    const result = PushReqSchema.safeParse(req);
    expect(result.success).toBe(false);
  });

  it('patch.updated_at must be nonnegative', () => {
    const req = {
      deviceId: DEVICE,
      ops: [{
        kind: 'patch',
        table: 'item',
        id: ID,
        fields: { name: 'X' },
        updated_at: -1,
        updated_by: 'deviceA',
        base_version: 0,
      }],
    };
    const result = PushReqSchema.safeParse(req);
    expect(result.success).toBe(false);
  });

  it('patch.updated_by must be non-empty string', () => {
    const req = {
      deviceId: DEVICE,
      ops: [{
        kind: 'patch',
        table: 'item',
        id: ID,
        fields: { name: 'X' },
        updated_at: 1000,
        updated_by: '',
        base_version: 0,
      }],
    };
    const result = PushReqSchema.safeParse(req);
    expect(result.success).toBe(false);
  });

  it('existing upsert/delete/qty_delta ops still parse correctly', () => {
    const req = {
      deviceId: DEVICE,
      ops: [
        { kind: 'upsert', table: 'room', row: { id: ID, name: 'r' } },
        { kind: 'delete', table: 'room', id: ID, updated_at: 100 },
        { kind: 'qty_delta', itemId: ID, delta: 3, updated_at: 200 },
      ],
    };
    const result = PushReqSchema.safeParse(req);
    expect(result.success).toBe(true);
  });
});
