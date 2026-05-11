# Keepsake — 技术实现

> 配套：`01-plan.md`（项目规划）、`03-testing.md`（测试）。

---

## 1. 技术栈

### 前端（`apps/pwa`）

| 模块 | 选型 |
|---|---|
| 框架 | React 18 + TypeScript |
| 构建 | Vite 5 |
| 样式 | Tailwind CSS 3 |
| 本地存储 | Dexie 4（IndexedDB 封装） |
| 路由 | react-router-dom 6 |
| 图标 | lucide-react |
| 图片压缩 | browser-image-compression |
| i18n | 自手搓（`apps/pwa/src/i18n/`，无第三方库） |
| 字体 | 自托管 Noto Serif SC 400/700 woff2 |

### 后端（`apps/server`）

| 模块 | 选型 |
|---|---|
| 服务框架 | Fastify 5 |
| 数据库 | better-sqlite3（单文件 SQLite） |
| Schema 校验 | zod |
| 静态文件 | @fastify/static（托管前端构建产物） |

### 共享（`packages/shared`）

zod schema + TypeScript 类型：`types.ts`（数据模型）、`sync-protocol.ts`（同步报文）、`merge-rules.ts`（合并逻辑）。

### 工具链

pnpm 9 monorepo，TypeScript 5，vitest 2。

---

## 2. 目录结构

```
Keepsake/
├── apps/
│   ├── pwa/
│   │   ├── public/
│   │   │   ├── fonts/                    # 自托管 Noto Serif SC woff2
│   │   │   │   ├── noto-serif-sc-400.woff2
│   │   │   │   └── noto-serif-sc-700.woff2
│   │   │   └── icons/                    # 应用图标（192、512、maskable）
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── app/                      # 路由配置
│   │   │   ├── pages/                    # Home, Room, Area, Search, Settings …
│   │   │   ├── components/               # 通用 UI 组件
│   │   │   ├── db/
│   │   │   │   ├── dexie.ts              # IDB schema + 初始化 + kvGet/kvSet
│   │   │   │   └── repos.ts              # room-repo, area-repo, item-repo, photo-repo
│   │   │   ├── sync/
│   │   │   │   ├── client.ts             # syncOnce：pull → applyRemote → push
│   │   │   │   ├── blobs.ts              # 图片上传 / 下载
│   │   │   │   └── useServerStatus.ts    # 服务器在线状态 hook
│   │   │   ├── ai/
│   │   │   │   └── router.ts             # AI 配置读写、parseItemsFromText、searchAnswer
│   │   │   ├── i18n/
│   │   │   │   ├── dict.ts               # 中英双语翻译字典
│   │   │   │   └── I18nContext.tsx        # I18nProvider + useT() hook
│   │   │   ├── notifications/
│   │   │   │   └── scanner.ts            # 启动时扫描 expires_at 提醒
│   │   │   ├── pwa/
│   │   │   │   └── useInstallPrompt.ts   # 安装提示 hook（已弃用，保留备查）
│   │   │   ├── logging/
│   │   │   │   └── logger.ts
│   │   │   └── index.css
│   │   ├── index.html
│   │   └── vite.config.ts
│   └── server/
│       └── src/
│           ├── index.ts                  # Fastify bootstrap + localhost 屏蔽 + 备份启动
│           ├── backup.ts                 # SQLite VACUUM INTO 自动备份
│           ├── db/
│           │   ├── schema.sql
│           │   ├── migrate.ts
│           │   ├── open.ts
│           │   └── queries.ts            # changesSince, mergeUpsert, deleteRow …
│           └── routes/
│               ├── sync.ts               # GET /sync/pull, POST /sync/push
│               ├── blobs.ts              # POST /blobs, GET /blobs/:id
│               ├── ai.ts                 # GET/PUT /settings/ai
│               ├── health.ts
│               └── logs.ts
├── packages/
│   └── shared/
│       └── src/
│           ├── types.ts                  # Zod schema：Room, Area, Item, Photo, TableName
│           ├── sync-protocol.ts          # Op / PullResp / PushReq / PushResp
│           ├── merge-rules.ts            # 合并逻辑（前后端复用）
│           └── index.ts
├── docs/
├── pnpm-workspace.yaml
└── package.json
```

---

## 3. 关键模块说明

### 3.1 AI Router（`apps/pwa/src/ai/router.ts`）

客户端直连 AI，不经过服务端代理。支持两个 provider：

- **deepseek**：直连 `https://api.deepseek.com/v1/chat/completions`，默认模型 `deepseek-chat`；
- **openrouter**：直连 `https://openrouter.ai/api/v1/chat/completions`，默认模型 `google/gemini-2.5-flash-lite`。

主要导出：

