import { useEffect, useState, useCallback } from 'react';
import { useInstallPrompt } from '../pwa/useInstallPrompt.js';
import { AlertTriangle, Check, Download, Settings as SettingsIcon, X } from 'lucide-react';
import {
  getAiConfig, setAiConfig,
  DEFAULT_MODEL, DEFAULT_TRANSCRIBE_MODEL,
  DEFAULT_DEEPSEEK_MODEL,
  pingProvider,
  type AiConfig, type AiProvider,
} from '../ai/router.js';
import { db, getDeviceId, kvGet, kvSet } from '../db/dexie.js';
import { syncOnce } from '../sync/client.js';
import { gcSyncedBlobs } from '../sync/blobs.js';

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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">{title}</h2>
      <div className="bg-paper-card rounded-[12px] border border-[var(--border-default)] divide-y divide-[var(--border-subtle)] overflow-hidden">
        {children}
      </div>
    </section>
  );
}

function SectionRow({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-3">{children}</div>;
}

const inputCls = 'w-full bg-paper-dark border border-[var(--border-default)] rounded-[12px] px-3 py-2.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all placeholder:text-ink-muted';

/**
 * #184 fix: SettingsSkeleton now includes a matching inline save button placeholder
 * to prevent any layout shift when real content loads.
 */
function SettingsSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-16 bg-paper-dark rounded-lg" />
      <div className="space-y-2">
        <div className="h-4 w-24 bg-paper-dark rounded" />
        <div className="rounded-[12px] bg-paper-card border border-[var(--border-default)] divide-y divide-[var(--border-subtle)] overflow-hidden">
          <div className="px-4 py-3 space-y-2">
            <div className="h-10 bg-paper-dark rounded-[12px]" />
            <div className="h-10 bg-paper-dark rounded-[12px]" />
          </div>
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-4 w-20 bg-paper-dark rounded" />
        <div className="rounded-[12px] bg-paper-card border border-[var(--border-default)] overflow-hidden">
          <div className="px-4 py-3">
            <div className="h-9 w-28 bg-paper-dark rounded-[12px]" />
          </div>
        </div>
      </div>
      {/* #184: inline save button placeholder — same height as real button */}
      <div className="h-12 bg-paper-dark rounded-[12px]" />
    </div>
  );
}

