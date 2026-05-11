# Keepsake — 测试

> 配套：`01-plan.md`（项目规划）、`02-implementation.md`（技术实现）。

---

## 1. 测试现状概述

项目使用 **vitest** 作为唯一自动化测试框架。**不存在 e2e 框架**（Playwright 已列为 devDependency 但无任何测试文件，`pnpm test:e2e` 命令目前无实际测试可跑）。UI 验收通过人工 + QA agent 流程完成。

---

## 2. 各 workspace 测试内容

### 2.1 `packages/shared`

命令：`pnpm -C packages/shared test`

| 文件 | 覆盖内容 |
|---|---|
| `src/merge-rules.test.ts` | 字段级 LWW、软删除优先、`qty_delta` 增量累计、`photo_ids`/`tags` 集合并集 |
| `src/sync-protocol.test.ts` | `OpSchema`、`PushReqSchema`、`PushRespSchema` Zod 校验，含边界输入 |

### 2.2 `apps/server`

命令：`pnpm -C apps/server test`

| 文件 | 覆盖内容 |
|---|---|
| `src/sync.test.ts` | `/sync/pull` 和 `/sync/push` 路由，含 4 种 op（upsert/delete/qty_delta/patch）、冲突逻辑 |
| `src/patch-op.test.ts` | patch op 的字段级合并、行不存在时跳过行为 |
| `src/blobs.test.ts` | blob 上传 / 下载路由 |
| `src/ai.test.ts` | `/settings/ai` GET / PUT 路由 |
| `src/backup.test.ts` | `runBackup`、`pruneBackups`、`listBackups`、`startBackupScheduler` |

### 2.3 `apps/pwa`

命令：`pnpm -C apps/pwa test`（vitest + jsdom 环境）

| 文件 | 覆盖内容 |
|---|---|
| `src/ai/router.test.ts` | `parseItemsFromText`、`searchAnswer`、`pingProvider`、`getEffectiveProvider`、`isValidKey` |
| `src/i18n/i18n.test.ts` | `translate()`、中英双语 key 覆盖、变量替换 |
| `src/db/item-repo.test.ts` | Item CRUD、`qty_delta` 写入、软删除 |
| `src/db/room-repo.test.ts` | Room CRUD、级联查询 |
| `src/db/photo-repo.test.ts` | Photo 元数据读写 |
| `src/sync/blobs.test.ts` | blob 上传队列、CacheFirst 策略 |
| `src/pages/area-guard.test.ts` | Area 路由守卫（area 不存在时重定向） |
| `src/logging/logger.test.ts` | 日志级别过滤 |

---

## 3. 一次性运行所有测试

```bash
pnpm test
# 等价于分别运行：
pnpm -C packages/shared test
pnpm -C apps/server test
pnpm -C apps/pwa test
```

---

## 4. QA Agent 流程

UI 验收和探索性测试由 QA agent 完成（`.claude/agents/qa.md`）。主要流程：

1. **自动化测试**：运行上述 vitest 套件，确认全绿；
2. **API 测试**：构建服务端后，用 `curl` 对关键路由做黑盒测试；
3. **手工 UI 测试**：在 dev server 下人工走核心路径（房间/区域/物品 CRUD、AI 文字解析、同步冲突横幅、离线后恢复）；
4. **提 Bug**：发现问题后通过 `gh issue create` 提交，格式见 `qa.md`；
5. **验收修复**：PR 合并后复测，确认通过后在 issue 留评论并关闭；
6. **轮次报告**：每轮结束后在 `docs/qa-reports/round-N.md` 写汇总文档。

> **注意**：QA agent 不修改业务代码；不存在 Lighthouse 自动化评分脚本；不存在同步 fuzz 脚本。

---

## 5. 手工测试参考清单

以下为 QA agent 在每轮测试中应覆盖的核心路径：

**CRUD 核心路径**
- [ ] 创建房间 → 房间下创建区域 → 区域内添加物品 → 刷新页面后数据仍在
- [ ] 重命名房间、区域；删除物品、区域、房间（含级联删除确认弹窗）
- [ ] 物品数量加减

**AI 功能**
- [ ] 配置 DeepSeek / OpenRouter API Key，验证连通性（ping）
- [ ] 输入中文描述（如"三瓶洗发水、两盒牙膏"），验证解析结果
- [ ] 切换 replace / merge 模式，验证现有物品保留行为
- [ ] 自然语言搜索，验证引用高亮

**同步**
- [ ] 两台设备同时修改同一物品名称，验证冲突横幅出现
- [ ] 一端修改数量（qty_delta），另一端同步后数值正确
- [ ] 离线添加物品，恢复网络后同步成功

**PWA**
- [ ] Android Chrome：安装提示出现，安装后桌面图标可用
- [ ] iOS Safari：添加到主屏后地址栏隐藏（standalone 模式）
- [ ] 飞行模式下打开 App，已缓存页面可访问

**国际化**
- [ ] 切换中/英语言，所有 UI 文字切换，AI 回答语言随之切换
