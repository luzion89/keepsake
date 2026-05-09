import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './app/router.js';
import { startSyncDaemon } from './sync/client.js';
import { initFetchInterceptor } from './app/fetchInterceptor.js';
import './index.css';

// 纸张颗粒：读取用户偏好
if (localStorage.getItem('noise_disabled') === '1') {
  document.documentElement.style.setProperty('--noise-opacity', '0');
}

// Spike-A: init auth fetch interceptor (loads token from IDB, injects Bearer header)
initFetchInterceptor().then(() => {
  startSyncDaemon();

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <RouterProvider router={router} />
    </React.StrictMode>,
  );
});
