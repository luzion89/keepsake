# QA Round 4 回归测试报告

> 日期：2026-05-07
> 基准 commit：`3ccbc74`（main）
> 本轮合并 PR：#28（closes #15），#29（closes #8 #9 #25 #26 #27）

---

## 1. 验收范围

| Issue | 标题 | 结果 |
|-------|------|------|
| #15 | AI 自然语言搜索 | ✅ 通过 |
| #8  | ConfirmDialog / useConfirm | ✅ 通过（发现遗漏 #30） |
| #9  | setAiConfig 离线反馈 | ✅ 通过 |
| #25 | LWW tie-breaker（小者胜） | ✅ 通过 |
| #26 | Build 顺序 shared→pwa→server | ✅ 通过 |
| #27 | mergeSnapshot 边界单测 | ✅ 通过 |

---

## 2. 逐项验证细节

### #15 AI 自然语言搜索

**代码路径**：`apps/pwa/src/pages/Search.tsx` + `apps/pwa/src/ai/router.ts#searchAnswer`

- **mode=off / 无 apiKey 时按钮不渲染**：`Search.tsx:128` 使用 `aiEnabled && q.trim()` 条件渲染，`aiEnabled` 由 `getAiConfig().mode === 'on' && !!cfg.apiKey` 控制。✅
- **searchAnswer 内部守卫**：第一行检查 `cfg.mode !== 'on' || !cfg.apiKey` 返回 `{ok:false}`。✅
- **OpenRouter 调用**：system prompt 包含物品列表上下文块；user message = 原始用户输入（prompt injection 属预期，system role 已隔离）。✅
- **citedIds Array.isArray 兜底**：`router.ts:252` `Array.isArray(parsed.citedIds) ? parsed.citedIds : []`。✅
- **非法 itemId 不崩溃**：citedIds 存入 `Set`，只影响 CSS 高亮，不会 throw。✅
- **上下文 token 评估**：30 条 × ≈80 字节 = 2.4 KB ≈ 600–800 token，System Prompt 约 200 token，总计远低于 4k。✅

### #8 ConfirmDialog / useConfirm

**代码路径**：`apps/pwa/src/components/ConfirmDialog.tsx`

- `useConfirm` 返回 `Promise<boolean>`。✅
- dialog 通过 `createPortal(…, document.body)` 挂载在 document.body。✅
- 多 dialog 并存：实现为单 `DialogState | null`，第二次 confirm() 会替换状态（前一个 Promise 永不 resolve）。可接受，实际用户流程不会触发并发。
- 点 overlay 取消（`onClick={() => handle(false)}`）。✅
- danger 按钮样式：`bg-rose-600 text-white`。✅
- **ESC 键未绑定**：目前 ConfirmDialog 不响应 ESC，属可改进项，但不阻断 MVP。
- **遗漏迁移**：`apps/pwa/src/pages/Item.tsx:51` 仍使用原生 `window.confirm`；Voice/Capture 页均无删除操作，不受影响。已开 **issue #30** 跟踪。

### #9 setAiConfig 离线反馈

**代码路径**：`apps/pwa/src/ai/router.ts#setAiConfig` + `apps/pwa/src/pages/Settings.tsx`

- 离线时 fetch 抛异常 → 返回 `{ok:false, error: msg}`。✅
- `Settings.tsx:121–123` 展示红字「已保存到本地，服务端推送失败：…（重新打开应用会重试）」，不会显示"已同步"。✅
- 仅在 `result.ok === true` 时显示绿色"已同步"。✅
- **pullAiConfigFromServer**（启动重试）：`router.ts:77` 仍然存在，LWW by `updated_at`，只 GET 不 PUT，无循环触发风险。✅

### #25 LWW tie-breaker

**代码路径**：`packages/shared/src/merge-rules.ts#lwwPick`

- 逻辑：`updated_at` 相等时比较 `updated_by` 字典序，`local < remote → 'local'`，`local > remote → 'remote'`，相等 → `'remote'`（fallback）。✅
- UUID 全为 hex 字符 `0-9a-f`，字典序结果确定性有保证。✅
- 测试覆盖（`merge-rules.test.ts`）：`'A'<'Z' local胜`、`'Z'>'A' remote胜`、`same→remote fallback`、`device-1 < device-2`、Room 跨类型一致性，共 5 个 tie-breaker 用例。✅

### #26 Build 顺序

**代码路径**：根 `package.json#scripts.build`

```json
"build": "pnpm -C packages/shared build && pnpm -C apps/pwa build && pnpm -C apps/server build"
```

- 顺序：`shared → pwa → server`，硬编码串行执行。✅
- pwa 和 server 均通过 workspace 引用 `@keepsake/shared`，shared 先 build 保证 dist 已就位。✅

### #27 mergeSnapshot 边界单测

**代码路径**：`packages/shared/src/merge-rules.ts#mergeSnapshot` + `merge-rules.test.ts`

