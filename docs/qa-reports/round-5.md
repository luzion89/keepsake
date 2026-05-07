# QA Round 5 报告（MVP 验收候选）

- main 验证 commit: 7abc385
- 验收 PR: #33 #34 #35
- 关闭 issue: #14 #30 #31 #32

---

## 本轮覆盖

| PR | Issue | 功能 |
|----|-------|------|
| #33 | #30 | Item.tsx 删除按钮迁移到 useConfirm |
| #33 | #32 | ConflictBanner 冲突 UI 横幅 |
| #34 | #14 | ReminderRule 数据层 + 应用内通知横幅 |
| #35 | #31 | 图片 Blob 跨设备同步（PUT/GET/list） |

---

## 自动化测试

| 套件 | 预期 | 实际 | 结果 |
|------|------|------|------|
| `pnpm -C packages/shared test` | 21 | 21 | ✅ 通过 |
| `pnpm -C apps/server test` | 12 | 12 | ✅ 通过 |
| `pnpm -C apps/pwa exec vitest run` | 17 | 17 | ✅ 通过 |

全套 50 个测试，零失败。

---

## 回归结果（逐 issue）

### #30 — Item.tsx confirm 修复

- **验证方式**：Read `apps/pwa/src/pages/Item.tsx` + grep 全 pages 目录
- **结论**：✅ 无 `window.confirm` 残留。Item.tsx `remove()` 使用 `useConfirm({ danger:true, okText:'删除' })`。Home/Room/Area 页面同样已迁移。
- **Issue 评论**：已留 QA 评论

### #32 — ConflictBanner

- **验证方式**：Read `apps/pwa/src/app/Shell.tsx`
- **结论**：✅
  - `count === 0` 时 `return null`，完全不渲染
  - `setInterval(tick, 5000)` 5 秒轮询，`return () => clearInterval(id)` cleanup 正确
  - 展开时从 IndexedDB 实时加载冲突行，「全部确认」后清零
- **Issue 评论**：已留 QA 评论

### #14 — ReminderRule + 应用内通知

- **验证方式**：Read types.ts / dexie.ts / scanner.ts / Shell.tsx / Item.tsx / schema.sql + 跑单测
- **结论**：✅（含一个新 bug #36，见"新发现 bug"节）
  - `ReminderRuleSchema` 完整定义 kind/threshold_at/threshold_qty/last_fired_at
  - Dexie v2 upgrade 添加 `reminders` 表，索引 `item_id, kind, updated_at, deleted`
  - `scanner.ts` 三种 kind 逻辑正确；1 小时内节流防重复通知
  - `NotificationBanner` `setInterval(run, 60_000)` + cleanup，触发时展示横幅
  - `ReminderSection` 组件支持添加/删除三种规则
  - server `schema.sql` 含 `reminders` 表及索引
  - `mergeReminderRule` 5 个单测全通过（last_fired_at max、tombstone 优先、threshold LWW）
- **Issue 评论**：已留 QA 评论

### #31 — 图片 Blob 同步

- **验证方式**：Read blobs.ts(server)/blobs.ts(pwa)/client.ts + curl 端到端测试 + 单测
- **结论**：✅
  - PUT id 校验（`/^[\w-]{1,128}$/`）防注入
  - GET /blobs/list?since 返回时间戳过滤列表
  - GET /blobs/id/:id 返回文件流，Cache-Control 30 天
  - `pushPendingBlobs` / `pullMissingBlobs` 集成进 `syncOnce`
  - 路径穿越 `/blobs/../etc/passwd` → Fastify 规范化为 `/etc/passwd` → 404 拒绝（安全，非 200）
  - server blob 4 个单测全通过
- **Issue 评论**：已留 QA 评论

---

## 探索性测试（含 blob 端到端 curl 测试结果）

```bash
# 启动 server（PORT=8443）
# 上传
PUT /blobs/550e8400-e29b-41d4-a716-446655440000  → 200 {"id":"550e8400-..."}

# 列表
GET /blobs/list?since=0  → {"ids":["550e8400-..."]}

# 下载 + diff
GET /blobs/id/550e8400-...  → 200
diff /tmp/test_blob.txt /tmp/dl_blob.txt  → DIFF: files match ✅

# 路径穿越防护
PUT /blobs/../etc/passwd  → 404（Fastify 路由规范化拒绝）✅
```

---

## 新发现 bug

### #36 — bug(pwa): Item 编辑页无 expires_at 字段，「过期提醒」规则永不触发

- **严重程度**：中（MVP 提醒功能部分失效）
- **原因**：`scanner.ts` expiry 触发依赖 `item.expires_at`，但整个 PWA 无任何 UI 设置该字段
- **影响**：用户可创建「过期提醒」规则但永远不会收到通知
- **建议**：Item 编辑区域增加有效期日期选择器

