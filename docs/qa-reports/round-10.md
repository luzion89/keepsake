# Round-10 QA 验收报告

**日期**：2026-05-08  
**验收范围**：  
- #88 视觉重构 v2（PR #91 Token+Shell / #92 Home+Room+Area / #93 TextInput+Item / #94 Search+Settings）  
- #89 搜索 AI answer GUID bug（PR #90）

---

## 一、覆盖范围

| 模块 | PR | 测试方式 | 结论 |
|------|-----|----------|------|
| 全局 Design Token + Shell（header/nav） | #91 | e2e visual-tokens + 截图 | ✅ 正常 |
| Home / Room / Area 页视觉重构 | #92 | e2e crud + mobile-layout + 截图 | ✅ 正常 |
| TextInput + Item 页视觉重构 | #93 | e2e text-input-modes + 截图 | ✅ 正常 |
| Search + Settings 视觉重构 | #94 | e2e settings + 截图 | ✅ 正常 |
| 搜索 AI GUID bug fix | #90 | e2e search-no-guid（新增） | ⚠️ **发现防御层缺失，已修复** |

---

## 二、测试统计

### E2E（Playwright）
| 轮次 | 用例数 | 结果 |
|------|--------|------|
| round-9 | 25 | 25 passed |
| **round-10** | **31** | **31 passed** |

新增 spec：
- `e2e/visual-tokens.spec.ts`（5 个用例）：验证 rounded-2xl、header、nav、搜索 rounded-xl、Settings 标题
- `e2e/search-no-guid.spec.ts`（1 个用例）：防御性测试 — mock AI 返回带 `[guid]` 的 answer，断言页面不渲染

### Unit
| 包 | 用例数 | 结果 |
|----|--------|------|
| packages/shared | 28 | ✅ 28 passed |
| apps/pwa | 54 | ✅ 54 passed |
| apps/server | 12 | ✅ 12 passed |

**总计：94 个单元用例全部通过**

---

## 三、截图描述（375×667 移动端）

### 01 — Home 页（空状态）
- 顶部 header：`🗂️ Keepsake` logo + 右侧搜索/设置图标，深色背景清晰
- 添加房间区：输入框 rounded-xl，"添加" 按钮 sky-500 蓝色，视觉突出
- 预设房间快捷 chip：`+ 厨房` 等 pill 样式，整齐排列
- 空状态：房子图标 + "还没有房间" 提示，友好
- 底部 nav：房间/搜索/设置三项，图标+文字，当前页 sky-400 高亮
- **整体评价：优雅，深色主题统一**

### 02 — Home 页（有房间卡片）
- 房间卡片：`rounded-2xl`（区别于旧版 `rounded-xl`），深色背景+细边框
- 卡片右下角 `→` 箭头，引导进入
- 计数 "我的房间 (1)" 显示正常

### 03 — Room 页
- breadcrumb：`房间 › QA客厅`，层级清晰
- h1 大标题，下方"添加区域"表单结构清晰
- 预设区域 chip（洗手台柜子/墙壁柜/电视柜等）
- 区域空状态有纸箱图标

### 04 — Room 页（有区域）
- 区域行：纸箱图标 + 区域名，右侧 × 删除按钮，hover 可见
- 区域计数正确

### 05 — Area 页（加载完成）
- 「📝 录入物品」sky-500 全宽主按钮，视觉权重最高
- 「📸 区域照片」次级按钮，对比适当
- 折叠「手动添加单个物品」 section，节省空间
- 物品空状态纸箱图标 + 文案

### 06 — Area 页（手动添加展开）
- 物品名输入框 + 数量输入框 + "添加" 按钮，三列布局合理
- 375px 宽度内无溢出（e2e mobile-layout 已验证）

### 07 — Area 页（有物品）
- 物品行：名称粗体 + 数量 `− 1 +` 步进器 + × 删除，行高适中，可点
- 物品计数 "(1)" 准确

### 08 — Item 详情页
- 物品名 h1，下方 `1`（qty，sky-400 大字）
- 编辑/删除按钮，编辑灰底、删除 rose 边框，颜色语义正确
- 提醒规则 section 有"+ 添加提醒"
- **视觉问题（轻微）**：qty "1" 单独一行显示，没有数量单位/标签，可能让新用户困惑（不是 bug，是设计决策）

