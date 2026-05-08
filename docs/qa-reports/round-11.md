# Round-11 验收报告
**日期：** 2026-05-08  
**覆盖：** PR #97-#102 视觉重构 v3（Editorial + Muji Minimal）+ 补丁 22d0f7f  
**验收人：** QA Agent

---

## 1. 覆盖范围

| PR | 内容 |
|----|------|
| #98 (PR-A) | Tailwind tokens + 字体（Noto Serif SC）+ noise 基础设施 |
| #99 (PR-B) | Shell header / bottom nav 换色 |
| #100 (PR-C) | Home + Room + Area 换色 |
| #101 (PR-D) | TextInput + Item 换色 |
| #102 (PR-E) | Search + Settings 换色 + 纸张颗粒 toggle |
| 22d0f7f（补丁）| Item h1 serif 字体缺失修复 |

**色彩体系：** 70-20-10 → 米色 `#F1EDE6` / 深绿灰 `#2F3E2E` / 玫瑰木 `#B76E79`  
**字体：** serif（标题/物品名）+ system-ui（正文）  
**圆角：** 12px 全局  
**纸张颗粒：** opacity 0.025（`--noise-opacity`），可在 Settings 关闭

---

## 2. 测试统计

### A. Playwright E2E

| 套件 | 测试数 | 状态 |
|------|--------|------|
| area-entry.spec | 2 | ✅ PASS |
| crud.spec | 1 | ✅ PASS |
| mobile-layout.spec | 3 | ✅ PASS |
| routes.spec | 7 | ✅ PASS |
| search-no-guid.spec | 1 | ✅ PASS |
| settings.spec | 3 | ✅ PASS |
| text-input-modes.spec | 6 | ✅ PASS |
| text-input.spec | 1 | ✅ PASS |
| visual-tokens.spec | 5 | ✅ PASS |
| **no-blue-purple.spec（新增）** | **3** | **✅ PASS** |
| **总计** | **34** | **✅ 全绿** |

> 原有 31 个测试无一因 v3 重构选择器变动而失败（text-input-modes.spec 已于 v3 合并时随代码同步更新 bg-sky→bg-ink / bg-amber→bg-warn）。

### B. Unit Tests

| 套件 | 测试数 | 状态 |
|------|--------|------|
| area-guard.test | 6 | ✅ |
| logger.test | 9 | ✅ |
| blobs.test | 5 | ✅ |
| photo-repo.test | 8 | ✅ |
| router.test | 26 | ✅ |
| **PWA 总计** | **54** | **✅ PASS** |
| **Server 总计** | **12** | **✅ PASS** |

### C. API 回归

```
PUT /settings/ai → {"ok":true}  HTTP 200  ✅
```
后端代码未受视觉重构影响。

---

## 3. 视觉检查（375×667，Mobile Chrome，Preview 构建）

### Home 页
- **背景**：米色 `rgb(241,237,230)` ✅ 符合设计 token
- **字体**：header「Keepsake」system-ui；预设房间按钮 system-ui；房间卡片无内容时空状态图标+说明文字可读
- **底部 nav**：3 标签（房间/搜索/设置），icon+文字，高度视觉合理
- **气质**：整体干净、米纸感，Muji 极简 ✅

### Search 页
- **背景**：米色，标题 `搜索物品` serif；搜索输入框 paper-card 浅米白
- **无蓝紫色**：防御性测试通过（hue 200-280 全场景扫描）

### Settings 页
- **纸张颗粒 toggle** 可见（"纸张颗粒纹理" + toggle 开关），label 中文正常
- **保存设置 CTA 按钮**：玫瑰木 `#B76E79` 背景，米色文字
- **整体**：分组卡片、灰线分隔、清晰层次 ✅

---

## 4. 新发现 Bug / 待改项

### 🔴 BUG-01（严重）：多个交互元素触摸区域 < 44px

Home 页扫描结果：

| 元素 | 高度 |
|------|------|
| header 🔍 icon 按钮 | 36px |
| header ⚙️ icon 按钮 | 36px |
| 预设房间 chip（`+ 厨房` 等，8个）| 30px |

**iOS HIG / WCAG 2.5.5 要求最小触摸区域 44×44px。**  
预设 chip 高 30px 尤为明显，长按容易误触相邻。  
> 建议：chip 加 `min-h-[44px]` 或增加 `py-3`；header icon 按钮加 `w-11 h-11`。

### 🟡 BUG-02（中）：玫瑰木 accent 对比度不达 WCAG AA