```ts
// 从 IndexedDB 读写 AI 配置（mode: 'on'|'off', provider, apiKey/deepseekApiKey, model）
getAiConfig() / setAiConfig(cfg)

// 启动时从服务端拉取配置，按 updated_at LWW 与本地合并
pullAiConfigFromServer()

// 解析自然语言文本为结构化物品列表
// mode='replace'：忽略现有物品；mode='merge'：将现有物品作为上下文传给 AI
parseItemsFromText(text, existingItems?, mode?)

// 自然语言搜索：返回回答文本 + 被引用的物品 ID 列表
searchAnswer(query, contextItems)

// 验证 API Key 是否有效（调用 models 端点，不消耗 token）
pingProvider(provider, apiKey)
```

AI 配置通过 `PUT /settings/ai` 同步到服务端，其他设备启动时通过 `GET /settings/ai` 拉取。

### 3.2 同步（4 种 op）

`packages/shared/src/sync-protocol.ts` 定义报文类型；`apps/server/src/routes/sync.ts` 实现服务端逻辑。

**推送流程**（POST `/sync/push`）：

服务端对 ops 逐条处理（在单个 SQLite 事务内）：

- `upsert`：调用 `mergeUpsert`，执行字段级 LWW，冲突记录写 `conflict_log`；
- `delete`：调用 `deleteRow`，以 `updated_at` 时间戳判断是否允许删除（删除胜过编辑）；
- `qty_delta`：读取当前行，`qty += delta`，更新 `updated_at` 和 `version`，再 `mergeUpsert`；
- `patch`：读取当前行，将 `op.fields` 覆盖到现有行，合并后 `mergeUpsert`；若行不存在则跳过（upsert 应先于 patch 到达）。

返回 `{ serverTime, accepted: string[], conflicts: Conflict[] }`。

**拉取流程**（GET `/sync/pull?since=<ts>`）：

返回所有 `updated_at > since` 的行（含已删除行），客户端按 `mergeRules` 应用到本地 Dexie。

### 3.3 国际化（i18n）

`apps/pwa/src/i18n/dict.ts`：中英双语翻译字典，`Key` 类型覆盖所有 UI 字符串。

`apps/pwa/src/i18n/I18nContext.tsx`：
- `I18nProvider`：读取 IndexedDB 中的语言偏好（`'zh'` 或 `'en'`），初始化 `lang` 状态；
- `useT()`：返回 `{ lang, t(key, vars?), setLang }`；
- `getCurrentLang()`：模块级函数，供非 React 代码（`ai/router.ts`）读取当前语言，使 AI system prompt 随 UI 语言切换。

### 3.4 备份（`apps/server/src/backup.ts`）

使用 SQLite `VACUUM INTO` 热备份（无需停服，原子写入）：

- 备份文件命名：`keepsake-YYYY-MM-DD.sqlite`，存放于 `<dbDir>/backups/`；
- 每次启动检查距上次备份是否已超过 `intervalMs`，超过则立即执行；
- `setInterval` 定时备份，Node.js `timer.unref()` 不阻止进程退出；
- 执行后自动删除超出 `keep` 数量的最旧备份。

配置通过环境变量 `KEEPSAKE_BACKUP_INTERVAL_DAYS`（默认 7）和 `KEEPSAKE_BACKUP_KEEP`（默认 4）控制。

### 3.5 localhost 屏蔽（`apps/server/src/index.ts`）

服务端在 `onRequest` hook 中检查 `Host` 头：

- 若请求来自 `localhost` 或 `127.0.0.1`，且为 SPA HTML 请求（`GET`，`Accept: text/html` 或路径不含 `.`）；
- 则返回 HTTP 410，提示用户改用 LAN IP（如 `https://192.168.x.x:8443`）；
- API 路径（`/sync`、`/blobs`、`/ai`、`/health`、`/logs`、`/settings`）不受屏蔽，确保 Vite 开发代理正常工作；
- `KEEPSAKE_ALLOW_LOCALHOST=1` 可跳过屏蔽（开发调试用）。

此设计保证 IndexedDB 始终注册在 LAN IP origin 下，避免 `localhost` 与 LAN IP 产生两套独立的 IDB 数据。

### 3.6 字体

`apps/pwa/public/fonts/` 下存放 `noto-serif-sc-400.woff2` 和 `noto-serif-sc-700.woff2`，在 `src/index.css` 中通过 `@font-face` 引入，不依赖外部 CDN，离线可用。

---

## 4. 开发与部署

```bash
# 初始化
pnpm install
pnpm -C apps/server run db:migrate

# 开发（同时启动 pwa:5173 + server:8443）
pnpm dev

# 生产构建
pnpm build

# 生产运行（服务端托管前端静态资源）
pnpm start
# 或启用 HTTPS（需先生成 mkcert 证书，见 docs/HTTPS-SETUP.md）
KEEPSAKE_TLS=1 pnpm start
```

手机访问：打开服务端启动日志中显示的 LAN URL（如 `https://192.168.x.x:8443`），在浏览器地址栏直接访问即可。
