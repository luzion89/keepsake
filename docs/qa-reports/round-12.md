# Round-12 QA 报告 — PWA 专项测试
**日期：** 2026-05-08  
**覆盖：** PWA 功能专项（manifest / SW / 离线 / icons / meta 标签）  
**验收人：** QA Agent  
**测试工具：** Playwright e2e (`e2e/pwa.spec.ts`)  
**测试环境：** Chromium (Pixel 5 375×667) / `vite preview` 构建产物

---

## 1. 测试结果总览

| 类别 | 用例数 | 通过 | 失败 | 备注 |
|------|--------|------|------|------|
| Manifest 完整性 | 6 | 6 | 0 | |
| HTML meta 标签 | 3 | 3 | 0 | apple-mobile-web-app-capable 缺失（见问题列表） |
| Service Worker | 3 | 3 | 0 | |
| 离线访问 | 1 | 1 | 0 | |
| display:standalone | 1 | 1 | 0 | |
| 缓存策略 | 1 | 1 | 0 | |
| **合计** | **15** | **15** | **0** | |

**总结：全部 15 用例通过 ✅**

---

## 2. PWA 功能评估

### 2.1 Manifest 字段
| 字段 | 值 | 状态 |
|------|----|------|
| `name` | `Keepsake` | ✅ |
| `short_name` | `Keepsake` | ✅ |
| `description` | `Family storage memory` | ⚠️ 英文，建议改为中文 |
| `start_url` | `/` | ✅ |
| `display` | `standalone` | ✅ |
| `theme_color` | `#0f172a` | ⚠️ 与实际主题色（米色暖调）不符，建议更新 |
| `background_color` | `#0f172a` | ⚠️ 同上，应改为 `#F1EDE6` |
| `scope` | `/` | ✅ |
| `icons 192×192` | ✅ | |
| `icons 512×512` | ✅ | |
| `icons maskable` | ✅ | |

### 2.2 Service Worker
- 注册状态：**active**（Workbox generateSW 模式）
- 预缓存：14 个文件（516 KB），包含 HTML/CSS/JS/图标
- 运行时缓存策略：
  - `/blobs/*` → CacheFirst（有效期 30 天，最多 200 条）
  - `/sync/*` → NetworkFirst（5s 超时）

### 2.3 离线访问
- ✅ 断网后刷新页面，React App Shell 正常加载（非 Chrome 恐龙页）
- ✅ IndexedDB 数据在离线状态下仍可读取（本地优先架构）
- ⚠️ 离线状态下与 `/health` `/sync` 的请求会失败（正常，有 ECONNREFUSED 提示）

### 2.4 iOS PWA
- ⚠️ **缺失 `apple-mobile-web-app-capable`** meta 标签  
  Safari 需要此标签才能在「添加到主屏幕」后以全屏模式启动（而非浏览器模式）
- ⚠️ **缺失 `apple-touch-icon`** 链接  
  iOS 主屏幕图标需要单独的 `<link rel="apple-touch-icon">`

---

## 3. 发现的问题

| 编号 | 类型 | 描述 | 优先级 |
|------|------|------|--------|
| QA-P1 | bug/chore | `theme_color`/`background_color` 与实际主题色不符（dark slate vs 米色暖调）| Med |
| QA-P2 | chore | 缺少 `apple-mobile-web-app-capable` 和 `apple-touch-icon`，iOS 安装体验受影响 | Med |
| QA-P3 | chore | `description` 字段为英文（`Family storage memory`），建议改为中文或中英双版本 | Low |

---

## 4. 可测但未覆盖的项目

| 项目 | 原因 | 建议 |
|------|------|------|
| `beforeinstallprompt` 安装提示 | 需要真实 HTTPS 环境 + Chrome 满足安装标准才触发 | 手动测试：用 mkcert HTTPS 环境验证 |
| Push 通知 | 项目当前未实现 Push 通知功能 | 不在范围内 |
| 安装后图标显示 | 需要真实设备 + 系统主屏幕 | 建议 PM 手动验证 |
| Lighthouse PWA 评分 | 需要 HTTPS 环境（HTTP 下部分检查不通过）| 用 `npx lighthouse --preset=desktop --only-categories=pwa <HTTPS_URL>` |

---

## 5. 自动化测试文件

- 测试脚本：`apps/pwa/e2e/pwa.spec.ts`（15 个用例）
- 运行命令：`BASE_URL=http://localhost:5173 npx playwright test e2e/pwa.spec.ts`（需先 `pnpm build && pnpm preview`）

---

## PM 批注

**接受的建议：**
1. **QA-P1（theme_color 不符）** → 已开 issue #123，优先级 Med，下一轮工程改动中一并处理
2. **QA-P2（iOS apple-mobile-web-app-capable 缺失）** → 已开 issue #123，优先级 Med，影响 iOS 用户安装体验
3. **QA-P3（description 英文）** → 纳入 #118 文档审查 issue，与 README 重写同步处理

**驳回/延后的建议：**
- Push 通知：当前不在路线图内，不做
- Lighthouse 评分：本地 HTTP 无法得到准确评分，待有 HTTPS 部署环境后手动跑

**Round-12 结论：** PWA 基础架构正常（SW 注册、离线缓存、manifest 完整），可用于生产。
iOS 体验改进（#123）作为 Med 优先级在下轮处理。
