# QA Round-8 回归报告

> 测试日期：2026-05-07  
> 分支：main（大重构第 4 轮，PR #68–#75 全部合并）  
> 测试人：Claude Code（自动化 + API 实测）

---

## 一、覆盖范围

| # | PR | Issue | 测试项 | 测试方式 |
|---|----|-------|--------|----------|
| 1 | #68 | #60 | Settings 保存错误 friendly 提示 | 代码审查 + 单测 |
| 2 | #69 | #61 | notes/expires_at 后端字段全链路 | curl push/pull 实测 |
| 3 | #74 | #62 | Item 详情页过期天数徽章 | 代码审查 |
| 4 | #70 | #63 | AI provider 抽象 + DeepSeek 默认 | 单测 + 代码审查 |
| 5 | #71 | #64 | parseItemsFromText（取代 parseVoiceText） | 单测 + OpenRouter API 实测 |
| 6 | #73 | #65 | 新「文字录入」页 `/areas/:id/text` | 代码审查 + 路由审查 |
| 7 | #72 | #66 | 拍照降级为区域照片存档 | 代码审查 |
| 8 | #75 | #67 | Area 页入口改造 | 代码审查 |

---

## 二、自动化测试结果

### 2.1 Vitest 套件

| 包 | 测试文件 | Tests | 结果 |
|----|----------|-------|------|
| `packages/shared` | `merge-rules.test.ts` | 28 | ✅ PASS |
| `apps/server` | `ai.test.ts` | 4 | ✅ PASS |
| `apps/server` | `sync.test.ts` | 4 | ✅ PASS |
| `apps/server` | `blobs.test.ts` | 4 | ✅ PASS |
| `apps/pwa` | `area-guard.test.ts` | 6 | ✅ PASS |
| `apps/pwa` | `logger.test.ts` | 9 | ✅ PASS |
| `apps/pwa` | `blobs.test.ts` | 5 | ✅ PASS |
| `apps/pwa` | `router.test.ts` | 20 | ✅ PASS |
| `apps/pwa` | `photo-repo.test.ts` | 8 | ✅ PASS |
| **合计** | **9 文件** | **88 tests** | **88 passed / 0 failed** |

---

## 三、功能回归结果

### TC-01 Settings 保存错误友好提示（PR #68）

**方式**：代码审查 `apps/pwa/src/ai/router.ts` `setAiConfig()` + `apps/pwa/src/pages/Settings.tsx`

**结论**：✅ PASS

- `setAiConfig()` 对 `TypeError`（failed to fetch / NetworkError）分 HTTPS 与 HTTP 两种场景给出中文 hint：
  - HTTPS：`"网络错误（混合内容或证书未信任）：确认服务端已启用 TLS（KEEPSAKE_TLS=1）且证书已信任"`
  - HTTP：`"网络错误：服务端不可达，请确认本地服务器已启动"`
- Settings 页将 `result.error` 直接展示到 UI，不再只显示 "failed to fetch"。

---

### TC-02 DeepSeek provider 默认（PR #70）

**方式**：代码审查 `router.ts` + `router.test.ts`（20 个单测全过）

**结论**：✅ PASS

- `getEffectiveProvider(cfg)` 逻辑：cfg 无 provider 字段 → `openrouter`（兼容老用户），有 provider 字段则使用配置值。
- 新安装用户在 Settings 页 provider 默认选 `deepseek`（UI 代码 `apps/pwa/src/pages/Settings.tsx` 中 `provider` state 默认为 `'deepseek'`）。
- `recognize()`（图像识别）：provider=deepseek 时不 throw，返回 `{ status: 'pending', items: [] }` 并 logger.warn，优雅降级 ✅。

---

### TC-03 OpenRouter 老用户兼容（PR #70）

**方式**：代码审查 `getEffectiveProvider()`

**结论**：✅ PASS

- 老用户 IndexedDB 中 `{ mode:'on', apiKey:'sk-or-...' }` 无 provider 字段，`cfg.provider ?? 'openrouter'` 自动识别为 openrouter，功能不受影响。

---

### TC-04 notes/expires_at 字段同步（PR #69）

**方式**：curl push → pull 实测

```
POST /sync/push  { kind:'upsert', table:'item', row:{ notes:'家庭装促销买的', expires_at:1798761600000, ... } }
→ 200 accepted
GET  /sync/pull?since=0
→ changes[0].row.notes == '家庭装促销买的'  ✓
→ changes[0].row.expires_at == 1798761600000 ✓
```

**结论**：✅ PASS — 字段完整 round-trip。

---

### TC-05 parseItemsFromText 全链路（PR #71）

**方式**：OpenRouter API 直接调用（`.openrouter-image.env` 存在，key 有效）

**输入**：`"买了3罐可乐，2026年底过期，顺丰超市买的。还有两包薯片，备注是孩子零食"`

**返回**：
```json
{"items":[
  {"name":"可乐","qty":3,"expires_at":"2026-12-31","notes":"顺丰超市买的"},
  {"name":"薯片","qty":2,"expires_at":null,"notes":"孩子零食"}
]}
```

**结论**：✅ PASS — name/qty/expires_at/notes 均正确抽取。`parseVoiceText` 已确认为 `parseItemsFromText` 的别名（alias，测试覆盖）。

---

### TC-06 文字录入页路由 `/areas/:id/text`（PR #73）

**方式**：代码审查 `apps/pwa/src/app/router.tsx` + `apps/pwa/src/pages/TextInput.tsx`

**结论**：✅ PASS