---

## 🎯 MVP 完整功能矩阵

| 模块 | docs/01-plan.md 承诺 | 实现状态 | 验证方式 | 备注 |
|------|---------------------|---------|---------|------|
| 房间 CRUD | Room 增删改 + 离线持久 | ✅ | code review / Dexie | 有 icon/photo_ids/note |
| 区域 CRUD | Area 增删改，挂在 Room 下 | ✅ | code review | |
| 物品 CRUD | Item 增删改，qty/unit/tags/notes | ✅ | code review + 单测 | |
| 拍照入库 | getUserMedia + input file 兜底，blob 入 IDB | ✅ | code review | browser-image-compression 集成 |
| 客户端 AI 识别 | 浏览器直调云厂商（OpenAI/Gemini），服务器关机也可识别 | ✅ | ai/router.test.ts 6 tests | key 存 IndexedDB 不上传 |
| 语音输入 | Web Speech API，不支持时退回手动 | ✅ | code review (Capture 页) | |
| 关键词搜索 | Dexie 全文索引召回 | ✅ | code review (Search 页) | |
| 自然语言查找 | AI 问答 + 关键词召回兜底 | ✅ | code review | 离线走关键词 |
| 修正 UI | 草稿编辑 + 低置信度标记 | ✅ | code review | |
| Snapshot 锁定存档 | 生成 Snapshot，item_ids[] 冻结 | ✅ | mergeSnapshot 单测 | |
| 离线 first | 所有写入走 Dexie + Outbox，断网可用 | ✅ | code review + SW | |
| Service Worker | Workbox precache，offline 可访问 | ✅ | vite-plugin-pwa 配置 | |
| 双向同步 | GET /sync/pull + POST /sync/push | ✅ | sync.test.ts 4 tests | |
| 冲突合并 LWW | 标量字段 LWW，qty delta，tags 集合并 | ✅ | merge-rules.test.ts 21 tests | |
| 冲突横幅 UI | ConflictBanner，5s 轮询，可确认 | ✅ | code review (#32) | |
| 图片 Blob 同步 | PUT/GET/list，跨设备拉取 | ✅ | curl e2e + blobs.test.ts | |
| 提醒规则 | ReminderRule 三种 kind，可增删 | ✅ | code review (#14) | |
| 应用内通知横幅 | NotificationBanner，60s 扫描 | ✅ | code review | |
| 过期提醒触发 | expiry kind 依赖 item.expires_at | ⚠️ | scanner.ts code review | **#36**: UI 无 expires_at 字段，规则可创建但永不触发 |
| 确认对话框 | useConfirm 替代 window.confirm | ✅ | grep + code review (#30) | 全 pages 已迁移 |
| 鉴权 JWT | 家庭共享密码 → JWT HS256 | ✅ | code review (auth 路由) | |
| AI 代理（可选） | server 转发 OpenAI/Gemini | ✅ | ai.test.ts 4 tests | |
| iOS PWA 持久化 | 文档提示 Add to Home Screen | ✅ | docs 说明 | Safari 清理风险已文档化 |
| 设置页 AI Config | 跨设备 LWW 同步 AI Key 配置 | ✅ | ai.test.ts + code review | key 不上传，代理 key 在 server .env |

**统计**：✅ 22 / ⚠️ 1（#36 过期提醒 UI 缺失） / ❌ 0

---

## MVP 验收建议

**QA 视角：条件通过（建议修复 #36 后正式发布）**

**理由**：
- 全套 50 个自动化测试 100% 通过
- blob 端到端 curl 测试正常（上传/下载/列表/路径穿越防护）
- 本轮 4 个 issue 全部验收通过，所有 open issue 已清零
- 核心功能矩阵 22/23 项满足 MVP 承诺

**唯一阻断风险**：#36「过期提醒」item 没有 expires_at 编辑入口，用户无法实际使用该功能。该 bug 属于 MVP 范围内功能性缺陷，但不影响其他 22 项功能。若 PM 评估提醒功能为 MVP 核心需求，应在发布前修复；若视为 backlog 可先发布。

**已知 backlog（不影响 MVP 通过）**：
- Web Push（VAPID）未实现，iOS/Android 推送走应用内横幅兜底
- BackgroundSync (`outbox-flush`) 未注册，iOS 退后台不同步（前台触发兜底）
- `conflict_log` 未接入服务端 API 下发（本地 IndexedDB 记录，服务端 conflict_log 表数据无法查看）
- 路径穿越防护靠 Fastify 路由规范化（返回 404 而非 400/403），可加显式校验
