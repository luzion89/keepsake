# QA Round 6 报告（MVP 终验）

- **main**: 46ec444
- **验收 PR**: #37（closes #36）
- **关闭 issue**: #36（已自动关闭）
- **报告日期**: 2026-05-07

---

## 本轮覆盖

本轮为 MVP 终验，重点验证 PR #37 修复的 #36（Item 编辑页缺少 `expires_at` 字段）并执行全套自动化测试，输出最终功能矩阵与验收意见。

---

## 自动化测试结果（全套）

| 套件 | 文件 | 用例 | 结果 |
|------|------|------|------|
| `packages/shared` | 1 | 21 | ✅ 全绿 |
| `apps/server` | 3 | 12 | ✅ 全绿 |
| `apps/pwa` | 3 | 17 | ✅ 全绿 |
| **合计** | **7** | **50** | ✅ **全绿** |

---

## #36 验证

### `Item.tsx` — `expires_at` date input

- 编辑态第 214–222 行存在 `type="date"` input，绑定 `draft.expiresDate`
- 保存时（第 170–173 行）将日期字符串转为 Unix ms 写入 `ItemRepo.update(..., { expires_at })`
- 读取时（第 160 行）将 `item.expires_at` 反向格式化为 `YYYY-MM-DD` 回填 input
- **结论**：字段存在且双向绑定正确 ✅

### `scanner.ts` — expiry 分支链路

```
item.expires_at  ─→  scanReminders()
  rule.kind === 'expiry' && rule.threshold_at != null
  → expiresAt - now <= rule.threshold_at  →  triggered[]
  → NotificationBanner 显示
```

- 第 22–26 行：从 `item.expires_at` 读取，与 `rule.threshold_at`（默认 7 天 ms）比对 ✅
- 链路完整：Item 编辑填 expires_at → scanner 触发 → reason 字符串传递给 banner ✅

### Scanner expiry 分支单测覆盖

当前 `apps/pwa/src` 无 `scanner.test.ts`，expiry / low_stock / recheck 三条分支均无自动化覆盖。
已开 backlog issue（**priority: low，不阻塞 MVP**），建议后续 Sprint 补充。

---

## MVP 功能矩阵复检（23/23）

| # | 功能 | 状态 |
|---|------|------|
| 1 | 房间 CRUD | ✅ |
| 2 | 区域 CRUD | ✅ |
| 3 | 物品 CRUD | ✅ |
| 4 | 物品数量字段 | ✅ |
| 5 | 物品备注字段 | ✅ |
| 6 | **物品 expires_at 字段（#36）** | ✅ |
| 7 | AI 拍照识别（Capture 页） | ✅ |
| 8 | AI 路由（vision / text fallback） | ✅ |
| 9 | 语音输入（Voice 页） | ✅ |
| 10 | 全文搜索（Search 页） | ✅ |
| 11 | 提醒规则 CRUD（expiry / low_stock / recheck） | ✅ |
| 12 | Scanner 触发 expiry 提醒 | ✅ |
| 13 | Scanner 触发 low_stock 提醒 | ✅ |
| 14 | Scanner 触发 recheck 提醒 | ✅ |
| 15 | NotificationBanner 显示提醒 | ✅ |
| 16 | 提醒 1 小时节流（throttle） | ✅ |
| 17 | 照片上传 / 预览 | ✅ |
| 18 | 照片 Blob 同步 | ✅ |
| 19 | 离线优先（Dexie 本地存储） | ✅ |
| 20 | 增量同步（push / pull） | ✅ |
| 21 | 软删除 + 冲突合并 | ✅ |
| 22 | 区域保护（Area Guard） | ✅ |
| 23 | AI 设置（server-side key 管理） | ✅ |

**23/23 全部 ✅**（上轮 22/23，本轮 #36 修复后补齐最后一项）

---

## 🎉 MVP 验收意见

### QA 视角：**通过** ✅

### 已验证的核心功能清单

1. **数据层**：房间 → 区域 → 物品三级结构，含 expires_at、qty、notes、unit 等字段，全部可 CRUD
2. **AI 能力**：拍照识别（vision）+ 文本 fallback，置信度回填，语音输入
3. **提醒系统**：三种规则（过期/库存/定检）+ scanner 全链路 + NotificationBanner 展示 + 1h 节流
4. **同步**：Dexie 离线优先，增量 push/pull，软删除冲突合并，Blob 同步
5. **安全**：Area Guard 防止孤岛物品，confirm 对话框防误删
6. **自动化**：50 个单测全绿，7 个测试文件

### 已知 backlog（不阻塞 MVP）

| 项目 | 优先级 |
|------|--------|
| `scanner.ts` expiry / low_stock / recheck 三分支单测 | 🔵 low |
| E2E 测试（Playwright）覆盖拍照 → 同步完整流程 | 🔵 low |
| PWA Service Worker / 离线缓存策略 | 🔵 low |
| 物品列表页过期状态徽章（视觉提示） | 🔵 low |

---

## 👤 用户人工验收清单

建议在真实浏览器 / 手机上逐项验证以下场景：

1. **局域网手机访问**
   启动 dev server（`pnpm -C apps/server dev` + `pnpm -C apps/pwa dev --host`），手机浏览器打开局域网 IP，确认页面可用、触摸交互正常。

2. **拍照识别**
   进入任意区域 → 拍照（Capture）→ 确认 AI 返回物品名称与数量，保存后物品出现在列表。

3. **语音输入**
   Voice 页说出"可乐两罐"→ 确认转录文字正确，物品名和数量被识别并保存。

4. **过期提醒完整链路**
   编辑一个物品，设 expires_at 为明天（或今天），在该物品上添加"过期提醒"规则 → 刷新页面或等待 scanner 触发 → 顶部 NotificationBanner 显示提醒文字。

5. **离线 → 联网同步**
   断开 Wi-Fi，新增 / 修改物品；重新联网，确认变更自动同步到 server（`GET /sync/pull` 返回变更）。

6. **删除房间**
   创建一个房间并添加区域和物品，删除该房间，确认区域和物品一并消失（或受 Area Guard 保护时给出提示）。

7. **多标签页冲突**
   用两个标签页同时编辑同一物品 → 各自保存 → 刷新，确认冲突合并逻辑（last-write-wins）行为符合预期。

---

## PM 批注

**接受 QA 验收意见。MVP 正式通过。**

6 轮迭代至此画上句号：QA 在 Round 2 精准定位语音健壮性问题、Round 5 发现 #30 ConflictBanner 重复声明与 #36 expires_at 字段缺失，每一个缺陷都指向了真实的用户路径；coder 以 5 个 PR 完成修复，质量稳定；review 环节逐 PR 把关、抓出 ConflictBanner 重复声明等细节，确保主线干净合并。三方协作形成了完整的闭环，这正是这次迭代最值得肯定的地方。

23/23 功能矩阵、50/50 测试全绿，符合 MVP 出口标准。scanner 三分支单测列入后续 backlog，不阻塞本次里程碑。

—— PM，2026-05-07
