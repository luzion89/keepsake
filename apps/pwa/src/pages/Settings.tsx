import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Settings as SettingsIcon, X } from 'lucide-react';
import {
  getAiConfig, setAiConfig,
  DEFAULT_MODEL,
  DEFAULT_DEEPSEEK_MODEL,
  pingProvider,
  type AiConfig, type AiProvider,
} from '../ai/router.js';
import { db, getDeviceId } from '../db/dexie.js';
import { syncOnce, setServerUrl, getServerUrl } from '../sync/client.js';
import { ServerStatusBadge } from '../components/ServerStatusBadge.js';
import { gcSyncedBlobs } from '../sync/blobs.js';
import { useT } from '../i18n/I18nContext.js';

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
      <div className="h-12 bg-paper-dark rounded-[12px]" />
    </div>
  );
}

export function SettingsPage() {
  const { t, lang, setLang } = useT();
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  const [stats, setStats] = useState({ rooms: 0, areas: 0, items: 0, photos: 0, outbox: 0 });
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [aiPingState, setAiPingState] = useState<'idle' | 'pinging'>('idle');
  const [aiPingResult, setAiPingResult] = useState<{ ok: boolean; latencyMs?: number; error?: string } | null>(null);
  const [gcResult, setGcResult] = useState<number | null>(null);
  const [gcRunning, setGcRunning] = useState(false);
  const [quota, setQuota] = useState<StorageQuota | null | 'unsupported'>('unsupported');
  const [serverUrl, setServerUrlState] = useState('');
  const [serverSaved, setServerSaved] = useState(false);

  useEffect(() => { getServerUrl().then(u => setServerUrlState(u)); }, []);

  const saveServerUrl = async () => {
    await setServerUrl(serverUrl);
    setServerSaved(true);
    setTimeout(() => setServerSaved(false), 2000);
  };

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
      setSaveError(result.error ?? t('settings.unknownError'));
    }
  };

  const pingAi = async () => {
    if (!cfg) return;
    const key = effectiveProvider === 'deepseek' ? cfg.deepseekApiKey?.trim() : cfg.apiKey?.trim();
    if (!key) { setAiPingResult({ ok: false, error: t('settings.needApiKey') }); return; }
    setAiPingState('pinging');
    setAiPingResult(null);
    const result = await pingProvider(effectiveProvider, key);
    setAiPingState('idle');
    setAiPingResult(result);
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

  const btnCls = 'flex-1 min-w-0 px-2 py-2 rounded-[12px] border border-[var(--border-default)] text-sm text-ink hover:border-accent/60 hover:text-ink-hover transition-all whitespace-nowrap text-center';

  if (!loaded) return <SettingsSkeleton />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold font-serif text-ink flex items-center gap-2"><SettingsIcon size={22} strokeWidth={1.5} />{t('settings.title')}</h1>

      {/* ── Server status ─────────────────────────────────────── */}
      <ServerStatusBadge />

      {/* ── Language ──────────────────────────────────────────── */}
      <Section title={t('settings.langSection')}>
        <SectionRow>
          <div className="flex gap-2">
            {(['zh', 'en'] as const).map(l => (
              <label
                key={l}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-[12px] border cursor-pointer text-sm transition-all ${
                  lang === l
                    ? 'border-accent/60 bg-accent-light text-accent'
                    : 'border-[var(--border-default)] text-ink-muted hover:border-accent/30'
                }`}
              >
                <input type="radio" className="sr-only" checked={lang === l} onChange={() => setLang(l)} />
                {l === 'zh' ? t('settings.langZh') : t('settings.langEn')}
              </label>
            ))}
          </div>
        </SectionRow>
      </Section>

      {/* ── Server ──────────────────────────────────────────── */}
      <Section title="同步服务器（可选）">
        <SectionRow>
          <p className="text-xs text-ink-muted mb-2">填写 Keepsake Server 地址后可启用多设备同步。留空则使用纯离线模式。</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={serverUrl}
              onChange={e => setServerUrlState(e.target.value)}
              placeholder="例如 http://192.168.1.100:8443"
              className="flex-1 bg-paper-dark border border-[var(--border-default)] rounded-[12px] px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all placeholder:text-ink-muted"
            />
            <button onClick={saveServerUrl} className="px-3 py-2 rounded-[12px] bg-accent hover:bg-accent-hover text-paper text-sm font-medium transition-all">
              {serverSaved ? '已保存' : '保存'}
            </button>
          </div>
        </SectionRow>
      </Section>

      {/* ── AI assistant ──────────────────────────────────────── */}
      <Section title={t('settings.aiSection')}>
        <SectionRow>
          <p className="text-xs text-ink-muted mb-3">{t('settings.aiKeyHint')}</p>
          <div className="space-y-2 text-sm">
            {(['on','off'] as const).map(m => (
              <label key={m} className={`flex items-center justify-between px-3 py-2.5 rounded-[12px] border cursor-pointer transition-all ${
                cfg!.mode === m
                  ? 'border-accent/60 bg-accent-light text-accent'
                  : 'border-[var(--border-default)] hover:border-accent/30'
              }`}>
                <span className="text-sm text-ink">
                  {m === 'on' && t('settings.aiOn')}
                  {m === 'off' && t('settings.aiOff')}
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
              <p className="text-xs text-ink-muted mb-2">{t('settings.aiProvider')}</p>
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
                    {p === 'deepseek' ? t('settings.deepseekRecommended') : 'OpenRouter'}
                  </label>
                ))}
              </div>
            </SectionRow>

            {effectiveProvider === 'deepseek' && (
              <SectionRow>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-ink-muted mb-1.5">
                      {t('settings.deepseekKeyLabel')}{' '}
                      <a href="https://platform.deepseek.com" target="_blank" rel="noreferrer" className="text-accent underline hover:text-accent-hover">{t('settings.deepseekApply')}</a>
                    </label>
                    <input type="password" value={cfg!.deepseekApiKey ?? ''} onChange={(e) => setCfg({ ...cfg!, deepseekApiKey: e.target.value })} placeholder="sk-..." className={`${inputCls} font-mono`} autoComplete="off" />
                    <p className="text-xs text-ink-muted mt-1.5">{t('settings.deepseekNoVision')}</p>
                  </div>
                  <div>
                    <label className="block text-xs text-ink-muted mb-1.5">{t('settings.modelLabel', { model: DEFAULT_DEEPSEEK_MODEL })}</label>
                    <input value={cfg!.model ?? ''} onChange={(e) => setCfg({ ...cfg!, model: e.target.value })} placeholder={DEFAULT_DEEPSEEK_MODEL} className={inputCls} />
                  </div>
                </div>
              </SectionRow>
            )}

            {effectiveProvider === 'openrouter' && (
              <SectionRow>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-ink-muted mb-1.5">{t('settings.openrouterKeyLabel')}</label>
                    <input type="password" value={cfg!.apiKey ?? ''} onChange={(e) => setCfg({ ...cfg!, apiKey: e.target.value })} placeholder="sk-or-v1-..." className={`${inputCls} font-mono`} autoComplete="off" />
                  </div>
                  <div>
                    <label className="block text-xs text-ink-muted mb-1.5">{t('settings.visionModelLabel', { model: DEFAULT_MODEL })}</label>
                    <input
                      value={cfg!.model === DEFAULT_DEEPSEEK_MODEL ? '' : (cfg!.model ?? '')}
                      onChange={(e) => setCfg({ ...cfg!, model: e.target.value })}
                      placeholder={DEFAULT_MODEL}
                      className={inputCls}
                    />
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
                  {aiPingState === 'pinging' ? t('settings.testing') : t('settings.testBtn')}
                </button>
                {aiPingResult?.ok === true && (
                  <span className="text-ok-text text-xs flex items-center gap-1">
                    <Check size={12} strokeWidth={2} />
                    {t('settings.testOk', { ms: String(aiPingResult.latencyMs) })}
                  </span>
                )}
                {aiPingResult?.ok === false && (
                  <span className="text-danger-text text-xs flex items-center gap-1"><X size={12} strokeWidth={2} />{t('settings.testFail', { error: aiPingResult.error ?? '' })}</span>
                )}
              </div>
            </SectionRow>
          </>
        )}
      </Section>

      {/* ── Local data ────────────────────────────────────────── */}
      <Section title={t('settings.dataSection')}>
        <SectionRow>
          <p className="text-xs text-ink-muted mb-1">{t('settings.deviceId')}</p>
          <p className="font-mono text-xs text-ink">{deviceId}</p>
        </SectionRow>
        <SectionRow>
          <p className="text-xs text-ink-muted mb-1">{t('settings.stats')}</p>
          <p className="text-xs text-ink">
            {t('settings.statsValue', {
              rooms: stats.rooms,
              areas: stats.areas,
              items: stats.items,
              photos: stats.photos,
              outbox: stats.outbox,
            })}
          </p>
        </SectionRow>

        {quota !== 'unsupported' && quota !== null && (
          <SectionRow>
            <div className="space-y-1.5">
              <p className={`text-xs flex items-center gap-1 ${quota.pct > 80 ? 'text-danger-text font-medium' : 'text-ink-muted'}`}>
                {t('settings.storageLabel', { usage: quota.usageMB.toFixed(1), quota: quota.quotaMB.toFixed(0), pct: String(quota.pct) })}
                {quota.pct > 80 && (
                  <>
                    {' '}
                    <AlertTriangle size={12} strokeWidth={1.5} className="shrink-0" />
                    {t('settings.storageTight')}
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
          <div className="flex items-center gap-2">
            <button onClick={exportJson} className={btnCls}>
              {t('settings.exportJson')}
            </button>
            <button
              onClick={runGc}
              disabled={gcRunning}
              className={btnCls + ' disabled:opacity-50'}
            >
              {gcRunning ? t('settings.gcRunning') : t('settings.gc')}
            </button>
            <button
              onClick={() => syncOnce().then(r => alert(r
                ? t('settings.syncResult', { pushed: String(r.pushed), pulled: String(r.pulled), conflicts: String(r.conflicts) })
                : t('settings.serverUnreachable')
              ))}
              className={btnCls}
            >
              {t('settings.syncOnce')}
            </button>
            {gcResult !== null && (
              <span className="text-xs text-ok-text">
                {gcResult > 0 ? t('settings.gcDone', { n: gcResult }) : t('settings.gcNone')}
              </span>
            )}
          </div>
        </SectionRow>
      </Section>

      {/* ── Save button ───────────────────────────────────────── */}
      <div className="pt-2 pb-6">
        <button
          onClick={save}
          className="w-full py-3.5 rounded-[12px] bg-accent hover:bg-accent-hover active:scale-[0.98] text-paper font-semibold text-base shadow-card transition-all"
        >
          {t('settings.saveBtn')}
        </button>
        {savedAt && !saveError && (
          <span className="flex items-center justify-center gap-1 text-xs text-ok-text mt-1.5">
            <Check size={12} strokeWidth={2} />
            {t('settings.saved')}
          </span>
        )}
        {savedAt && saveError && (
          <span className="block text-xs text-danger-text mt-1.5 text-center">
            {t('settings.saveErrorLocal', { error: saveError })}
            {!saveError.includes('混合内容') && !saveError.includes('TLS') && !saveError.includes('mixed content') && (
              <span className="block mt-0.5 text-ink-muted">{t('settings.saveErrorHint')}</span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