### 09 — TextInput 页
- 增改/覆盖模式 toggle，当前 sky 高亮
- AI hint 文案
- 文本输入区占位 placeholder 清晰
- 解析/清空按钮，蓝/灰区分

### Search 页
- 搜索栏 sticky，输入框 rounded-xl
- 语音图标 🎙 按钮存在
- AI 未启用时无 "✨ AI 回答" 按钮（符合预期）

### Settings 页
- AI 助手 section：启用/关闭 radio 组
- 保存设置按钮 sky-500 全宽
- 本地服务器 section：检测/同步按钮
- 布局清晰，sticky 保存按钮不遮挡内容（e2e 已验证）

---

## 四、发现的 Bug

### 🔴 BUG-1：#89 防御层缺失 — AI 不听话时 GUID 仍会渲染（**已修复**）

**发现方式**：新增 `search-no-guid.spec.ts` 防御性测试  
**复现**：mock AI 返回 `answer: "消毒水放在储物柜 [abc12345-bad0-guid-test-000000000000] 里"`  
**症状**：`[abc12345-bad0-guid-test-000000000000]` 字符串出现在页面可见文本中  
**根因**：PR #90 仅在 prompt 层要求 AI 不输出 id，但未在客户端做字符串清洗  
**修复**：在 `apps/pwa/src/ai/router.ts` `searchAnswer()` 函数解析回答后，增加客户端防御性正则替换：

```ts
// 防御性清理：即使 AI 不遵守 prompt 约定，也剥除 answer 中的 [id] 标记
const rawAnswer = typeof parsed.answer === 'string' ? parsed.answer : '（无回答）';
const cleanAnswer = rawAnswer.replace(/\[[^\]]{8,}\]/g, '').replace(/\s{2,}/g, ' ').trim();
```

**测试验证**：修复后 search-no-guid.spec.ts 通过，全套 31 e2e 全绿

---

## 五、与 round-9 对比

| 指标 | round-9 | round-10 | 变化 |
|------|---------|---------|------|
| e2e 用例数 | 25 | 31 | +6 |
| e2e 通过率 | 100% | 100% | 持平 |
| unit 用例数 | 94 | 94 | 持平 |
| 新发现 bug | 0 | 1（已修复）| — |
| 后端 API 契约 | — | PUT /settings/ai 含 provider ✅ | — |

---

## 六、视觉评估

| 页面 | 评分 | 备注 |
|------|------|------|
| Home | ⭐⭐⭐⭐⭐ | 整洁，快捷 chip 好用 |
| Room | ⭐⭐⭐⭐⭐ | breadcrumb + 预设 chip 清晰 |
| Area | ⭐⭐⭐⭐⭐ | 主次按钮视觉层次正确 |
| Item | ⭐⭐⭐⭐☆ | qty 大字显示风格强烈，无单位标签略怪 |
| TextInput | ⭐⭐⭐⭐⭐ | 模式切换直观 |
| Search | ⭐⭐⭐⭐⭐ | sticky 搜索栏体验好 |
| Settings | ⭐⭐⭐⭐⭐ | 布局清晰，保存 sticky 正常 |

**总体：视觉重构成功，深色主题统一，rounded-2xl/rounded-xl 层级语义清晰，移动端 375px 无溢出。**

---

## 七、下一轮建议

1. **Item 详情页 qty 显示**：考虑加数量单位标签或 `×` 前缀，避免数字孤立
2. **Area 页加载速度**：首次进入 area 页有约 0.5-1s "加载中..." 闪烁，可考虑骨架屏或 suspense
3. **GUID 清洗正则**：当前 `{8,}` 可能误删用户输入的 8 字符以上方括号内容（小概率），可考虑用 UUID 格式正则精确匹配
4. **视觉回归测试**：引入 Playwright 截图对比（`toHaveScreenshot`）防止未来重构破坏视觉

---

## 八、后台进程清理

```
lsof -ti:5173 -ti:4173 -ti:8443 -ti:8765 | xargs kill 2>/dev/null
```
✅ 已执行，所有临时进程已终止，临时 DB 文件由各测试自动清理。
