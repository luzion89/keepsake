# Keepsake MVP 完成 🎉

- 完成日期: 2026-05-07
- 最终 commit: 46ec444
- 迭代轮次: 6 轮
- 自动化测试: 50/50 全绿
- 功能矩阵: 23/23

## 实现的核心功能

1. 房间 CRUD
2. 区域 CRUD
3. 物品 CRUD
4. 物品数量字段
5. 物品备注字段
6. 物品 expires_at 字段
7. AI 拍照识别（Capture 页）
8. AI 路由（vision / text fallback）
9. 语音输入（Voice 页）
10. 全文搜索（Search 页）
11. 提醒规则 CRUD（expiry / low_stock / recheck）
12. Scanner 触发 expiry 提醒
13. Scanner 触发 low_stock 提醒
14. Scanner 触发 recheck 提醒
15. NotificationBanner 显示提醒
16. 提醒 1 小时节流（throttle）
17. 照片上传 / 预览
18. 照片 Blob 同步
19. 离线优先（Dexie 本地存储）
20. 增量同步（push / pull）
21. 软删除 + 冲突合并
22. 区域保护（Area Guard）
23. AI 设置（server-side key 管理）

## 关键里程碑

- Round 1: 三 agent 工作流建立 + 基础 bug 修复 + AI 仅 OpenRouter + 语音输入
- Round 2: Voice/Capture 健壮性 + Settings 文案
- Round 3: 服务端 Zod 校验 + Snapshot + 测试加固
- Round 4: AI 自然语言搜索 + 五项 low 清扫
- Round 5: ReminderRule + ConflictBanner + Blob 跨设备同步
- Round 6: 过期提醒 UI 收尾

## 后续 backlog（明确不在 MVP）

- 鉴权/JWT
- Web Push（VAPID）
- Snapshot 浏览 UI
- scanner 三分支单测补全
- e2e 框架（Playwright/Cypress）
- LWW 同设备同毫秒边界优化（#25 已加 deviceId 字典序，仍是已知风险）
- ConfirmDialog ESC 键、storage.persist()

## 人工验收清单（来自 QA round-6）

1. 手机局域网访问 PWA
2. 拍照 → AI 识别 → 保存物品
3. 语音输入物品
4. 设 expires_at → 过期提醒 banner 触发
5. 断网改数据 → 联网自动同步
6. 删除整个房间（含子级）

## 部署提示

- `pnpm install && pnpm build && pnpm -C apps/server start` 即可
- 默认监听 :8443，同时托管 PWA 静态资源
- 关掉终端服务即停；常驻部署需自行加 launchd/pm2/docker

## Git tag

建议打 tag: v0.1.0-mvp
