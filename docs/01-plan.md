# Keepsake — 项目规划

> 整套文档共三份：
> - `01-plan.md`（本文件）：项目背景、功能范围、架构、数据模型、同步协议
> - `02-implementation.md`：技术栈、目录结构、关键模块说明
> - `03-testing.md`：测试现状与 QA 流程

---

## 1. 项目背景

家里低频物品（消毒水、备用工具、季节性用品）半年或一年后常常忘记放在哪里。Keepsake 是一款运行在家庭局域网内的物品管理应用，核心目标是：

- **局域网浏览器访问**：家庭成员在局域网内通过浏览器访问 `https://<server-ip>:8443`，无需安装；
- **本地优先**：数据主要存储在本地 IndexedDB，服务器离线时仍可查询和编辑；
- **局域网同步**：多台设备通过家庭内网与服务器保持数据一致；
- **AI 文字解析**：用户用自然语言描述物品，AI 自动结构化为名称、数量、单位、备注。

---

## 2. 功能范围（已实现）

### 2.1 核心 CRUD

| 层级 | 功能 |
|---|---|
| **房间（Room）** | 创建、重命名、删除（含下属区域与物品软删除） |
| **区域（Area）** | 在房间下创建、重命名、删除 |
| **物品（Item）** | 在区域下添加、编辑（名称/数量/单位/备注/标签/过期日期）、删除；数量增减 |

### 2.2 AI 文字解析

用户在区域详情页输入自然语言描述（中文或英文），AI 将其解析为结构化物品列表：

- **replace 模式**：解析结果直接作为新物品列表；
- **merge 模式**：将现有物品列表传入上下文，AI 输出合并后的完整列表（保留未提及的旧物品）。

AI 调用方式：**客户端直连**，支持两个 provider：
- **DeepSeek**（`api.deepseek.com`）：用户填入自己的 DeepSeek API Key；
- **OpenRouter**（`openrouter.ai`）：用户填入自己的 OpenRouter API Key，可选任意兼容模型（默认 `google/gemini-2.5-flash-lite`）。

API Key 存储在本地 IndexedDB，同时通过 `/settings/ai` 同步到服务端，以便多设备共享同一配置。

AI 功能完全可选：未配置 Key 或关闭时，所有 CRUD 正常使用。

### 2.3 自然语言搜索

在搜索页输入自然语言问题，AI 从物品列表中找到相关物品并给出回答，同时标注被引用的物品 ID（用于高亮展示）。离线或未配置 AI 时，退化为关键词搜索。

### 2.4 同步

多设备通过局域网服务端同步，路由为 `/sync/pull`（GET）和 `/sync/push`（POST）。支持四种操作类型（详见第 4 节）。

同步触发时机：App 启动、进入前台、`online` 事件、用户手动触发。

### 2.5 自动备份

服务端在运行期间按配置周期自动备份 SQLite 数据库文件（`VACUUM INTO`），备份文件按日期命名，自动保留最近 N 份。

### 2.6 提醒

客户端在每次启动时扫描物品的 `expires_at` 字段，到期或临近到期时在 App 内显示提醒横幅。不依赖 Web Push，iOS / Android 均可使用。

### 2.7 国际化（i18n）

自手搓双语支持（中文 / 英文），`apps/pwa/src/i18n/` 目录下维护完整翻译字典。语言偏好存储在 IndexedDB，AI 的 system prompt 随语言设置同步切换。

### 2.8 字体

前端自托管 Noto Serif SC（400、700），woff2 格式，放置于 `apps/pwa/public/fonts/`，不依赖 Google Fonts CDN。

---

## 3. 架构总览

```
┌─────────────────────────────────┐         ┌──────────────────────────────┐
│      浏览器（iOS / Android）     │         │  Local Server（PC/Mac）       │
│  React 18 + Vite 5 + TS         │  HTTPS  │  Fastify + better-sqlite3    │
│  Dexie（IndexedDB）              │ ◄─────► │  /sync/pull  /sync/push      │
│  自手搓 i18n                     │  LAN    │  /blobs  /settings/ai        │
│                                 │         │  SQLite 自动备份              │
└─────────────────────────────────┘         └──────────────────────────────┘
                │
                │ 客户端直连
                ▼
       ┌──────────────────┐
       │  DeepSeek API    │
       │  OpenRouter API  │
       └──────────────────┘
```

关键特征：

- AI 调用完全在**客户端侧**发起，API Key 存于浏览器本地，不经过家庭服务器；
- 服务端仅负责同步、备份、静态文件托管；
- 不涉及用户注册、JWT 鉴权，单家庭单服务器。

---

## 4. 数据模型

所有表共用同步元数据字段：`id (uuid)`、`updated_at (ms 时间戳)`、`updated_by (deviceId)`、`deleted (0/1)`、`version (int)`。

```
Room          房间（厨房 / 客厅 / 阳台 …）
  id, name, icon?, note?

Area          区域（洗手台柜子 / 电视柜 …）
  id, room_id, name, note?

Item          物品（挂在 Area 下）
  id, area_id, name, qty, unit?,
  tags[], expires_at?, notes?

Photo         图片元数据
  id, parent_type:'room'|'area'|'item', parent_id,
  blob_ref（本地 IDB key）, remote_url?
```

层级：**Room → Area → Item**（固定两级，不做无限树）。

---

## 5. 同步协议

双端点：
- `GET /sync/pull?since=<ts>` — 拉取服务端 `updated_at > since` 的所有变更；
- `POST /sync/push` — 推送本地 outbox 中的操作批次，返回 `{ accepted, conflicts }`。

四种操作类型（`packages/shared/src/sync-protocol.ts`）：

| op | 说明 |
|---|---|
| `upsert` | 完整行写入（新增或覆盖），字段级 LWW |
| `delete` | 软删除，`deleted=1`，删除永远优先于编辑 |
| `qty_delta` | 数量增量合并（如 A 端 +2、B 端 -1，最终 +1），避免并发覆盖 |
| `patch` | 字段级 LWW 补丁，仅修改指定字段；按 `base_version` 检测冲突 |

冲突处理：冲突记录写入 `conflict_log` 表，客户端在下次 pull 后通过 UI 横幅（ConflictBanner）展示，支持"全部保留本地"或"全部采用云端"。

---

## 6. 环境变量（服务端）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8443` | 监听端口 |
| `KEEPSAKE_DB` | `./data/keepsake.sqlite` | 数据库文件路径 |
| `KEEPSAKE_TLS` | 未设置 | 设为 `1` 启用 HTTPS（需配合 mkcert 证书） |
| `KEEPSAKE_TLS_CERT` | `apps/server/certs/dev-cert.pem` | 自定义证书路径 |
| `KEEPSAKE_TLS_KEY` | `apps/server/certs/dev-key.pem` | 自定义私钥路径 |
| `KEEPSAKE_BACKUP_INTERVAL_DAYS` | `7` | 自动备份间隔天数 |
| `KEEPSAKE_BACKUP_KEEP` | `4` | 保留备份份数 |
| `KEEPSAKE_ALLOW_LOCALHOST` | 未设置 | 设为 `1` 允许 localhost 访问 SPA（开发用） |
| `LOG_LEVEL` | `info` | Fastify 日志级别 |