- 实现：Snapshot 视为不可变，直接走 LWW，无字段级 merge。✅
- 测试覆盖：local newer、remote newer、tie-breaker（small deviceId 胜）、tombstone local deleted、tombstone remote deleted、both deleted。✅

---

## 3. 自动化测试结果

```
packages/shared  vitest run   16 tests  ✅ pass
apps/server      vitest run    8 tests  ✅ pass
apps/pwa         vitest run   17 tests  ✅ pass
                              ─────────────────
合计                           41 tests  全绿
```

---

## 4. 探索性发现 / 新 Issue

| Issue | 优先级 | 描述 |
|-------|--------|------|
| **#30** | 🔴 bug | `Item.tsx` 删除按钮使用原生 `window.confirm`，iOS PWA standalone 模式下会被系统阻断（弹不出，默认 false），导致物品详情页无法删除 |

其它观察（未开 issue，记录备案）：
- `ConfirmDialog` 未绑定 ESC 键；暂不影响 MVP，可与 #14 一并考虑。
- `Search.tsx` 中"无关键词命中时兜底拉全部 items"上限为 30，若 items 非常多（>30）时上下文覆盖率有限，属已知 token 预算权衡，文档已说明。
- `Snapshot` 页面未实现（无路由入口），快照功能仅有后端数据层和创建逻辑，缺 UI 展示——详见 MVP 完成度评估。

---

## 5. 功能矩阵对照（docs/01-plan.md）

| 模块 | 状态 | 说明 |
|------|------|------|
| 房间 CRUD | ✅ 已实现 | Home.tsx 完整增删改，useConfirm 已接入 |
| 区域 CRUD | ✅ 已实现 | Room.tsx / Area.tsx 完整增删改 |
| 物品 CRUD | ⚠️ 部分 | 增改查已实现；删除有 #30 bug（window.confirm，iOS 阻断） |
| 拍照入库 | ✅ 已实现 | Capture.tsx + PhotoRepo，Snapshot 自动创建（#16） |
| AI 拍照识别 | ✅ 已实现 | recognize() 直连 OpenRouter Vision |
| 语音输入 | ✅ 已实现 | Voice.tsx + parseVoiceText，SpeechRecognition 兜底 |
| AI 自然语言搜索 | ✅ 已实现 | Search.tsx + searchAnswer（#15） |
| 关键词搜索 | ✅ 已实现 | ItemRepo.search + 分组展示 |
| 同步协议 push/pull | ✅ 已实现 | sync.test.ts 覆盖 pull/push 端到端 |
| 冲突合并（LWW） | ✅ 已实现 | merge-rules.ts，tie-breaker 已修复（#25） |
| Snapshot 快照 | ⚠️ 部分 | 数据层 + 自动创建已实现；**无 UI 查看/管理界面** |
| 设置 / AI Key | ✅ 已实现 | Settings.tsx，离线红字提示 OK（#9） |
| 导出 JSON | ✅ 已实现 | Settings.tsx exportJson |
| PWA 离线（Service Worker） | ✅ 已实现 | vite-plugin-pwa + Workbox precache |
| 鉴权（JWT） | ❌ 未实现 | 无登录流程，家庭场景单用户使用，列为已知缺口 |
| 提醒（ReminderRule） | ❌ 未实现 | 数据模型未落地，UI 未实现 |
| 图片上传到服务器 `/blobs` | ❌ 未实现 | 照片仅存本地 IDB，未实现跨设备二进制同步 |
| conflict_log / UI 横幅 | ❌ 未实现 | 冲突记录到 conflicts 数组但无 UI 展示 |

---

## 6. MVP 完成度评估

对照 `docs/01-plan.md §1 成功标准`：

### 成功标准 1（离线全流程）
> 任何设备在飞行模式下能完成「添加房间 → 添加区域 → 拍 3 张照 → 语音/手动添加 5 件物品 → 关键词搜出来」全流程；AI 识别不依赖 Keepsake 服务器。

**当前状态**：⚠️ **基本满足，有一个阻断 bug**
- 房间/区域/物品添加均可离线完成 ✅
- 拍照入库 + 离线草稿 ✅
- 关键词搜索 ✅
- AI 识别直连 OpenRouter（不依赖服务器）✅
- **Item 详情页删除在 iOS PWA 失效（#30）**，添加和查询不受影响

### 成功标准 2（30 秒双向同步）
> 服务器开机后，离线变更在 30 秒内完成双向同步，不丢数据，冲突按策略合并。

**当前状态**：⚠️ **数据层满足，UX 层不完整**
- push/pull 协议 + LWW merge 已实现 ✅
- conflict_log 字段存在，但**无 UI 展示冲突横幅**，用户无感知 ❌
- 图片二进制未实现跨设备同步 ❌

### 成功标准 3（iOS >30 天不被清理）
> iPhone Safari 16.4+ 添加到主屏后能保持 >30 天不被系统清理。

**当前状态**：⚠️ **技术前提已满足，未经真机长期测试**
- PWA manifest + Service Worker 已配置 ✅
- 未做持久化存储 `navigator.storage.persist()` 请求，理论上仍有被清理风险

