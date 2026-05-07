import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AreaRepo, ItemRepo } from '../db/repos.js';
import type { Area } from '@keepsake/shared';
import { transcribe, parseVoiceText, getAiConfig, type RecognitionItem } from '../ai/router.js';

interface Draft extends RecognitionItem { selected: boolean; }

/** Area 加载三态 */
type AreaState = 'loading' | 'not-found' | 'ok';

export function VoicePage() {
  const { areaId = '' } = useParams();
  const nav = useNavigate();
  const [areaState, setAreaState] = useState<AreaState>('loading');
  const [area, setArea] = useState<Area | undefined>();
  const [recording, setRecording] = useState(false);
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  useEffect(() => {
    if (!areaId) { setAreaState('not-found'); return; }
    (async () => {
      const a = await AreaRepo.get(areaId);
      if (a) { setArea(a); setAreaState('ok'); }
      else { setAreaState('not-found'); }
    })();
  }, [areaId]);

  // 组件卸载时释放麦克风 stream，确保指示灯熄灭
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      recRef.current = null;
    };
  }, []);

  /** 将 getUserMedia 的错误名转换为友好中文提示 */
  function friendlyMicError(e: unknown): string {
    const name = (e as { name?: string })?.name ?? '';
    if (e instanceof TypeError || name === 'TypeError') {
      return '当前环境不支持录音（需要 HTTPS 或 localhost），无法访问麦克风。';
    }
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      return '麦克风权限被拒绝，请在浏览器设置中允许访问麦克风后重试。';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return '未检测到麦克风设备，请确认设备已连接。';
    }
    if (name === 'NotSupportedError' || name === 'SecurityError') {
      return '当前环境不支持录音（需要 HTTPS 或 localhost）。';
    }
    return `无法访问麦克风：${(e as { message?: string })?.message ?? String(e)}`;
  }

  const start = async () => {
    setErr(null);
    // 非 HTTPS / 非 localhost 时浏览器不暴露 mediaDevices，提前检测给出友好提示（fixes #41）
    if (!navigator.mediaDevices?.getUserMedia) {
      setErr('当前环境不支持录音（需要 HTTPS 或 localhost），无法访问麦克风。');
      return;
    }
    const cfg = await getAiConfig();
    if (cfg.mode !== 'on' || !cfg.apiKey) {
      setErr('AI 未启用。请先到「设置」配置 OpenRouter Key，或直接打字录入。');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        // 停止录音后立即释放 stream tracks
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        const audio = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' });
        try {
          setBusy(true);
          const { text: t } = await transcribe(audio);
          setText(t);
          if (t.trim()) {
            const items = await parseVoiceText(t);
            setDrafts(items.map(it => ({ ...it, selected: true })));
          }
        } catch (e: any) { setErr(e?.message ?? String(e)); }
        finally { setBusy(false); }
      };
      mr.start();
      recRef.current = mr;
      setRecording(true);
    } catch (e: unknown) { setErr(friendlyMicError(e)); }
  };

  const stop = () => {
    recRef.current?.stop();
    recRef.current = null;
    setRecording(false);
  };

  const reparse = async () => {
    setErr(null); setBusy(true);
    try {
      const items = await parseVoiceText(text);
      setDrafts(items.map(it => ({ ...it, selected: true })));
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  const save = async () => {
    // 保存前再次校验 area 仍存在，防止孤儿物品
    if (!areaId) {
      setErr('区域 ID 为空，无法保存。');
      return;
    }
    const current = await AreaRepo.get(areaId);
    if (!current) {
      setErr('该区域已不存在，无法保存物品。请返回首页重新选择区域。');
      setAreaState('not-found');
      return;
    }
    setBusy(true);
    try {
      for (const d of drafts.filter(d => d.selected && d.name.trim())) {
        await ItemRepo.create({
          area_id: areaId,
          name: d.name.trim(),
          qty: d.qty || 1,
          source: 'voice',
          confidence: d.confidence,
        });
      }
      nav(`/areas/${areaId}`);
    } finally { setBusy(false); }
  };

  if (areaState === 'loading') return <p className="text-slate-400">加载中…</p>;
  if (areaState === 'not-found') {
    return (
      <div className="space-y-3">
        <p className="text-rose-300">⚠️ 找不到该区域（可能已被删除）。</p>
        <Link to="/" className="text-sky-400 hover:text-sky-300 text-sm">← 返回首页</Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-slate-400">
        <Link to={`/areas/${areaId}`} className="hover:text-white">← 返回 {area!.name}</Link>
      </div>
      <h1 className="text-xl font-semibold">🎤 语音输入 · {area!.name}</h1>

      <div className="flex gap-2">
        {!recording ? (
          <button
            onClick={start}
            disabled={busy}
            className="flex-1 px-4 py-3 rounded-xl bg-sky-500 text-slate-950 font-medium disabled:opacity-50"
          >
            {busy ? '处理中…' : '🎤 开始录音'}
          </button>
        ) : (
          <button
            onClick={stop}
            className="flex-1 px-4 py-3 rounded-xl bg-rose-500 text-slate-950 font-medium"
          >
            ⏹ 停止录音
          </button>
        )}
      </div>

      {err && <p className="text-rose-300 text-sm">{err}</p>}

      <section className="space-y-2">
        <label className="text-xs text-slate-400">识别结果（可手动编辑后重新解析）</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="例如：在洗手台柜子里放了两瓶消毒水和一盒抽纸"
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2"
        />
        <button
          onClick={reparse}
          disabled={busy || !text.trim()}
          className="px-3 py-2 rounded-lg border border-slate-700 disabled:opacity-50"
        >
          重新解析
        </button>
      </section>

      {drafts.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-300">草稿（请核对）</h2>
          <ul className="space-y-2">
            {drafts.map((d, i) => (
              <li key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700">
                <input
                  type="checkbox"
                  checked={d.selected}
                  onChange={(e) => setDrafts(arr => arr.map((x, j) => j === i ? { ...x, selected: e.target.checked } : x))}
                />
                <input
                  value={d.name}
                  onChange={(e) => setDrafts(arr => arr.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                  className="flex-1 bg-transparent outline-none"
                />
                <input
                  type="number"
                  value={d.qty}
                  min={0}
                  onChange={(e) => setDrafts(arr => arr.map((x, j) => j === i ? { ...x, qty: Number(e.target.value) } : x))}
                  className="w-16 bg-slate-900 border border-slate-700 rounded px-2 py-1"
                />
              </li>
            ))}
          </ul>
          <button
            onClick={() => setDrafts(d => [...d, { name: '', qty: 1, selected: true }])}
            className="text-sm text-sky-300 hover:text-sky-200"
          >
            + 手动追加一项
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="w-full px-4 py-3 rounded-xl bg-amber-400 text-slate-950 font-medium disabled:opacity-50"
          >
            {busy ? '保存中…' : '锁定存档'}
          </button>
        </section>
      )}
    </div>
  );
}
