import { useEffect, useState } from 'react';
import {
  getAiConfig, setAiConfig,
  DEFAULT_MODEL, DEFAULT_TRANSCRIBE_MODEL,
  DEFAULT_DEEPSEEK_MODEL,
  pingProvider,
  type AiConfig, type AiProvider,
} from '../ai/router.js';
import { db, getDeviceId } from '../db/dexie.js';
import { syncOnce } from '../sync/client.js';
import { gcSyncedBlobs } from '../sync/blobs.js';

/** Storage quota info from navigator.storage.estimate(), or null if unsupported. */
interface StorageQuota {
  usageMB: number;
  quotaMB: number;
  pct: number;
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

/** Section wrapper with iOS-style grouped list */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</h2>
      <div className="bg-slate-900 rounded-2xl border border-slate-800 divide-y divide-slate-800 overflow-hidden">
        {children}
      </div>
    </section>
  );
}

/** A row inside a grouped section */
function SectionRow({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-3">{children}</div>;
}

const inputCls = 'w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-500/20 transition-all';

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
      const loaded = await getAiConfig();
      if (!loaded.provider) {
        setCfg({ ...loaded, provider: loaded.apiKey ? 'openrouter' : 'deepseek' });
      } else {
        setCfg(loaded);
      }
      setDeviceId(await getDeviceId());
      reloadStats();
      const q = await getStorageQuota();
      setQuota(q);
    })();
  }, []);

  const effectiveProvider: AiProvider = cfg.provider ?? (cfg.apiKey ? 'openrouter' : 'deepseek');

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
    const key = effectiveProvider === 'deepseek' ? cfg.deepseekApiKey?.trim() : cfg.apiKey?.trim();
    if (!key) { setAiPingResult({ ok: false, error: '请先填写 API Key' }); return; }
    setAiPingState('pinging');
    setAiPingResult(null);
    const result = await pingProvider(effectiveProvider, key);
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
      <h1 className="text-2xl font-bold text-slate-100">设置</h1>

      {/* ── AI 助手 ─────────────────────────────────── */}
      <Section title="AI 助手">
        <SectionRow>
          <p className="text-xs text-slate-500 mb-3">
            Key 保存到本地 IndexedDB；保存时立即推送到本地服务器（需服务器在线），其它设备启动时拉取，更新时间最新者胜。
          </p>
          {/* AI on/off */}
          <div className="space-y-2 text-sm">
            {(['on','off'] as const).map(m => (
              <label key={m} className={`flex items-center justify-between px-3 py-2.5 rounded-xl border cursor-pointer transition-all ${
                cfg.mode === m
                  ? 'border-sky-500/60 bg-sky-900/20'
                  : 'border-slate-800 hover:border-slate-700'
              }`}>
                <span className="text-sm text-slate-200">
                  {m === 'on' && '启用 AI（语音输入 / 自然语言搜索）'}
                  {m === 'off' && '关闭 AI（仅手动管理）'}
                </span>
                <input
                  type="radio"
                  checked={cfg.mode === m}
                  onChange={() => setCfg({ ...cfg, mode: m })}
                  className="ml-2 accent-sky-400"
                />
              </label>
            ))}
          </div>
        </SectionRow>

        {cfg.mode === 'on' && (
          <>
            {/* Provider selector */}
            <SectionRow>
              <p className="text-xs text-slate-500 mb-2">AI 服务商</p>
              <div className="flex gap-2">
                {(['deepseek', 'openrouter'] as const).map(p => (
                  <label
                    key={p}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border cursor-pointer text-sm transition-all ${
                      effectiveProvider === p
                        ? 'border-sky-500/60 bg-sky-900/20 text-sky-300'
                        : 'border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <input type="radio" className="sr-only" checked={effectiveProvider === p} onChange={() => setCfg({ ...cfg, provider: p })} />
                    {p === 'deepseek' ? 'DeepSeek（推荐）' : 'OpenRouter'}
                  </label>
                ))}
              </div>
            </SectionRow>

            {/* DeepSeek fields */}
            {effectiveProvider === 'deepseek' && (
              <SectionRow>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1.5">
                      DeepSeek API Key{' '}
                      <a href="https://platform.deepseek.com" target="_blank" rel="noreferrer" className="text-sky-400 underline">申请 →</a>
                    </label>
                    <input type="password" value={cfg.deepseekApiKey ?? ''} onChange={(e) => setCfg({ ...cfg, deepseekApiKey: e.target.value })} placeholder="sk-..." className={`${inputCls} font-mono`} autoComplete="off" />
                    <p className="text-xs text-slate-500 mt-1.5">DeepSeek 不支持图像识别；如需 AI 拍照存档请切换到 OpenRouter。</p>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1.5">模型（默认 {DEFAULT_DEEPSEEK_MODEL}）</label>
                    <input value={cfg.model ?? ''} onChange={(e) => setCfg({ ...cfg, model: e.target.value })} placeholder={DEFAULT_DEEPSEEK_MODEL} className={inputCls} />
                  </div>
                </div>
              </SectionRow>
            )}

            {/* OpenRouter fields */}
            {effectiveProvider === 'openrouter' && (
              <SectionRow>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1.5">OpenRouter API Key</label>
                    <input type="password" value={cfg.apiKey ?? ''} onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })} placeholder="sk-or-v1-..." className={`${inputCls} font-mono`} autoComplete="off" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1.5">视觉模型（默认 {DEFAULT_MODEL}）</label>
                    <input value={cfg.model ?? ''} onChange={(e) => setCfg({ ...cfg, model: e.target.value })} placeholder={DEFAULT_MODEL} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1.5">语音转写模型（需支持 audio 输入，默认同上）</label>
                    <input value={cfg.transcribeModel ?? ''} onChange={(e) => setCfg({ ...cfg, transcribeModel: e.target.value })} placeholder={DEFAULT_TRANSCRIBE_MODEL} className={inputCls} />
                  </div>
                </div>
              </SectionRow>
            )}

            {/* Test connection */}
            <SectionRow>
              <div className="flex items-center gap-2">
                <button
                  onClick={pingAi}
                  disabled={aiPingState === 'pinging'}
                  className="px-3 py-2 rounded-xl border border-slate-800 text-sm text-slate-300 hover:border-sky-500/60 hover:text-slate-100 disabled:opacity-50 transition-all"
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
            </SectionRow>
          </>
        )}
      </Section>

      {/* ── 保存按钮（sticky bottom）────────────────── */}
      <div className="sticky bottom-0 pb-safe pt-3 bg-slate-950/95 backdrop-blur-sm border-t border-slate-800 -mx-4 px-4">
        <button
          onClick={save}
          className="w-full py-3.5 rounded-xl bg-sky-500 hover:bg-sky-400 active:scale-[0.98] text-white font-semibold text-base shadow-lg shadow-sky-500/20 transition-all"
        >
          保存设置
        </button>
        {savedAt && !saveError && <span className="block text-center text-xs text-emerald-400 mt-1.5">✓ 已保存</span>}
        {savedAt && saveError && (
          <span className="block text-xs text-rose-400 mt-1.5 text-center">
            已保存到本地，服务端推送失败：{saveError}
            {!saveError.includes('混合内容') && !saveError.includes('TLS') && (
              <span className="block mt-0.5 text-slate-500">（重新打开应用会重试；若持续失败请检查服务端是否在线）</span>
            )}
          </span>
        )}
      </div>

      {/* ── 本地服务器 ─────────────────────────────── */}
      <Section title="本地服务器">
        <SectionRow>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={ping} className="px-3 py-2 rounded-xl border border-slate-800 text-sm text-slate-300 hover:border-sky-500/60 hover:text-slate-100 transition-all">
              检测连通性
            </button>
            {serverOk === true && <span className="text-emerald-300 text-sm">● 在线</span>}
            {serverOk === false && <span className="text-rose-400 text-sm">● 离线</span>}
            <button
              onClick={() => syncOnce().then(r => alert(r ? `已同步 推 ${r.pushed} / 拉 ${r.pulled} / 冲突 ${r.conflicts}` : '服务器不可达'))}
              className="px-3 py-2 rounded-xl border border-slate-800 text-sm text-slate-300 hover:border-sky-500/60 hover:text-slate-100 transition-all"
            >
              立即同步
            </button>
          </div>
        </SectionRow>
      </Section>

      {/* ── 本机数据 ──────────────────────────────── */}
      <Section title="本机数据">
        <SectionRow>
          <p className="text-xs text-slate-500 mb-1">设备 ID</p>
          <p className="font-mono text-xs text-slate-300">{deviceId}</p>
        </SectionRow>
        <SectionRow>
          <p className="text-xs text-slate-500 mb-1">统计</p>
          <p className="text-xs text-slate-300">
            房间 {stats.rooms} · 区域 {stats.areas} · 物品 {stats.items} · 照片 {stats.photos} · 待同步 {stats.outbox}
          </p>
        </SectionRow>

        {/* Storage bar */}
        {quota !== 'unsupported' && quota !== null && (
          <SectionRow>
            <div className="space-y-1.5">
              <p className={`text-xs ${quota.pct > 80 ? 'text-rose-400 font-medium' : 'text-slate-400'}`}>
                本地存储 {quota.usageMB.toFixed(1)} MB / {quota.quotaMB.toFixed(0)} MB（{quota.pct}%）
                {quota.pct > 80 && ' ⚠️ 空间紧张'}
              </p>
              <div className="h-1.5 rounded-full bg-slate-800">
                <div
                  className={`h-full rounded-full transition-all ${quota.pct > 80 ? 'bg-rose-500' : quota.pct > 50 ? 'bg-amber-500' : 'bg-sky-500'}`}
                  style={{ width: `${Math.min(quota.pct, 100)}%` }}
                />
              </div>
            </div>
          </SectionRow>
        )}

        <SectionRow>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={exportJson} className="px-3 py-2 rounded-xl border border-slate-800 text-sm text-slate-300 hover:border-sky-500/60 hover:text-slate-100 transition-all">
              导出 JSON 备份
            </button>
            <button
              onClick={runGc}
              disabled={gcRunning}
              className="px-3 py-2 rounded-xl border border-slate-800 text-sm text-slate-300 hover:border-sky-500/60 hover:text-slate-100 disabled:opacity-50 transition-all"
            >
              {gcRunning ? '清理中…' : '清理本地缓存'}
            </button>
            {gcResult !== null && (
              <span className="text-xs text-emerald-300">
                {gcResult > 0 ? `已释放 ${gcResult} 个已同步 blob` : '无可清理项'}
              </span>
            )}
          </div>
        </SectionRow>
      </Section>
    </div>
  );
}