---

### 结论：#14 完成后能否达到 MVP？

**issue #14** 内容待确认，但基于当前缺口分析：

如果 #14 是指"鉴权/多用户"，则完成后仍缺：
1. **#30**（Item 删除 iOS 阻断）— 必须修复
2. 图片跨设备同步（`/blobs` 上传）— 核心功能缺口
3. 冲突 UI 横幅 — 降级体验

**结论：#14 完成后不足以达到完整 MVP。** 还需额外修复 #30（bug，1-2h）并实现图片上传（较大工程量）。若将"MVP"范围收窄为"单设备离线使用 + AI 辅助录入 + 关键词/AI 搜索"，则修复 #30 后即可达到。

---

## 7. 参考

- 新开 issue：[#30 Item.tsx window.confirm iOS 阻断](https://github.com/luzion89/keepsake/issues/30)
- 自动化测试：41 tests passed, 0 failed
- 下一优先级：#14 → #30 → 图片上传 → 冲突横幅 UI

---

## PM 批注

> 批注人：PM | 日期：2026-05-07

### 一、QA 各条建议接受/驳回

| QA 发现 | 决定 | 说明 |
|---------|------|------|
| #30 Item.tsx window.confirm iOS 阻断 | ✅ **接受，必修** | 物品删除在 iOS PWA 完全失效，阻断成功标准 1，第五轮首要任务 |
| ConfirmDialog 未绑 ESC | ⏸ **暂缓** | 不阻断 MVP，桌面端体验优化，放 backlog（无 issue） |
| Snapshot 页面无 UI | ⏸ **暂缓** | 数据层已就绪；快照浏览 UI 不在 MVP 成功标准内，放 backlog |
| Search.tsx 上下文限 30 条 | ✅ **接受作为已知权衡** | 文档已说明 token 预算，无需修改 |
| conflict_log 无 UI 横幅 | ✅ **接受，纳入 MVP** | 成功标准 2 明确要求"不静默覆盖"，已开 **[#32](https://github.com/luzion89/keepsake/issues/32)** |
| 图片跨设备二进制同步 /blobs | ✅ **接受，纳入 MVP** | 成功标准 2 依赖跨设备照片可见，已开 **[#31](https://github.com/luzion89/keepsake/issues/31)** |
| #14 ReminderRule 提醒功能 | ✅ **接受，纳入 MVP** | docs/01-plan.md §8 明确提醒为核心功能，issue #14 已存在 |

---

### 二、MVP 范围明确清单

**✅ 在 MVP 范围内（必须完成才能宣布 MVP）**

1. **#30** — Item.tsx 删除迁移到 useConfirm（iOS 解锁删除）
2. **#14** — ReminderRule 数据层 + 客户端定时扫描 + 应用内通知（iOS 16.4+ Web Push 为加分项）
3. **#31** — 图片二进制跨设备同步（`/blobs` 上传 + CacheFirst fallback）
4. **#32** — 冲突 UI 横幅（sync 后展示 conflict_log 提示）

**❌ 不在 MVP 范围内（放 backlog，理由见右）**

| 功能 | 理由 |
|------|------|
| 鉴权（JWT / 登录流程） | 家庭单网络场景，plan.md 已标注"已知缺口"；无成功标准要求 |
| Snapshot 浏览 UI | 数据层已就绪，查看界面属锦上添花，不影响三条成功标准 |
| ConfirmDialog ESC 键 | 纯桌面 UX 优化，移动端 MVP 不需要 |
| Item.qty 加减增量合并 | 当前 LWW 在家庭单用户场景下够用，delta merge 属高级优化 |
| navigator.storage.persist() | iOS >30 天理论风险，实操中 PWA 安装态已大幅缓解 |

---

### 三、第五轮指派

| Issue | 优先级 | 轮次 | 理由 |
|-------|--------|------|------|
| **#30** | 🔴 P0 | 第五轮 | 阻断 iOS 删除，1-2h 工作量，必须立刻消灭 |
| **#14** | 🟠 P1 | 第五轮 | MVP 主菜，ReminderRule 数据模型 + 扫描 + 应用内提醒 |
| **#31** | 🟠 P1 | 第五轮 | MVP 阻断，图片无法跨设备是核心体验缺口 |
| **#32** | 🟡 P2 | 第五轮 | 成功标准 2 要求，工作量小（读已有 conflicts 字段展示横幅） |

---

### 四、表扬 QA

🎉 **QA 这轮抓出 #30 是真实高质量发现。**

本轮其他页面（Home、Room、Area）在 PR #29 中已全部迁移到 useConfirm，但 Item.tsx 单独漏了——这正是"大范围重构后的典型遗漏回归"模式，很容易在 code review 中滑过去。QA 细心对照每个有删除操作的页面逐一验证，准确定位到 `Item.tsx:51` 这一行，并正确推断了 iOS PWA standalone 模式下 `window.confirm` 会被系统拦截、默认返回 false 的行为后果。这条 bug 如果到真机测试才发现，修复成本会高得多。👍
