import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@keepsake/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Keepsake',
        short_name: 'Keepsake',
        description: 'Family storage memory — 家庭物品管理',
        // #123: 与 index.html theme-color 保持一致（暖白 Editorial 主题）
        theme_color: '#F1EDE6',
        background_color: '#F1EDE6',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        lang: 'zh-CN',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // maskable icon 用于 Android 自适应图标（safe zone 40% padding）
          { src: 'icons/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Chrome 安装横幅需要 screenshots（至少 1 张）
        screenshots: [
          {
            src: 'screenshots/home-375.png',
            sizes: '375x812',
            type: 'image/png',
            form_factor: 'narrow',
            label: '物品管理首页',
          },
          {
            src: 'screenshots/home-1280.png',
            sizes: '1280x800',
            type: 'image/png',
            form_factor: 'wide',
            label: '物品管理首页（宽屏）',
          },
        ],
      },
      workbox: {
        // 确保 SW 有 fetch handler（installability 准入条件）
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/blobs/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'blobs',
              expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 3600 },
            },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/sync/'),
            handler: 'NetworkFirst',
            options: { cacheName: 'sync-api', networkTimeoutSeconds: 5 },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/sync': 'http://localhost:8443',
      '/blobs': 'http://localhost:8443',
      '/ai': 'http://localhost:8443',
      '/settings/ai': 'http://localhost:8443',
      '/health': 'http://localhost:8443',
      '/logs': 'http://localhost:8443',
    },
  },
  build: { target: 'es2022' },
  test: { environment: 'jsdom', exclude: ['e2e/**', 'node_modules/**'] },
});
