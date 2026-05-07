# QA Round 2 报告

- main 验证 commit: 284c2b3
- 验收 PR: #17 #18
- 关闭 issue: #5 #6 #7

## 本轮覆盖功能

- **Voice/Capture 三态加载**（#5）：areaId 空 / AreaRepo 未命中时展示明确错误页，不再卡在「加载中…」
- **save 防孤儿**（#6）：Voice 和 Capture 的 save() 在写 ItemRepo 前双重校验 areaId 非空 + AreaRepo.get 非 undefined
- **Settings AI 文案准确性**（#7）：文案与实际 setAiConfig PUT + pullAiConfigFromServer GET + LWW 实现一致

## 自动化测试结果

- shared: 6/6 ✅
- server: 4/4 ✅
- pwa: 12/12 ✅（含 router.test.ts 6 用例 + area-guard.test.ts 6 用例）

## 回归结果（逐 issue）

| issue | PR | 复测点 | 结果 |
|---|---|---|---|
| #5 | #17 | Voice.tsx / Capture.tsx 定义 `AreaState = 'loading' \| 'not-found' \| 'ok'`；areaId 空或 AreaRepo 未命中均进入 not-found 分支，UI 显示 `⚠️ 找不到该区域` + 返回首页链接 | ✅ 通过 |
| #6 | #17 | save() 先判 `!areaId` 再 `AreaRepo.get(areaId)` 两道防卫，undefined 时 setErr 并 return，不进入 ItemRepo.create | ✅ 通过 |
| #7 | #18 | Settings.tsx 第 65 行文案描述与 router.ts 的 setAiConfig（PUT /settings/ai）+ pullAiConfigFromServer（GET + LWW by updated_at）实现完全吻合，无误导性承诺 | ✅ 通过 |

## 探索性测试

- 启动本地 server（PORT=8443），curl 验证 /settings/ai 接口：
  - `GET /settings/ai` → `{"mode":"off","updated_at":0}` ✅
  - `PUT /settings/ai` body `{"mode":"on","apiKey":"sk-or-test","updated_at":1000}` → `{"ok":true}`，server 以自身时间覆盖 updated_at ✅
  - 再次 `GET /settings/ai` → `{"mode":"on","apiKey":"sk-or-test","updated_at":<server_ts>}` ✅
- Settings 文案「更新时间最新者胜」中的 LWW 策略与实现吻合；server 端 updated_at 以写入时刻覆盖客户端传入值，符合预期

## 新发现 bug

- 无

## 未覆盖的盲区

- 当前没有 e2e/UI 自动化，三态加载只能 code-review 验证，无法实跑浏览器路由跳转场景
- area-guard.test.ts 中 `resolveAreaState` / `canSave` 为测试文件内独立纯函数，与页面组件逻辑的对应依赖人工比对，若组件逻辑改动未同步更新测试，覆盖会失效
- Capture.tsx 中 `aiState === 'pending'` 路径下 PhotoRepo.setRecognition 未调用（注释留空），属已知待办，未在本轮测试中覆盖
- server /settings/ai PUT 端点接收任意 JSON 写入，没有字段校验（mode 枚举、apiKey 格式等），存在潜在数据污染风险

## 下一轮建议重点

- 补充 Capture pending 路径的单元测试（PhotoRepo.setRecognition 调用断言）
- 考虑为 /settings/ai PUT 增加 Zod schema 校验，防止写入非法 mode 值
- 引入 Playwright 或 Cypress 做基础路由烟雾测试（area not-found 页、保存跳转等）
- 验证多设备场景下 AI config LWW 合并的边界（updated_at 相同时的行为）
