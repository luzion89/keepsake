# QA Round 3 报告

- main 验证 commit: 6b2cefc
- 验收 PR: #22 #23 #24
- 关闭 issue: #16 #19 #20 #21

## 本轮覆盖功能

- **服务端 AI 配置校验**（#20 / PR #22）：`/settings/ai` PUT 使用 `AiConfigSchema.strict()` 拒绝非法 mode、超长 apiKey、未知字段；GET 脏数据降级兜底。
- **测试加固**（#19 #21 / PR #23）：PhotoRepo.setRecognition 状态机单测 + LWW tie-breaker 行为固化单测。
- **Capture Snapshot 生成**（#16 / PR #24）：锁定存档时在 itemIds 非空情况下调用 SnapshotRepo.create，写入 snapshots 表并进同步队列。

## 自动化测试结果

| 包 | 测试文件 | 用例数 | 结果 |
|---|---|---|---|
| packages/shared | merge-rules.test.ts | 10 | ✅ 全通过 |
| apps/server | sync.test.ts + ai.test.ts | 8 | ✅ 全通过 |
| apps/pwa | router.test.ts + area-guard.test.ts + photo-repo.test.ts | 17 | ✅ 全通过 |

**合计：35/35 通过**

## 回归结果（逐 issue）

| issue | PR | 复测点 | 结果 |
|---|---|---|---|
| #20 | #22 | AiConfigSchema strict 校验：合法 200，非法 mode/超长 apiKey/未知字段各返回 400 | ✅ |
| #20 | #22 | GET 脏数据降级：写入非法 JSON 后 GET 返回 `{mode:'off'}` 200 而非 500 | ✅ |
| #19 | #23 | photo-repo.test.ts 5 断言：pending→done、version++、outbox 推入、不存在不 throw、pending→failed | ✅ |
| #21 | #23 | merge-rules tie-breaker：4 个用例覆盖字典序大设备 local/remote 胜、同设备名 remote 胜、mergeRoom 一致性 | ✅ |
| #16 | #24 | Capture.tsx save()：itemIds>0 时调用 SnapshotRepo.create；pending 路径不生成快照 | ✅ |
| #16 | #24 | snapshots 表存在于 schema.sql；'snapshot' 完整注册于 queries.ts TABLE_MAP/COLUMNS/JSON_COLS/mergeFn | ✅ |

## 探索性测试

### curl /settings/ai 4 个 case 实测结果

```
合法 {"mode":"on","apiKey":"sk-or-test"}      → 200 ✅
非法 mode {"mode":"client"}                    → 400 ✅
apiKey 超长（303字符）                          → 400 ✅
未知字段 {"mode":"on","weird":"x"}             → 400 ✅
```

### GET 脏数据降级实测

用 sqlite3 直接写入 `not-valid-json{{{` 到 kv 表，GET `/settings/ai` 返回：

```json
{"mode":"off","updated_at":0}  HTTP 200
```

safeParseConfig 兜底逻辑正常工作。

### Capture.tsx 综合自洽性 review

三个功能点**无冲突**：
1. **三态 areaState**（loading / not-found / ok）：渲染路径清晰，save() 前二次校验 area 存在性，防孤儿物品逻辑完整。
2. **pending 路径**：`aiState === 'pending'` 时，photo 保存但 drafts 为空 → `itemIds.length === 0` → **不调用** SnapshotRepo.create。行为合理（无 item 不生成快照）。
3. **Snapshot 生成**：仅在 AI 识别完成且用户确认 item 后触发，与三态逻辑、防孤儿校验无交叉干扰。

> **pending 路径评估**：图片未识别就锁定时不生成快照，这是有意设计——快照记录的是 item_ids，pending 状态无 item 可记录。行为合理，无需开新 issue。

### LWW tie-breaker A 方案风险评估

当前实现 `updated_by` 字典序决胜，存在两类潜在风险：

1. **同设备同毫秒双写**：`updated_by` 相同 → `>` 为 false → remote 总胜，先写数据静默丢弃。
2. **精确 NTP 时钟对齐**：字典序靠前的设备在竞争中永远落败，用户感知为"修改经常被覆盖"。

概率低，但触发时无任何提示，已开 **issue #25**（type:bug / priority:low）备案。

### 发现的构建依赖问题

`apps/server` build 依赖 `packages/shared` dist 含 `AiConfigSchema`，但 `packages/shared` dist 为旧版本（PR #22 后未重新构建）。需要先 `pnpm -C packages/shared build` 再 `pnpm -C apps/server build`。CI 若未配置依赖顺序，可能导致 server build 失败。

## 新发现 bug

- **issue #25**（type:bug / priority:low）：LWW tie-breaker 同设备同时间场景下数据静默丢失风险。详见 issue。

## 未覆盖的盲区

- Snapshot 的同步冲突合并（两设备同时对同一 area 生成快照时，mergeSnapshot 行为未有专项测试）。
- `SnapshotRepo.listByArea` 在 PWA 侧的 UI 消费路径尚未有集成测试。
- `kv` 表的跨设备同步路径（当前 kv 不走 sync push/pull，AI 配置仅靠 PUT 到 server，未走 outbox）。

## 下一轮建议重点

1. 补充 Snapshot 同步冲突合并的 server 端单测（mergeSnapshot 边界）。
2. 确认 `kv` 表 AI 配置是否需要多设备同步（当前架构：PUT 直写 server，client 每次从 server GET，实际已多设备共享，但需确认是否符合产品预期）。
3. 修复 CI 构建依赖顺序：shared → server（或在 server package.json 中加 `prebuild` 钩子）。
4. 评估 LWW tie-breaker #25 是否需要升优先级（取决于用户反馈）。
