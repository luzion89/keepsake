/**
 * Client-side ring-buffer logger.
 * - In-memory ring buffer: last 200 entries.
 * - Persisted to IndexedDB `error_logs` table (survives restarts).
 * - `pushed` flag tracks which entries have been synced to the server.
 */

import { db, type ErrorLogRow } from '../db/dexie.js';

export type LogLevel = 'error' | 'warn' | 'info';

export interface LogEntry {
  ts: number;
  level: LogLevel;
  code: string;
  message: string;
  context?: unknown;
}

const RING_SIZE = 200;
const ring: LogEntry[] = [];

function pushToRing(entry: LogEntry) {
  if (ring.length >= RING_SIZE) {
    ring.shift(); // drop oldest
  }
  ring.push(entry);
}

async function persist(entry: LogEntry): Promise<void> {
  try {
    // Keep only last RING_SIZE rows in IndexedDB too
    const count = await db.error_logs.count();
    if (count >= RING_SIZE) {
      const oldest = await db.error_logs.orderBy('ts').limit(count - RING_SIZE + 1).primaryKeys();
      await db.error_logs.bulkDelete(oldest as number[]);
    }
    await db.error_logs.add({ ...entry, pushed: 0 });
  } catch { /* never throw from logger */ }
}

function log(level: LogLevel, code: string, message: string, context?: unknown) {
  const entry: LogEntry = { ts: Date.now(), level, code, message, context };
  pushToRing(entry);
  persist(entry);
  if (level === 'error') console.error(`[${code}]`, message, context ?? '');
  else if (level === 'warn') console.warn(`[${code}]`, message, context ?? '');
}

export const logger = {
  error: (code: string, message: string, context?: unknown) => log('error', code, message, context),
  warn:  (code: string, message: string, context?: unknown) => log('warn',  code, message, context),
  info:  (code: string, message: string, context?: unknown) => log('info',  code, message, context),
  /** Returns a snapshot of the in-memory ring buffer (newest last). */
  getEntries: (): readonly LogEntry[] => [...ring],
};

/**
 * Push unpushed log entries to the server.
 * Called after a successful sync.
 */
export async function pushLogs(): Promise<void> {
  try {
    const unpushed = await db.error_logs.where('pushed').equals(0).limit(200).toArray();
    if (unpushed.length === 0) return;
    const res = await fetch('/logs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ logs: unpushed }),
    });
    if (res.ok) {
      const ids = unpushed.map(r => r.id as number);
      await db.error_logs.bulkUpdate(ids.map(id => ({ key: id, changes: { pushed: 1 } })));
    }
  } catch { /* offline – will retry next sync */ }
}