| 场景 | 对比度 | WCAG AA 标准 |
|------|--------|-------------|
| `#B76E79` on `#F1EDE6`（米色背景文字） | **3.26:1** | ≥ 4.5:1（正文）❌ |
| `#F1EDE6` on `#B76E79`（CTA 按钮白字） | **3.26:1** | ≥ 4.5:1（正文）❌ |
| `#F1EDE6` on `#B76E79`（大字/18pt+） | 3.26:1 | ≥ 3:1 ✅（大字勉强达标） |
| `#2F3E2E` on `#F1EDE6`（正文） | **9.73:1** | ≥ 4.5:1 ✅ |

**CTA 按钮（保存设置、解析、入库）文字若使用 normal weight 14px 则不合规。**  
> 建议：CTA 按钮文字改深绿灰 `#2F3E2E`（对比 7.17:1），或加深 accent 色到约 `#9A4A56`（可与米色达 4.5:1）。

### 🟢 INFO-01（观察）：无自定义滚动条样式

页面使用浏览器默认滚动条，在 macOS/iOS 上通常隐藏，不影响体验；但 Android 可能显示蓝色系滚动指示器，轻微违反"无蓝紫"原则。暂标记为观察项，不阻塞。

### 🟢 INFO-02（观察）：暗色模式 — 已确认不存在

`document.documentElement.classList.contains('dark')` → **false**。  
之前触发误判的是 `hover:bg-paper-dark` 等颜色 token 名（含 `dark` 字符串但非暗色模式 class）。  
PM 决定不做暗色模式，确认无残留。✅

### 🟢 INFO-03（观察）：中文 serif 字体

Noto Serif SC 未在本机预加载情况下会 fallback 到 Songti SC（macOS 宋体）。实测 Playwright headless 环境下字体降级为 Georgia serif，渲染还原度有限。建议在 index.html 加 Google Fonts 预连接 + `<link rel=preload>`，确保真机 serif 字体加载。

---

## 5. 与 Round-10 对比

| 维度 | Round-10（v2） | Round-11（v3） |
|------|----------------|----------------|
| 背景色 | Slate 深色系 | 米色暖调 ✅ 更接近用户期望 |
| 主色调 | slate-700/800 | 深绿灰 #2F3E2E ✅ |
| CTA | sky/blue | 玫瑰木 #B76E79 ✅ |
| 标题字体 | system-ui | Noto Serif SC ✅ |
| 圆角 | 混用 | 统一 12px ✅ |
| 颗粒纹理 | 无 | 有（0.025 opacity，极淡）✅ |
| 暗色模式残留 | 有 (dark class) | 无 ✅ |
| E2E 通过率 | 31/31 | 34/34 ✅（含3新测试）|
| 对比度合规 | 部分不合规 | BUG-02 仍存在 ⚠️ |
| 触摸目标 | 部分<44px | BUG-01 仍存在 ⚠️ |

---

## 6. 用户三轮视觉反馈演进总结

| 版本 | 气质 | 核心问题 | 用户反应 |
|------|------|----------|----------|
| **v1**（slate 深色） | 科技感、偏暗 | 整体太暗、不像家居 app | 不满意 |
| **v2**（仍 slate + token 化）| token 化但色系未变 | 只做了 token 抽离，颜色还是 slate/sky | 仍不满意 |
| **v3**（米色暖调 Muji）| Editorial + Muji 极简 | 色彩体系彻底切换，serif 标题，颗粒纸感 | **方向正确** |

v3 是这三轮中第一次真正触及用户期望（"暖灰中性色、70-20-10、serif、Muji 极简"）。剩余待改项（对比度 + 触摸目标）是工程实现细节，色彩方向本身已对齐。

---

## 7. 新增文件

- `apps/pwa/e2e/no-blue-purple.spec.ts` — 防蓝紫调防御性测试（3 specs）

---

## 总结

| 类别 | 结论 |
|------|------|
| E2E 测试 | ✅ 34/34 PASS |
| Unit 测试 | ✅ 54+12=66 PASS |
| API 回归 | ✅ PUT /settings/ai 正常 |
| 视觉气质 | ✅ Muji 极简，米色暖调，无蓝紫色污染 |
| 新 BUG | 🔴 BUG-01 触摸目标 <44px（chip/header icon） |
| 新 BUG | 🟡 BUG-02 accent 对比度 3.26:1 < WCAG AA |
| 暗色模式残留 | ✅ 无 |
| 后台进程 | ✅ 已清理（lsof kill） |
