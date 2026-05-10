import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { listBackups, pruneBackups, runBackup, startBackupScheduler } from './backup.js';

let tmpDir: string;
let backupDir: string;
let db: Database.Database;
let dbPath: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(resolve(tmpdir(), 'keepsake-backup-test-'));
  backupDir = resolve(tmpDir, 'backups');
  dbPath = resolve(tmpDir, 'keepsake.sqlite');
  db = new Database(dbPath);
  db.exec('CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY)');
});

afterEach(async () => {
  db.close();
  await rm(tmpDir, { recursive: true, force: true });
});

describe('runBackup', () => {
  it('生成备份文件', () => {
    const dest = runBackup(db, backupDir);
    expect(dest).toMatch(/keepsake-\d{4}-\d{2}-\d{2}\.sqlite$/);
    // 文件存在且可被 better-sqlite3 打开
    const bak = new Database(dest, { readonly: true });
    const tables = bak
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    bak.close();
    expect(tables.map((t) => t.name)).toContain('items');
  });

  it('目标文件已存在时静默跳过，不抛异常', () => {
    // 先备份一次，生成今日文件
    const dest1 = runBackup(db, backupDir);
    // 再次备份，目标文件已存在，应不抛异常，返回同路径
    let dest2: string | undefined;
    expect(() => {
      dest2 = runBackup(db, backupDir);
    }).not.toThrow();
    expect(dest2).toBe(dest1);
  });
});

describe('pruneBackups', () => {
  it('保留最多 N 份，删除最旧的', () => {
    mkdirSync(backupDir, { recursive: true });
    const keep = 3;
    // 创造 keep+1 = 4 个旧备份文件（文件名模拟不同日期）
    const dates = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04'];
    dates.forEach((d) => {
      writeFileSync(resolve(backupDir, `keepsake-${d}.sqlite`), 'dummy');
    });
    pruneBackups(backupDir, keep);
    const remaining = listBackups(backupDir);
    expect(remaining).toHaveLength(keep);
    // 最旧的 2026-01-01 应被删除
    expect(remaining.map((f) => f.includes('2026-01-01'))).not.toContain(true);
  });
});

describe('startBackupScheduler', () => {
  it('首次启动（无历史备份）立即生成一份', () => {
    const timer = startBackupScheduler(db, {
      dbPath,
      backupDir,
      intervalMs: 24 * 60 * 60 * 1000,
      keep: 4,
    });
    if (timer) clearInterval(timer);
    const files = listBackups(backupDir);
    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  it('保留策略：N+1 份旧文件触发后只剩 N 份', () => {
    const keep = 2;
    mkdirSync(backupDir, { recursive: true });
    // 预填 keep 份旧备份（不含今天，确保触发备份）
    const oldDates = ['2026-01-01', '2026-01-02'];
    oldDates.forEach((d) => {
      writeFileSync(resolve(backupDir, `keepsake-${d}.sqlite`), 'dummy');
    });
    // 距上次备份（mock 文件 mtime 很旧）已超 interval，所以会立即备份
    const timer = startBackupScheduler(db, {
      dbPath,
      backupDir,
      intervalMs: 1, // 1ms，立即触发
      keep,
    });
    if (timer) clearInterval(timer);
    const files = listBackups(backupDir);
    expect(files.length).toBeLessThanOrEqual(keep);
  });

  it('intervalMs=0 时只触发一次备份，不启动 setInterval（返回 null）', () => {
    const timer = startBackupScheduler(db, {
      dbPath,
      backupDir,
      intervalMs: 0,
      keep: 4,
    });
    // intervalMs<=0 时应返回 null，不启动周期调度
    expect(timer).toBeNull();
    // 备份文件应存在（执行了一次）
    const files = listBackups(backupDir);
    expect(files.length).toBeGreaterThanOrEqual(1);
  });
});
