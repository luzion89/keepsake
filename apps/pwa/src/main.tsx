// 曾使用 vite-plugin-pwa + Workbox 实现可安装 PWA，现已移除 SW/manifest 注入。
// 此段在用户下次访问时清掉残留的旧 Service Worker，可在 2026-Q3 后删除。
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './app/router.js';
import { startSyncDaemon } from './sync/client.js';
import { I18nProvider } from './i18n/I18nContext.js';
import './index.css';

// 纸张颗粒：读取用户偏好
if (localStorage.getItem('noise_disabled') === '1') {
  document.documentElement.style.setProperty('--noise-opacity', '0');
}

startSyncDaemon();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <RouterProvider router={router} />
    </I18nProvider>
  </React.StrictMode>,
);
