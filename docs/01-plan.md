# Keepsake — 项目规划

> 家庭仓储管理 PWA。整套文档共三份：
> - `01-plan.md`（本文件）：背景、目标、架构、技术选型、数据模型、同步协议、里程碑
> - `02-implementation.md`：仓库结构、关键模块接口、依赖与部署
> - `03-testing.md`：测试矩阵、E2E、离线/同步、iOS 兼容、fuzz

---

## 1. Context（为什么做这件事）

家里收纳的低频物品（消毒水、备用工具、季节性用品）半年/一年后常常找不到。
经过与 AI 的讨论，已评估三种方案（拍照识别 / 语音输入 / NFC 标签），结论：
**拍照识别 + 语音/手动修正 + 人工终审** 是最务实的路线。

本项目要把它落地为：

- **PWA**：单一前端代码同时跑在 iOS 与 Android（Add to Home Screen），利用 Service Worker + IndexedDB 做 **offline-first**——服务器（家里 PC/Mac）经常关机，App 必须在完全离线时也能查询、添加、修改。
- **AI 调用优先在客户端**：PWA 直接持有用户填写的 API Key（存本地 IndexedDB，永不上传），
  在线时 **优先 浏览器 → 云厂商 API** 直连，减少对服务器的依赖；只有在用户显式开启「走服务器代理」
  且服务器在线时才转发到本地 server（用于团队共享 key 或绕过 CORS）。
- **本地 Web 服务器**：跑在家庭 PC / Mac，作用是：
  1. 跨设备同步与备份（核心）；
  2. **可选** AI 代理（保管共享 key、绕 CORS、做速率限制）；
  3. **可选** 异步识别队列（当客户端选了"先存草稿、稍后识别"时由服务器补做）。
- **多用户**：全家几口人共享，需要简单鉴权与冲突合并策略。

### 成功标准（MVP）

1. 任何设备在飞行模式下能完成「添加房间 → 房间下添加区域 → 区域里拍 3 张照 → 语音/手动添加 5 件物品 → 关键词搜出来」全流程；其中 AI 识别只要客户端能上网就直接调云厂商，**不依赖** Keepsake 服务器在线。
2. 服务器开机后，所有离线期间的变更能在 **30 秒内**完成双向同步且不丢数据；同字段被多端编辑时按确定策略合并、不静默覆盖。
3. iPhone Safari 16.4+ 添加到主屏后能保持 **>30 天** 不被系统清理（依赖 PWA 安装态而非普通页面）。

---

## 2. 架构总览

```
┌──────────────────────────┐         ┌──────────────────────────────┐
│   PWA (iOS / Android)    │         │  Local Server (PC/Mac)       │
│  ──────────────────────  │  HTTPS  │  ──────────────────────────  │
│  React + Vite + TS       │ ◄────► │  Fastify (Node 20) + SQLite  │
│  Workbox Service Worker  │  /sync  │  better-sqlite3              │
│  Dexie (IndexedDB)       │         │  AI Proxy (OpenAI/Gemini)    │
│  Web Speech API          │         │  Async Recognition Worker    │
│  getUserMedia (camera)   │         │  Static file (PWA build)     │
└──────────────────────────┘         └──────────────────────────────┘
                                              │
                                              ▼
                                     ┌──────────────────┐
                                     │ Cloud Multimodal │
                                     │ API (GPT-4o etc) │
                                     └──────────────────┘
```

---

