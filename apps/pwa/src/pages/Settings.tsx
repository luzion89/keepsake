import { useEffect, useState } from 'react';
import { getAiConfig, setAiConfig, DEFAULT_MODEL, DEFAULT_TRANSCRIBE_MODEL, type AiConfig, pingOpenRouter } from '../ai/router.js';
import { db, getDeviceId } from '../db/dexie.js';
import { syncOnce } from '../sync/client.js';
import { gcSyncedBlobs } from '../sync/blobs.js';

/** Storage quota info from navigator.storage.estimate(), or null if unsupported. */
interface StorageQuota {
  usageMB: number;
  quotaMB: number;
  pct: number; // 0-100
}

async function getStorageQuota(): Promise<StorageQuota | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    if (quota === 0) return null;
    const usageMB = usage / 1024 / 1024;
    const quotaMB = quota / 1024 / 1024;
    return { usageMB, quotaMB, pct: Math.round((usage / quota) * 100) };
  } catch {
    return null;
  }
}

export function SettingsPage() {
  const [cfg, setCfg] = useState<AiConfig>({ mode: 'off' });
  const [deviceId, setDeviceId] = useState('');
  const [stats, setStats] = useState({ rooms: 0, areas: 0, items: 0, photos: 0, outbox: 0 });
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [aiPingState, setAiPingState] = useState<'idle' | 'pinging'>('idle');
  const [aiPingResult, setAiPingResult] = useState<{ ok: boolean; latencyMs?: number; error?: string } | null>(null);
  const [gcResult, setGcResult] = useState<number | null>(null);
  const [gcRunning, setGcRunning] = useState(false);
  const [quota, setQuota] = useState<StorageQuota | null | 'unsupported'>('unsupported');

  const reloadStats = async () => setStats({
    rooms: await db.rooms.count(),
    areas: await db.areas.count(),
    items: await db.items.count(),
    photos: await db.photos.count(),
    outbox: await db.outbox.count(),
  });

  useEffect(() => {
    (async () => {
      setCfg(await getAiConfig());
      setDeviceId(await getDeviceId());
      reloadStats();
      const q = await getStorageQuota();
      setQuota(q); // null = API missing; StorageQuota = ok
    })();
  }, []);

  const save = async () => {
    const result = await setAiConfig(cfg);
    setSavedAt(Date.now());
    if (result.ok) {
      setSaveError(null);
    } else {
      setSaveError(result.error ?? '未知错误');
    }
  };

  const pingAi = async () => {
    const key = cfg.apiKey?.trim();
    if (!key) { setAiPingResult({ ok: false, error: '请先填写 API Key' }); return; }
    setAiPingState('pinging');
    setAiPingResult(null);
    const result = await pingOpenRouter(key);
    setAiPingState('idle');
    setAiPingResult(result);
  };

  const ping = async () => {
    try {
      const r = await fetch('/health');
      setServerOk(r.ok);
    } catch { setServerOk(false); }
  };

  const exportJson = async () => {
    const dump = {
      rooms: await db.rooms.toArray(),
      areas: await db.areas.toArray(),
      items: await db.items.toArray(),
      photos: await db.photos.toArray(),
      snapshots: await db.snapshots.toArray(),
    };
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `keepsake-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const runGc = async () => {
    setGcRunning(true);
    setGcResult(null);
    try {
      const n = await gcSyncedBlobs();
      setGcResult(n);
      reloadStats();
    } finally {
      setGcRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">设置</h1>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-300">AI（OpenRouter）</h2>
        <p className="text-xs text-slate-400">
          仅支持 OpenRouter。Key 保存到本地 IndexedDB；保存时立即推送到本地服务器（需服务器在线），其它设备启动时拉取，更新时间最新者胜。注意：此同步仅限 AI 配置，物品与照片数据走独立同步通道。
        </p>
        <div className="space-y-2 text-sm">
          {(['on','off'] as const).map(m => (
            <label key={m} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 cursor-pointer">
              <input
                type="radio"
                checked={cfg.mode === m}
                onChange={() => setCfg({ ...cfg, mode: m })}
                className="mt-1"
              />
              <span>
                <span className="font-medium">
                  {m === 'on' && '启用 AI（拍照识别 / 语音输入）'}
                  {m === 'off' && '关闭 AI（仅手动管理）'}
                </span>
              </span>
            </label>
          ))}
        </div>

        {cfg.mode === 'on' && (
          <div className="space-y-2">
            <label className="block text-xs text-slate-400">OpenRouter API Key</label>
            <input
              type="password"
              value={cfg.apiKey ?? ''}
              onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })}
              placeholder="sk-or-v1-..."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 font-mono text-sm"
              autoComplete="off"
            />
            <label className="block text-xs text-slate-400">视觉模型（默认 {DEFAULT_MODEL}）</label>
            <input
              value={cfg.model ?? ''}
              onChange={(e) => setCfg({ ...cfg, model: e.target.value })}
              placeholder={DEFAULT_MODEL}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2"
            />
            <label className="block text-xs text-slate-400">语音转写模型（默认 {DEFAULT_TRANSCRIBE_MODEL}）</label>
            <input
              value={cfg.transcribeModel ?? ''}
              onChange={(e) => setCfg({ ...cfg, transcribeModel: e.target.value })}
              placeholder={DEFAULT_TRANSCRIBE_MODEL}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2"
            />
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={pingAi}
                disabled={aiPingState === 'pinging'}
                className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm disabled:opacity-50"
              >
                {aiPingState === 'pinging' ? '测试中…' : '测试连通性'}
              </button>
              {aiPingResult?.ok === true && (
                <span className="text-emerald-300 text-xs">✓ 连通（{aiPingResult.latencyMs} ms）</span>
              )}
              {aiPingResult?.ok === false && (
                <span className="text-rose-400 text-xs">✗ 失败：{aiPingResult.error}</span>
              )}
            </div>
          </div>
        )}
        <button onClick={save} className="px-4 py-2 rounded-lg bg-sky-500 text-slate-950 font-medium">保存</button>
        {savedAt && !saveError && <span className="ml-2 text-xs text-emerald-300">已同步</span>}
        {savedAt && saveError && (
          <span className="ml-2 text-xs text-rose-400">
            已保存到本地，服务端推送失败：{saveError}（重新打开应用会重试）
          </span>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-300">本地服务器</h2>
        <div className="flex items-center gap-2">
          <button onClick={ping} className="px-3 py-2 rounded-lg border border-slate-700">检测连通性</button>
          {serverOk === true && <span className="text-emerald-300 text-sm">在线</span>}
          {serverOk === false && <span className="text-rose-300 text-sm">离线</span>}
          <button onClick={() => syncOnce().then(r => alert(r ? `已同步 推 ${r.pushed} / 拉 ${r.pulled} / 冲突 ${r.conflicts}` : '服务器不可达'))} className="px-3 py-2 rounded-lg border border-slate-700">立即同步</button>
        </div>
      </section>

      <section className="text-sm text-slate-400 space-y-1">
        <h2 className="text-sm font-semibold text-slate-300">本机数据</h2>
        <p>设备 ID: <span className="font-mono">{deviceId}</span></p>
        <p>房间 {stats.rooms} · 区域 {stats.areas} · 物品 {stats.items} · 照片 {stats.photos} · 待同步 {stats.outbox}</p>

        {/* Storage quota — #51 */}
        <div className="pt-1 space-y-1">
          {quota === 'unsupported' ? null /* still loading */ : quota === null ? (
            <p className="text-xs text-slate-500">本地存储：暂不支持</p>
          ) : (
            <>
              <p className={`text-xs ${quota.pct > 80 ? 'text-rose-400 font-semibold' : 'text-slate-400'}`}>
                本地存储 {quota.usageMB.toFixed(1)} MB / {quota.quotaMB.toFixed(0)} MB（{quota.pct}%）
                {quota.pct > 80 && ' ⚠️ 空间紧张'}
              </p>
              <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${quota.pct > 80 ? 'bg-rose-500' : 'bg-sky-500'}`}
                  style={{ width: `${Math.min(quota.pct, 100)}%` }}
                />
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 mt-2">
          <button onClick={exportJson} className="px-3 py-2 rounded-lg border border-slate-700">导出 JSON 备份</button>
          <button
            onClick={runGc}
            disabled={gcRunning}
            className="px-3 py-2 rounded-lg border border-slate-700 disabled:opacity-50"
          >
            {gcRunning ? '清理中…' : '清理本地缓存'}
          </button>
          {gcResult !== null && (
            <span className="text-xs text-emerald-300">
              {gcResult > 0 ? `已释放 ${gcResult} 个已同步 blob` : '无可清理项'}
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