export function SettingsPage() {
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  const [loaded, setLoaded] = useState(false);
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
  // #202 / #134: PWA install prompt
  const { canInstall, isStandalone, promptInstall } = useInstallPrompt();
  const [installResult, setInstallResult] = useState<'accepted' | 'dismissed' | 'unavailable' | null>(null);

  const reloadStats = async () => setStats({
    rooms: await db.rooms.count(),
    areas: await db.areas.count(),
    items: await db.items.count(),
    photos: await db.photos.count(),
    outbox: await db.outbox.count(),
  });

  useEffect(() => {
    (async () => {
      const raw = await getAiConfig();
      if (!raw.provider) {
        setCfg({ ...raw, provider: raw.apiKey ? 'openrouter' : 'deepseek' });
      } else {
        setCfg(raw);
      }
      setDeviceId(await getDeviceId());
      await reloadStats();
      const q = await getStorageQuota();
      setQuota(q);
      setLoaded(true);
    })();
  }, []);

  const effectiveProvider: AiProvider = cfg?.provider ?? (cfg?.apiKey ? 'openrouter' : 'deepseek');

  const save = async () => {
    if (!cfg) return;
    const result = await setAiConfig(cfg);
    setSavedAt(Date.now());
    if (result.ok) {
      setSaveError(null);
    } else {
      setSaveError(result.error ?? '未知错误');
    }
  };

  const pingAi = async () => {
    if (!cfg) return;
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

  const btnCls = 'px-3 py-2 rounded-[12px] border border-[var(--border-default)] text-sm text-ink hover:border-accent/60 hover:text-ink-hover transition-all';

  // #184: Show skeleton until fully loaded — prevents any flash of sticky save button
  if (!loaded) return <SettingsSkeleton />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold font-serif text-ink flex items-center gap-2"><SettingsIcon size={22} strokeWidth={1.5} />设置</h1>

      {/* ── AI 助手 ─────────────────────────────────── */}
      <Section title="AI 助手">
        <SectionRow>
          <p className="text-xs text-ink-muted mb-3">
            Key 保存到本地 IndexedDB；保存时立即推送到本地服务器（需服务器在线），其它设备启动时拉取，更新时间最新者胜。
          </p>
          <div className="space-y-2 text-sm">
            {(['on','off'] as const).map(m => (
              <label key={m} className={`flex items-center justify-between px-3 py-2.5 rounded-[12px] border cursor-pointer transition-all ${
                cfg!.mode === m
                  ? 'border-accent/60 bg-accent-light text-accent'
                  : 'border-[var(--border-default)] hover:border-accent/30'
              }`}>
                <span className="text-sm text-ink">
                  {m === 'on' && '启用 AI（语音输入 / 自然语言搜索）'}
                  {m === 'off' && '关闭 AI（仅手动管理）'}
                </span>
                <input
                  type="radio"
                  checked={cfg!.mode === m}
                  onChange={() => setCfg({ ...cfg!, mode: m })}
                  className="ml-2 accent-[var(--color-accent)]"
                />
              </label>
            ))}
          </div>
        </SectionRow>

        {cfg?.mode === 'on' && (
          <>
            <SectionRow>
              <p className="text-xs text-ink-muted mb-2">AI 服务商</p>
              <div className="flex gap-2">
                {(['deepseek', 'openrouter'] as const).map(p => (
                  <label
                    key={p}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-[12px] border cursor-pointer text-sm transition-all ${
                      effectiveProvider === p
                        ? 'border-accent/60 bg-accent-light text-accent'
                        : 'border-[var(--border-default)] text-ink-muted hover:border-accent/30'
                    }`}
                  >
                    <input type="radio" className="sr-only" checked={effectiveProvider === p} onChange={() => setCfg({ ...cfg!, provider: p })} />
                    {p === 'deepseek' ? 'DeepSeek（推荐）' : 'OpenRouter'}
                  </label>
                ))}
              </div>
            </SectionRow>

            {effectiveProvider === 'deepseek' && (
              <SectionRow>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-ink-muted mb-1.5">
                      DeepSeek API Key{' '}
                      <a href="https://platform.deepseek.com" target="_blank" rel="noreferrer" className="text-accent underline hover:text-accent-hover">申请 →</a>
                    </label>
                    <input type="password" value={cfg!.deepseekApiKey ?? ''} onChange={(e) => setCfg({ ...cfg!, deepseekApiKey: e.target.value })} placeholder="sk-..." className={`${inputCls} font-mono`} autoComplete="off" />
                    <p className="text-xs text-ink-muted mt-1.5">DeepSeek 不支持图像识别；如需 AI 拍照存档请切换到 OpenRouter。</p>
                  </div>
                  <div>
                    <label className="block text-xs text-ink-muted mb-1.5">模型（默认 {DEFAULT_DEEPSEEK_MODEL}）</label>
                    <input value={cfg!.model ?? ''} onChange={(e) => setCfg({ ...cfg!, model: e.target.value })} placeholder={DEFAULT_DEEPSEEK_MODEL} className={inputCls} />
                  </div>
                </div>
              </SectionRow>
            )}

            {effectiveProvider === 'openrouter' && (
              <SectionRow>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-ink-muted mb-1.5">OpenRouter API Key</label>
                    <input type="password" value={cfg!.apiKey ?? ''} onChange={(e) => setCfg({ ...cfg!, apiKey: e.target.value })} placeholder="sk-or-v1-..." className={`${inputCls} font-mono`} autoComplete="off" />
                  </div>
                  <div>
                    <label className="block text-xs text-ink-muted mb-1.5">视觉模型（默认 {DEFAULT_MODEL}）</label>
                    <input
                      value={cfg!.model === DEFAULT_DEEPSEEK_MODEL ? '' : (cfg!.model ?? '')}
                      onChange={(e) => setCfg({ ...cfg!, model: e.target.value })}
                      placeholder={DEFAULT_MODEL}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-ink-muted mb-1.5">语音转写模型（需支持 audio 输入，默认同上）</label>
                    <input value={cfg!.transcribeModel ?? ''} onChange={(e) => setCfg({ ...cfg!, transcribeModel: e.target.value })} placeholder={DEFAULT_TRANSCRIBE_MODEL} className={inputCls} />
                  </div>
                </div>
              </SectionRow>
            )}

            <SectionRow>
              <div className="flex items-center gap-2">
                <button
                  onClick={pingAi}
                  disabled={aiPingState === 'pinging'}
                  className={btnCls + ' disabled:opacity-50'}
                >
                  {aiPingState === 'pinging' ? '测试中…' : '测试连通性'}
                </button>
                {aiPingResult?.ok === true && (
                  <span className="text-ok-text text-xs flex items-center gap-1">
                    <Check size={12} strokeWidth={2} />
                    连通（{aiPingResult.latencyMs} ms）
                  </span>
                )}
                {aiPingResult?.ok === false && (
                  <span className="text-danger-text text-xs flex items-center gap-1"><X size={12} strokeWidth={2} />失败：{aiPingResult.error}</span>
                )}
              </div>
            </SectionRow>
          </>
        )}
      </Section>

      {/* ── 本地服务器 ─────────────────────────────── */}
      <Section title="本地服务器">
        <SectionRow>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={ping} className={btnCls}>
              检测连通性
            </button>
            {serverOk === true && <span className="text-ok-text text-sm">● 在线</span>}
            {serverOk === false && <span className="text-danger-text text-sm">● 离线</span>}
            <button
              onClick={() => syncOnce().then(r => alert(r ? `已同步 推 ${r.pushed} / 拉 ${r.pulled} / 冲突 ${r.conflicts}` : '服务器不可达'))}
              className={btnCls}
            >
              立即同步
            </button>
          </div>
        </SectionRow>
      </Section>

      {/* ── 本机数据 ──────────────────────────────── */}
      <Section title="本机数据">
        <SectionRow>
          <p className="text-xs text-ink-muted mb-1">设备 ID</p>
          <p className="font-mono text-xs text-ink">{deviceId}</p>
        </SectionRow>
        <SectionRow>
          <p className="text-xs text-ink-muted mb-1">统计</p>
          <p className="text-xs text-ink">
            房间 {stats.rooms} · 区域 {stats.areas} · 物品 {stats.items} · 照片 {stats.photos} · 待同步 {stats.outbox}
          </p>
        </SectionRow>

        {quota !== 'unsupported' && quota !== null && (
          <SectionRow>
            <div className="space-y-1.5">
              <p className={`text-xs flex items-center gap-1 ${quota.pct > 80 ? 'text-danger-text font-medium' : 'text-ink-muted'}`}>
                本地存储 {quota.usageMB.toFixed(1)} MB / {quota.quotaMB.toFixed(0)} MB（{quota.pct}%）
                {quota.pct > 80 && (
                  <>
                    {' '}
                    <AlertTriangle size={12} strokeWidth={1.5} className="shrink-0" />
                    空间紧张
                  </>
                )}
              </p>
              <div className="h-1.5 rounded-full bg-paper-dark">
                <div
                  className={`h-full rounded-full transition-all ${quota.pct > 80 ? 'bg-danger' : quota.pct > 50 ? 'bg-warn' : 'bg-ok'}`}
                  style={{ width: `${Math.min(quota.pct, 100)}%` }}
                />
              </div>
            </div>
          </SectionRow>
        )}

        <SectionRow>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={exportJson} className={btnCls}>
              导出 JSON 备份
            </button>
            <button
              onClick={runGc}
              disabled={gcRunning}
              className={btnCls + ' disabled:opacity-50'}
            >
              {gcRunning ? '清理中…' : '清理本地缓存'}
            </button>
            {gcResult !== null && (
              <span className="text-xs text-ok-text">
                {gcResult > 0 ? `已释放 ${gcResult} 个已同步 blob` : '无可清理项'}
              </span>
            )}
          </div>
        </SectionRow>
      </Section>

      {/* ── #202 / #134: PWA 安装 ─────────────────────── */}
      <Section title="安装到设备">
        <SectionRow>
          {isStandalone ? (
            <p className="text-xs text-ok-text flex items-center gap-1.5">
              <Check size={13} strokeWidth={2} />
              已作为 PWA 安装运行
            </p>
          ) : canInstall ? (
            <div className="space-y-2">
              <p className="text-xs text-ink-muted">浏览器已准备好安装，点击下方按钮将 Keepsake 添加到主屏幕。</p>
              <button
                onClick={async () => {
                  const r = await promptInstall();
                  setInstallResult(r);
                }}
                className="flex items-center gap-2 px-4 py-2.5 rounded-[12px] bg-accent hover:bg-accent-hover active:scale-[0.98] text-paper font-medium text-sm shadow-card transition-all"
              >
                <Download size={15} strokeWidth={1.5} />
                安装到主屏幕
              </button>
              {installResult === 'dismissed' && (
                <p className="text-xs text-ink-muted">已取消。可稍后再试。</p>
              )}
              {installResult === 'accepted' && (
                <p className="text-xs text-ok-text flex items-center gap-1"><Check size={12} strokeWidth={2} />安装成功！</p>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-xs text-ink-muted">
                当前浏览器未触发安装提示。可能原因：
              </p>
              <ul className="text-xs text-ink-muted list-disc list-inside space-y-0.5">
                <li>已安装过（请在已安装的应用中使用）</li>
                <li>在 Safari 中：请使用「分享 → 添加到主屏幕」</li>
                <li>在 Chrome 中：地址栏右侧可能有安装图标</li>
                <li>需要在 HTTPS 或 localhost 环境下访问</li>
              </ul>
            </div>
          )}
        </SectionRow>
      </Section>


      {/* ── Spike-A: 我的设备 ─────────────────────────────── */}
      <DevicesSection />

      {/* ── #184 fix: 保存按钮改为 inline 正常文档流，不再 sticky ── */}
      <div className="pt-2 pb-6">
        <button
          onClick={save}
          className="w-full py-3.5 rounded-[12px] bg-accent hover:bg-accent-hover active:scale-[0.98] text-paper font-semibold text-base shadow-card transition-all"
        >
          保存设置
        </button>
        {savedAt && !saveError && (
          <span className="flex items-center justify-center gap-1 text-xs text-ok-text mt-1.5">
            <Check size={12} strokeWidth={2} />
            已保存
          </span>
        )}
        {savedAt && saveError && (
          <span className="block text-xs text-danger-text mt-1.5 text-center">
            已保存到本地，服务端推送失败：{saveError}
            {!saveError.includes('混合内容') && !saveError.includes('TLS') && (
              <span className="block mt-0.5 text-ink-muted">（重新打开应用会重试；若持续失败请检查服务端是否在线）</span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

// ── 设备配对：DevicesSection ────────────────────────────────────────────────

interface DeviceInfo {
  id: string;
  name: string;
  created_at: number;
  last_seen: number | null;
}

/** 清除认证相关 kv，不碰业务数据 */
async function clearAuthKv() {
  await db.kv.delete('device_token');
  await db.kv.delete('server_url');
  await db.kv.delete('family_id');
  await db.kv.delete('family_key');
  await db.kv.delete('family_key_salt');
  await db.kv.delete('root_secret_hint');
  // device_id 保留（业务用）
}

function InviteQrModal({
  serverUrl,
  onClose,
}: {
  serverUrl: string;
  onClose: () => void;
}) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [payload, setPayload] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [secsLeft, setSecsLeft] = useState<number>(300); // 5 min
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/auth/invite', { method: 'POST' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { invite_token, family_id } = await res.json();
        if (cancelled) return;
        const p = JSON.stringify({
          server: serverUrl || window.location.origin,
          invite_token,
          ...(family_id ? { family_id } : {}),
          v: 1,
        });
        setPayload(p);
        const url = await import('qrcode').then(m => m.toDataURL(p, { margin: 2, width: 260 }));
        if (!cancelled) setQrDataUrl(url);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [serverUrl]);

  // 5-minute countdown
  useEffect(() => {
    if (secsLeft <= 0) return;
    const t = setTimeout(() => setSecsLeft(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secsLeft]);

  const mins = String(Math.floor(secsLeft / 60)).padStart(1, '0');
  const secs = String(secsLeft % 60).padStart(2, '0');
  const expired = secsLeft <= 0;

  const copyPayload = async () => {
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-paper-card rounded-[16px] shadow-card w-full max-w-xs p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-base text-ink">邀请新设备</h3>
          <button onClick={onClose} className="text-ink-muted hover:text-ink transition-colors">
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        {loading && (
          <div className="flex justify-center py-8 text-ink-muted text-sm">生成二维码中…</div>
        )}

        {error && (
          <div className="text-danger-text text-sm bg-danger/10 rounded-[10px] px-3 py-2">{error}</div>
        )}

        {!loading && !error && (
          <>
            {expired ? (
              <div className="text-center py-4 text-ink-muted text-sm">
                <p className="text-danger-text font-medium mb-2">二维码已过期</p>
                <p>请关闭后重新点击「邀请新设备」生成</p>
              </div>
            ) : (
              <>
                <div className="flex justify-center">
                  {qrDataUrl && (
                    <img
                      src={qrDataUrl}
                      alt="邀请二维码"
                      className="rounded-[10px] border border-[var(--border-default)]"
                      style={{ width: 220, height: 220, objectFit: 'contain' }}
                    />
                  )}
                </div>
                <p className="text-center text-xs text-ink-muted">
                  剩余有效时间：<span className={`font-mono font-medium ${secsLeft < 60 ? 'text-danger-text' : 'text-ink'}`}>{mins}:{secs}</span>
                </p>
              </>
            )}

            <div className="space-y-2">
              <p className="text-xs text-ink-muted">或复制以下文本到另一台设备手动输入：</p>
              <div className="bg-paper-dark rounded-[10px] px-3 py-2 text-xs font-mono text-ink break-all leading-relaxed">
                {payload}
              </div>
              <button
                onClick={copyPayload}
                disabled={!payload}
                className="w-full py-2 rounded-[10px] border border-[var(--border-default)] text-sm text-ink hover:border-accent/60 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {copied ? <><Check size={13} strokeWidth={2} />已复制</> : '复制'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DevicesSection() {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string>('');
  const [familyId, setFamilyId] = useState<string>('');
  const [myDeviceId, setMyDeviceId] = useState<string>('');

  // 切换 server 确认弹窗
  const [showRepairConfirm, setShowRepairConfirm] = useState(false);
  // 邀请二维码弹窗
  const [showInviteQr, setShowInviteQr] = useState(false);

  useEffect(() => {
    kvGet<string>('server_url').then((u) => setServerUrl(u ?? ''));
    kvGet<string>('family_id').then((f) => setFamilyId(f ?? ''));
    getDeviceId().then((id) => setMyDeviceId(id));
    loadDevices();
  }, []);

  const loadDevices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/auth/devices');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDevices(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const revokeDevice = async (id: string) => {
    await fetch(`/auth/devices/${id}`, { method: 'DELETE' });
    loadDevices();
  };

  const doRepair = async () => {
    await clearAuthKv();
    window.location.href = '/pair';
  };

  const fmt = (ts: number | null) => ts ? new Date(ts).toLocaleDateString('zh-CN') : '未知';
  const shortId = (id: string) => id ? `${id.slice(0, 8)}…` : '—';

  return (
    <>
      {showInviteQr && (
        <InviteQrModal serverUrl={serverUrl} onClose={() => setShowInviteQr(false)} />
      )}

      {/* 重新配对确认弹窗 */}
      {showRepairConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowRepairConfirm(false); }}
        >
          <div className="bg-paper-card rounded-[16px] shadow-card w-full max-w-xs p-5 space-y-4">
            <div className="flex items-center gap-2 text-warn-text">
              <AlertTriangle size={18} strokeWidth={1.5} className="shrink-0" />
              <h3 className="font-semibold text-base text-ink">重新配对到其他 server？</h3>
            </div>
            <p className="text-sm text-ink-muted leading-relaxed">
              切换 server 后，本机数据将无法与新 server 同步，仅作为本地缓存保留。
              <br /><br />
              建议先在「本机数据」区域导出 JSON 备份。
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowRepairConfirm(false)}
                className="flex-1 py-2.5 rounded-[12px] border border-[var(--border-default)] text-sm text-ink hover:border-accent/60 transition-all"
              >
                取消
              </button>
              <button
                onClick={doRepair}
                className="flex-1 py-2.5 rounded-[12px] bg-danger hover:bg-danger/90 text-paper text-sm font-medium transition-all"
              >
                确认切换
              </button>
            </div>
          </div>
        </div>
      )}

      <Section title="设备配对">
        {/* 当前配对信息 */}
        <SectionRow>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-ink-muted w-20 shrink-0">Server</span>
              <span className="font-mono text-ink break-all">{serverUrl || '未配对'}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-ink-muted w-20 shrink-0">Family ID</span>
              <span className="font-mono text-ink">{familyId ? shortId(familyId) : '—'}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-ink-muted w-20 shrink-0">Device ID</span>
              <span className="font-mono text-ink">{myDeviceId ? shortId(myDeviceId) : '—'}</span>
            </div>
          </div>
        </SectionRow>

        {/* 操作按钮 */}
        <SectionRow>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setShowInviteQr(true)}
              className="px-3 py-2 rounded-[12px] border border-[var(--border-default)] text-sm text-ink hover:border-accent/60 hover:text-ink-hover transition-all"
            >
              邀请新设备
            </button>
            <button
              onClick={() => setShowRepairConfirm(true)}
              className="px-3 py-2 rounded-[12px] border border-danger/50 text-sm text-danger-text hover:bg-danger/5 transition-all"
            >
              重新配对到其他 server
            </button>
          </div>
        </SectionRow>

        {/* 设备列表 */}
        {loading && (
          <SectionRow>
            <p className="text-xs text-ink-muted">加载中…</p>
          </SectionRow>
        )}
        {error && (
          <SectionRow>
            <p className="text-xs text-danger-text">{error}</p>
          </SectionRow>
        )}
        {!loading && devices.map((d) => (
          <SectionRow key={d.id}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-ink">
                  {d.name}
                  {d.id === myDeviceId && (
                    <span className="ml-2 text-xs text-ok-text font-normal">（本机）</span>
                  )}
                </p>
                <p className="text-xs text-ink-muted">
                  注册 {fmt(d.created_at)} · 最近活跃 {fmt(d.last_seen)}
                </p>
              </div>
              {d.id !== myDeviceId && (
                <button
                  onClick={() => revokeDevice(d.id)}
                  className="text-xs text-danger-text hover:underline ml-4 shrink-0"
                >
                  撤销
                </button>
              )}
            </div>
          </SectionRow>
        ))}
      </Section>
    </>
  );
}