## 3. 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 前端框架 | **Vite + React 18 + TypeScript** | PWA 模板成熟、生态广 |
| 样式 | Tailwind CSS + Radix UI | 移动端快速搭、可访问性好 |
| 本地存储 | **Dexie.js (IndexedDB 封装)** | 容量大、可索引；跨 iOS/Android 兼容 |
| Service Worker | **Workbox (vite-plugin-pwa)** | 自动生成 precache、运行时策略 |
| 状态 | Zustand + 自写同步层 | 轻量；同步层独立模块便于测试 |
| 摄像头 | `<input type="file" capture="environment">` 兜底 + `getUserMedia` | iOS Safari 对 getUserMedia 有限制，input 是稳妥兜底 |
| 语音 | Web Speech API (SpeechRecognition) | iOS 16+ 已支持；不支持时回退手动输入 |
| 图片压缩 | `browser-image-compression` | 客户端压到 ≤ 800 KB 再入库/上传 |
| 服务端 | **Node 20 + Fastify** | 启动快、TypeScript 友好、内置 schema 校验 |
| DB | **better-sqlite3**（单文件） | 便携、无后台进程、PC/Mac/NAS 通吃 |
| 文件存储 | 本地文件夹 `./uploads/{yyyy}/{mm}/{itemId}.jpg` | 一行代码备份 |
| 鉴权 | 家庭共享密码 → JWT (HS256, 7 天) + 每设备 `deviceId` | 不做注册流，足够家庭场景 |
| AI 调用 | **客户端优先**：浏览器直连 OpenAI / Gemini / Qwen-VL；用户在「设置」里填自己的 API Key（存在 IndexedDB，永不上传）。**服务器代理**：可选，用于共享 key / 绕 CORS / 速率限制。 | 服务器经常关机也不影响识别 |
| 同步协议 | 基于 `updated_at + deviceId` 的 **增量 pull/push**（详见 §5） | 可离线、可重放、足够简单 |
| 部署 | `pnpm build` → 服务端用 `@fastify/static` 直接托管 PWA | 双击即用 |
| HTTPS | mkcert 在局域网生成本地证书；或 Tailscale Funnel / cloudflared 隧道 | PWA Service Worker 强制 HTTPS（localhost 例外） |

---

## 4. 数据模型

所有表共用同步元数据：`id (uuid)`、`updated_at (ms)`、`updated_by (deviceId)`、`deleted (bool)`、`version (int)`。

```ts
Room {                // 第一层：房间（厨房 / 客厅 / 阳台 / 卧室 …）
  id, name, icon?, photo_ids[], note?
}

Area {                // 第二层：区域（洗手台柜子 / 墙壁柜 / 电视柜 / 沙发底下 …）
  id, room_id, name, photo_ids[], note?
}

Item {                // 物品（直接挂在 Area 下）
  id, area_id, name, qty:number, unit?,
  tags:string[], photo_ids[], expires_at?,
  source: 'ai' | 'voice' | 'manual',
  confidence?: number,            // AI 来源时填
  bbox?: {photoId, x,y,w,h},      // AI 在哪张图哪个位置看到的
  notes?
}

Photo {               // 图片元数据；二进制存 IDB Blob，可选上传到服务器
  id, parent_type:'room'|'area'|'item', parent_id, taken_at,
  blob_ref,                          // 本地 IDB key
  remote_url?,                       // 上传后服务器返回的 URL
  recognition_status: 'pending'|'done'|'failed'|'skipped',
  recognition_result?: any           // 原始 JSON 草稿
}

Snapshot {            // 多快照机制：一次盘点的物品清单冻结
  id, area_id, taken_at, item_ids[], note?
}

ReminderRule {        // 保质期/盘点提醒
  id, target: {type:'item'|'area', id}, kind, due_at, repeat?
}

SyncCursor {          // 客户端记录"上次拉到的服务端版本号"
  device_id, last_pulled_at
}
```

> 设计决定：故意限制为 **Room → Area → Item** 两级层级（不做无限自引用树），
> 因为家庭场景层级有限，扁平模型 UI 更清爽，搜索也更直观。
> 如果将来需要"柜子里再分格子"，用 `Item.tags`（如 `["上层"," 左格"]`) 即可，
> 不必把层级做成动态树。

---

## 5. 同步协议（offline-first 关键）

> 设计目标：**完全断网时所有写入照样落盘**；服务器恢复后**最多两次往返**完成全量对账。

- **客户端**：所有改动先写 IndexedDB，并 append 到本地 `OutboxQueue`（含 op、payload、`client_seq`）。
- **拉取**（GET `/sync/pull?since=<ts>`）：服务器返回 `since` 之后所有变更（按 `updated_at` 升序）。
- **推送**（POST `/sync/push`）：客户端把 outbox 整批发上去；服务端逐条处理，返回 `{accepted:[ids], conflicts:[…]}`。
- **冲突策略**：
  - `Room.name` / `Area.name` 等纯标量字段：**LWW（last-write-wins by `updated_at`）**，但保留败者副本到 `conflict_log`，UI 给出"X 设备 5 分钟前也改过此项"横幅。
  - `Item.qty`：**加减增量合并**（每次写入记 delta，不记绝对值）。例：A 端 +2，B 端 -1，最终 +1。
  - `photo_ids[]`、`tags[]`：**集合并集 + 显式删除集**（tombstone）。
  - 软删除 (`deleted=true`)：始终胜过编辑。
