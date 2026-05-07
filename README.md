# Keepsake

家庭仓储管理 PWA：拍照 + 语音 + AI，跨设备离线优先。

详见 [`docs/`](./docs/)：
- `01-plan.md` — 项目规划（架构、技术栈、数据模型、同步协议）
- `02-implementation.md` — 代码实现大纲
- `03-testing.md` — 测试方案

## 项目结构

```
Keepsake/
├── apps/
│   ├── pwa/      # React + Vite + Dexie + Workbox
│   └── server/   # Fastify + better-sqlite3（同步、可选 AI 代理、PWA 静态）
└── packages/
    └── shared/   # 类型、同步协议、合并规则（前后端复用）
```

## 快速开始

```bash
pnpm install                       # 装依赖（含 better-sqlite3 原生编译，约 4 分钟）
pnpm build                         # 依次 build shared / pwa / server
pnpm -C apps/server db:migrate     # 初始化 SQLite（会自动建表）
pnpm start                         # node dist/index.js → :8443
```

打开 `http://localhost:8443` 即可使用。手机访问局域网 IP 时建议先用 mkcert / cloudflared 配 HTTPS（PWA SW 在非 localhost 域强制 HTTPS）。

### 开发模式

```bash
# 终端 A：构建并 watch shared
pnpm -C packages/shared build -w

# 终端 B：后端 hot-reload
pnpm -C apps/server dev

# 终端 C：前端 dev server (5173, 自动代理 /sync /blobs /ai 到 8443)
pnpm -C apps/pwa dev
```

### 测试

```bash
pnpm -C packages/shared test       # 合并规则单测（6 个用例）
pnpm -C apps/server test           # /sync pull/push、LWW 冲突、qty_delta（4 个用例）
```

## AI 调用模式

进入「设置」选择：

| 模式 | 说明 | 适用场景 |
|---|---|---|
| **客户端直连**（推荐） | 浏览器直接调 OpenAI / Gemini，Key 仅存本机 IndexedDB | 服务器经常关机；想用自己的 Key |
| 服务器代理 | 由家里的 Keepsake 服务器持有 Key | 全家共用一个 Key 配额 |
| 关闭 AI | 仅手动录入 | 完全离线场景 |

## 离线行为

- 所有 CRUD 先写 IndexedDB，并 append 到 outbox。
- 服务器在线时（每 60s 或 `online` 事件触发）自动 pull/push。
- 冲突按 LWW + 集合并集 + 软删除策略合并，败者写入 `conflict_log`，UI 顶部红字提示。

## 数据模型

`Room → Area → Item` 两级层级。例：`厨房 → 洗手台柜子 → 消毒水(×2)`。
