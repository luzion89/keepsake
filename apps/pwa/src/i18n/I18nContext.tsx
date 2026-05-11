import React, { createContext, useContext, useEffect, useState } from 'react';
import { kvGet, kvSet } from '../db/dexie.js';
import { zh, en, type Key, type Lang } from './dict.js';

const KV_KEY = 'lang';

// ── module-level bridge for non-React code (router.ts) ─────────────────
let _currentLang: Lang = 'zh';

export function getCurrentLang(): Lang {
  return _currentLang;
}

export function setAiLang(lang: Lang): void {
  _currentLang = lang;
}

// ── t() helper ─────────────────────────────────────────────────────────
function translate(lang: Lang, key: Key, vars?: Record<string, string | number>): string {
  const dict = lang === 'en' ? en : zh;
  let str: string = (dict as Record<string, string>)[key] ?? (zh as Record<string, string>)[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return str;
}

// ── Context ─────────────────────────────────────────────────────────────
interface I18nContextValue {
  lang: Lang;
  t: (key: Key, vars?: Record<string, string | number>) => string;
  setLang: (lang: Lang) => void;
}

const I18nContext = createContext<I18nContextValue>({
  lang: 'zh',
  t: (key) => (zh as Record<string, string>)[key] ?? key,
  setLang: () => {},
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('zh');

  useEffect(() => {
    kvGet<Lang>(KV_KEY).then(stored => {
      const resolved: Lang = stored === 'en' ? 'en' : 'zh';
      setLangState(resolved);
      setAiLang(resolved);
      document.documentElement.lang = resolved === 'en' ? 'en' : 'zh-CN';
    });
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    setAiLang(l);
    kvSet(KV_KEY, l);
    document.documentElement.lang = l === 'en' ? 'en' : 'zh-CN';
  };

  const t = (key: Key, vars?: Record<string, string | number>) => translate(lang, key, vars);

  return (
    <I18nContext.Provider value={{ lang, t, setLang }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useT() {
  return useContext(I18nContext);
}