- **二进制（图片）**：先用 `multipart/form-data` 上传到 `/blobs`，服务端返回稳定 URL；再在元数据同步里引用。客户端缓存策略 `CacheFirst`，失败时 fallback 到本地 IDB Blob。
- **触发时机**：
  - App 启动 + 进入前台 + `online` 事件 → 自动同步
  - 手动下拉刷新
  - 后台同步：注册 `BackgroundSync` 标签 `outbox-flush`（Android 支持；iOS 不支持时退化为前台触发）

---

## 6. AI 调用与人机修正流程

对应原始讨论里的"三步锁定真相"：

1. **拍照**：UI 引导分层拍（全景 → 局部 → 袋内特写），统一打包到一个 `recognition_batch_id`。
2. **入草稿**：照片立即压缩入 IDB；**默认在客户端直接调云厂商 AI**（用户在设置里填 key）。当客户端选了「先存草稿、稍后识别」或离线时，入 outbox，待服务器在线后由 server 端补识别。
3. **修正 UI**：左侧滑动照片缩略图 + bbox 高亮，右侧物品清单（草稿条目带 ⚠ 低置信度标记）。
4. **语音穿透修正**：长按麦克风 → SpeechRecognition 转文字 → **客户端直调 AI**`messages`（或服务器代理），传入 `(当前清单 JSON, 用户语音, 编辑动作历史)`，返回修改后的完整清单（一次大模型 function-calling）。
5. **锁定存档** → 生成新的 `Snapshot`。

> 离线时步骤 3-5 全部本地完成（修改直接编辑物品记录而不调 AI 合并）；只有"AI 自动识别"和"AI 自然语言合并修正"才依赖在线。

---

## 7. 自然语言查找

调用方式：**客户端优先直调 AI**（服务器代理为可选）。入参 `{question, context: 物品列表精简 JSON}`。
为控制 token：

- 客户端先做关键词召回（Dexie 全文索引），命中条目 + 所属 Area + 同 Area 兄弟物品 → 拼成 ≤ 4k token 的上下文
- 离线 / 没填 API Key 时只走关键词召回，UI 直接展示结果列表（无对话回答）

---

## 8. 提醒

- 数据层：`ReminderRule` 表 + 客户端定时扫描（每次启动 + 每 6 小时）
- 通知通道：
  - Android Chrome PWA：Web Push（需服务器配 VAPID）
  - iOS PWA 16.4+：必须先"添加到主屏"才能订阅 Web Push；不满足时**回退为应用内红点 + 启动横幅**

---

## 9. 里程碑

| 周 | 目标 | 可验收 |
|---|---|---|
| W1 | 脚手架 + Room/Area/Item CRUD + IDB | 能本地添加房间→区域→物品并刷新页面后保留 |
| W2 | Service Worker 离线 + 同步协议骨架 + SQLite 服务端 | 飞行模式下增删，恢复网络后双向合并 |
| W3 | 拍照入库 + **客户端直调云 AI 识别** + 修正 UI | 拍 3 张照能产出可编辑草稿（服务器关机也行） |
| W4 | 语音修正 + 自然语言查找 | 端到端走通"找消毒水"用例 |
| W5 | 鉴权、提醒、快照、iOS 兼容修复、测试 | 见 `03-testing.md` 测试矩阵全绿 |

---

## 10. 关键风险与缓解

| 风险 | 缓解 |
|---|---|
| iOS Safari 在低存储时清理 IndexedDB | 文档强提示用户"添加到主屏"；关键变更立即 push 到服务器；定期导出 JSON 备份 |
| 服务器经常关机，AI 草稿无法生成 | **客户端优先直调云 AI**，服务器只是可选代理；客户端 key 由用户自管。即使服务器关机也可识别。完全离线时存原图、UI 标"待识别"，恢复网络后自动补做 |
| 多人冲突合并误判 | 所有冲突保留 `conflict_log` + UI 横幅人工复核；危险字段（删除）走"软删除 + 7 天回收站" |
| 云端 AI key 泄漏 | **客户端模式**：key 只存浏览器 IndexedDB，不入仓库不入服务器；用户清缓存即销毁；引导走"专项 key + 额度上限"。**服务器代理模式**：key 在服务端 `.env`，前端通过 JWT 调代理，开启简单速率限制 |
| HTTPS 证书在手机端不被信任 | 文档教 mkcert root CA 安装；或选 Tailscale Funnel / cloudflared 隧道方案 |