- `{ path: 'areas/:areaId/text', element: <TextInputPage /> }` 已注册。
- TextInputPage 流程：输入文字 → `parseItemsFromText` → 草稿列表（可编辑 name/qty/expiresDate/notes/selected）→ 确认 → `ItemRepo.create()` → 跳回 Area 页。

---

### TC-07 旧 `/areas/:id/voice` redirect（PR #73）

**方式**：代码审查 `apps/pwa/src/app/router.tsx`

**结论**：✅ PASS

```tsx
{ path: 'areas/:areaId/voice', element: <VoiceRedirect /> }
// VoiceRedirect: <Navigate to={`/areas/${areaId}/text`} replace />
```

路由 `/areas/:id/voice` → redirect 到 `/areas/:id/text`，不 404。

---

### TC-08 区域照片（拍照降级，PR #72）

**方式**：代码审查 `apps/pwa/src/pages/Capture.tsx`

**结论**：✅ PASS

- Capture 页头注释明确：`拍照 / 选图 → 压缩 → 存入 IndexedDB photos 表（parent_type='area'）`。
- `await PhotoRepo.create({ type: 'area', id: areaId }, b.blob)` → 成功后 navigate 回 Area 页。
- 无任何 AI 识别调用，纯存档逻辑。

---

### TC-09 Area 页入口改造（PR #75）

**方式**：代码审查 `apps/pwa/src/pages/Area.tsx`

**结论**：✅ PASS

- 「语音输入」按钮已移除，无相关 Link。
- 新入口两个：
  - `📝 录入物品` → `to="/areas/:id/text"` (emerald 主色调按钮)
  - `📷 区域照片` → `to="/areas/:id/capture"` (slate 次要按钮)
- 区域照片缩略图：`photos.length > 0` 时渲染 `<img>` 或 placeholder，20×20 圆角格子。

---

### TC-10 DeepSeek 无 vision 降级（PR #70）

**方式**：代码审查 + 单测（`router.test.ts` 涵盖）

**结论**：✅ PASS

`recognize()` 中：
```ts
if (provider === 'deepseek') {
  logger.warn('vision_not_supported', ...);
  return { status: 'pending', items: [] };
}
```
不 throw，前端收到 `pending` 状态，可正常降级处理。

---

### TC-11 .deepseek.env 实测（跳过）

`.deepseek.env` 文件不存在，按测试指引跳过，不开 issue。

---

## 四、server API 测试汇总

| 接口 | 测试 | 预期 | 实际 | 结果 |
|------|------|------|------|------|
| `PUT /settings/ai` (provider=deepseek) | curl | 200 `{ok:true}` | 200 `{ok:true}` | ✅ |
| `PUT /settings/ai` (provider=openrouter) | curl | 200 `{ok:true}` | 200 `{ok:true}` | ✅ |
| `PUT /settings/ai` (缺 mode) | curl | 400 含 fieldErrors | 400 `{error:"请求体校验失败",details:{fieldErrors:{mode:["Required"]}}}` | ✅ |
| `GET /settings/ai` | curl | 返回已保存 config | 正确返回 provider/apiKey/mode | ✅ |
| `POST /sync/push` (含 notes/expires_at) | curl | 200 accepted | 200 `{accepted:[id]}` | ✅ |
| `GET /sync/pull` (验证字段) | curl | notes/expires_at 完整 | 字段完整 round-trip | ✅ |

---

## 五、发现的 Bug

**本轮未发现新 Bug。** 所有 88 个自动化测试通过，API 实测结果符合预期，代码审查逻辑正确。

---

## 六、未覆盖盲区

| 盲区 | 原因 | 风险评估 |
|------|------|---------|
| DeepSeek key 实际 chat completions 调用 | 无 `.deepseek.env`，按约定跳过 | 中：逻辑与 OpenRouter 路径对称，风险低 |
| Android 内网实机测试（TC-01 混合内容场景） | CI 环境无真实移动设备 | 低：代码逻辑分支已覆盖，UI 提示文案已就位 |
| TextInput 草稿编辑→入库的 E2E 流程 | 无 Playwright/真实浏览器 | 中：组件逻辑已审查，`ItemRepo.create()` 调用正确 |
| 区域照片 blob URL 释放（内存泄漏） | 需浏览器环境验证 | 低：有 `useEffect` cleanup，常见模式 |
| Settings 页 provider 切换后旧 key 残留 | 需手动交互测试 | 低：UI 分字段显示，不会混淆 |

---

## 七、建议下一轮重点

1. **E2E 测试补全**：为 TextInput 完整流程（输入→解析→草稿→入库→列表可见）添加 Playwright 测试用例。
2. **DeepSeek 实测**：获取测试 key 后补充 TC-11（parseItemsFromText via DeepSeek + chat completions ping）。
3. **Settings 表单状态**：provider 切换时，考虑清空/隐藏另一方 key 输入框，防止保存时 key 字段混乱。
4. **Area 页照片数量上限**：Capture 页无最大照片数限制，建议加前端守卫避免 IndexedDB 膨胀。
5. **sync.test.ts 补充 notes/expires_at 用例**：当前服务端测试无该字段断言，建议追加一个专项测试。

---

## 八、总结

| 指标 | 数值 |
|------|------|
| 自动化测试 | 88 passed / 0 failed |
| 功能回归项 | 11 项（10 PASS，1 跳过） |
| 新发现 Bug | **0** |
| API 实测接口 | 6 个全部通过 |
| OpenRouter 实测 | parseItemsFromText PASS（含 expires_at/notes 字段） |

大重构第 4 轮（PR #68–#75）全部功能符合预期，可继续进入下一迭代。

---

后台进程已清理（端口 8443 空闲）
