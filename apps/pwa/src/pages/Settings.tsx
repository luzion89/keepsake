import { useEffect, useState } from 'react';
import { getAiConfig, setAiConfig, type AiConfig } from '../ai/router.js';
import { db, getDeviceId } from '../db/dexie.js';
import { syncOnce } from '../sync/client.js';

export function SettingsPage() {
  const [cfg, setCfg] = useState<AiConfig>({ mode: 'off', provider: 'openai' });
  const [deviceId, setDeviceId] = useState('');
  const [stats, setStats] = useState({ rooms: 0, areas: 0, items: 0, photos: 0, outbox: 0 });
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

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
    })();
  }, []);

  const save = async () => {
    await setAiConfig(cfg);
    setSavedAt(Date.now());
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

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">设置</h1>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-300">AI 调用模式</h2>
        <div className="space-y-2 text-sm">
          {(['client','server','off'] as const).map(m => (
            <label key={m} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 cursor-pointer">
              <input
                type="radio"
                checked={cfg.mode === m}
                onChange={() => setCfg({ ...cfg, mode: m })}
                className="mt-1"
              />
              <span>
                <span className="font-medium">
                  {m === 'client' && '客户端直连云 AI（推荐）'}
                  {m === 'server' && '通过本地服务器代理'}
                  {m === 'off' && '关闭 AI（仅手动录入）'}
                </span>
                <span className="block text-xs text-slate-400">
                  {m === 'client' && 'Key 仅存本机 IndexedDB，不会上传或同步。'}
                  {m === 'server' && '由家里的 Keepsake 服务器持有 Key，需服务器在线。'}
                  {m === 'off' && '完全离线模式，所有物品手动添加。'}
                </span>
              </span>
            </label>
          ))}
        </div>

        {cfg.mode === 'client' && (
          <div className="space-y-2">
            <select
              value={cfg.provider}
              onChange={(e) => setCfg({ ...cfg, provider: e.target.value as any })}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2"
            >
              <option value="openai">OpenAI (gpt-4o-mini)</option>
              <option value="gemini">Gemini (TODO)</option>
            </select>
            <input
              type="password"
              value={cfg.apiKey ?? ''}
              onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })}
              placeholder="sk-..."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 font-mono text-sm"
            />
            <input
              value={cfg.model ?? ''}
              onChange={(e) => setCfg({ ...cfg, model: e.target.value })}
              placeholder="model（默认 gpt-4o-mini）"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2"
            />
          </div>
        )}
        <button onClick={save} className="px-4 py-2 rounded-lg bg-sky-500 text-slate-950 font-medium">保存</button>
        {savedAt && <span className="ml-2 text-xs text-emerald-300">已保存</span>}
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
        <button onClick={exportJson} className="mt-2 px-3 py-2 rounded-lg border border-slate-700">导出 JSON 备份</button>
      </section>
    </div>
  );
}
