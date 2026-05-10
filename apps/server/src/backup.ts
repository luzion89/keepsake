/**
 * SQLite 自动备份模块
 * 使用 VACUUM INTO 进行热备份（不停服、原子写入）
 * 只依赖 Node.js 内置模块 + better-sqlite3（已有依赖）
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { resolve, basename } from 'node:path';
import type Database from 'better-sqlite3';

export interface BackupOptions {
  /** 源数据库文件路径 */
  dbPath: string;
  /** 备份目录 */
  backupDir: string;
  /** 备份间隔（毫秒） */
  intervalMs: number;
  /** 最多保留份数 */
  keep: number;
}

/** 返回今天的日期字符串 YYYY-MM-DD */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 扫描备份目录，返回按文件名升序排列的 .sqlite 备份文件路径列表 */
export function listBackups(backupDir: string): string[] {
  if (!existsSync(backupDir)) return [];
  return readdirSync(backupDir)
    .filter((f) => /^keepsake-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f))
    .sort()
    .map((f) => resolve(backupDir, f));
}

/** 删除超出 keep 数量的最旧备份 */
export function pruneBackups(backupDir: string, keep: number): void {
  const files = listBackups(backupDir);
  const excess = files.length - keep;
  if (excess > 0) {
    files.slice(0, excess).forEach((f) => {
      try {
        unlinkSync(f);
      } catch {
        // 忽略删除失败（文件可能已被手动删除）
      }
    });
  }
}

/** 执行一次备份，返回备份文件路径；若今日备份已存在则跳过并返回已有路径 */
export function runBackup(db: Database.Database, backupDir: string): string {
  mkdirSync(backupDir, { recursive: true });
  const dest = resolve(backupDir, `keepsake-${today()}.sqlite`);
  if (existsSync(dest)) {
    console.log('[backup] 今日备份已存在，跳过');
    return dest;
  }
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  return dest;
}

/**
 * 启动自动备份调度：
 * 1. 打印上次备份信息
 * 2. 若距上次备份已超 interval，立即触发
 * 3. 启动 setInterval 定时备份
 * 返回 clearInterval 用的 timer id（用于测试 / 优雅关闭）
 */
export function startBackupScheduler(
  db: Database.Database,
  opts: BackupOptions,
): ReturnType<typeof setInterval> | null {
  const { backupDir, intervalMs, keep } = opts;

  mkdirSync(backupDir, { recursive: true });

  // 打印上次备份信息
  const existing = listBackups(backupDir);
  if (existing.length > 0) {
    const lastFile = existing[existing.length - 1]!;
    const lastDate = basename(lastFile).replace('keepsake-', '').replace('.sqlite', '');
    console.log(`[backup] 上次备份：${lastDate}`);
  }

  const doBackup = () => {
    try {
      const dest = runBackup(db, backupDir);
      pruneBackups(backupDir, keep);
      console.log(`[backup] 备份完成：${dest}`);
    } catch (err) {
      console.error('[backup] 备份失败：', err);
    }
  };

  // intervalMs <= 0：只触发一次立即备份，不启动 setInterval
  if (intervalMs <= 0) {
    doBackup();
    return null;
  }

  // 判断是否需要立即备份
  const shouldRunNow = (): boolean => {
    const files = listBackups(backupDir);
    if (files.length === 0) return true;
    const lastFile = files[files.length - 1]!;
    const lastMtime = statSync(lastFile).mtimeMs;
    return Date.now() - lastMtime >= intervalMs;
  };

  if (shouldRunNow()) {
    doBackup();
  }

  const timer = setInterval(doBackup, intervalMs);
  // Node.js：不阻止进程退出
  if (timer.unref) timer.unref();
  return timer;
}
