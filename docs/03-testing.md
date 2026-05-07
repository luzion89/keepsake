# Keepsake — 测试方案

> 配套：`01-plan.md`（背景与架构）、`02-implementation.md`（实现大纲）。

---

## 1. 测试矩阵

| 类别 | 工具 | 关键用例 |
|---|---|---|
| **单元** | Vitest | `merge-rules` 全分支、`outbox` 顺序、`prompts` 渲染 |
| **服务端 API** | Vitest + supertest | sync pull/push、AI 路由（mock 上游）、JWT 鉴权 |
| **前端组件** | Vitest + Testing Library | LocationTree 增删改、ConflictBanner 渲染、VoiceMicButton 状态 |
| **端到端** | Playwright | §2 场景 |
| **PWA 离线** | Playwright + `context.setOffline(true)` | §3 用例 |
| **同步并发** | 自写 fuzz：多客户端并发 push | §4 用例 |
| **iOS 真机** | Safari Web Inspector + 手测脚本 | §5 清单 |
| **AI 集成** | 录像回放 (nock) + 抽样真调用 | prompt 抗漂移 |
| **可访问性** | Chrome DevTools MCP a11y skill | 触控目标 ≥ 44px、对比度、focus ring |
| **性能** | Lighthouse PWA 评分 | ≥ 90 |

---

## 2. 关键端到端用例（Playwright）

1. **首启 → 建柜 → 加物品 → 刷新仍在**
2. **拍 3 张照（用 fixture 图片注入 `<input>`）→ Mock AI 返回 4 项 → 修改 1 项数量 → Snapshot 锁定**
3. **语音修正**：mock SpeechRecognition 触发 `onresult`，验证清单条目被替换
4. **自然语言查找**：`?q=消毒水` → 关键词命中 → 进入对话页 mock AI 回 → 显示位置卡片
5. **保质期提醒**：把系统时间推到 `due_at + 1` → 启动 App 应弹横幅

---

## 3. PWA 离线 / 同步用例

| # | 步骤 | 期望 |
|---|---|---|
| O1 | 首次访问后 SW 激活；`context.setOffline(true)` 后硬刷新 | 仍能打开主页 |
| O2 | 离线状态下新增 5 个 item | 全部入 outbox，UI 显示"待同步 5" |
| O3 | 恢复在线 → 等 ≤ 5s | outbox 清零，服务端 SELECT 能查到 5 条 |
| O4 | 手机 A 改 `name="A 版"`；手机 B 同时改 `name="B 版"`；先后联网 | 后到者写入存活；前者写入留 `conflict_log`，UI 横幅可见 |
| O5 | A `qty +2`、B `qty -1`，初始 qty=5 | 同步后服务端 `qty=6`（增量合并） |
| O6 | A 删除 item；B 编辑同一 item | 删除胜出；B 的编辑被丢弃，记录到 `conflict_log` |
| O7 | 离线拍照 → 关闭 App → 重启 → 联网 | 图片成功上传到 `/blobs`，AI 识别异步完成后 push 通知前端刷新 |

---

## 4. 同步 fuzz 测试

写一个 Node 脚本启动 N=5 个"假客户端"，随机生成 op 序列（含交叉编辑、删除、qty 增减）发送到 server，最后 pull 一次，断言：

- **收敛性**：所有客户端最终拉到的状态一致
- **正确性**：与逐条串行执行 op 的"参考实现"结果相同
- **幂等性**：同一 op 重复 push 两次结果不变

---

## 5. iOS / Android 兼容手测脚本

### iPhone（Safari 16.4+）

- [ ] "添加到主屏"图标显示正确（非黑底白字）
- [ ] 启动后地址栏隐藏（standalone）
- [ ] `<input capture>` 拍照可调起原生相机
- [ ] SpeechRecognition 可用（不可用时回退手输按钮存在）
- [ ] 进入飞行模式：能查询、能新增；切回联网 30 秒内同步
- [ ] 重启手机 7 天后重新打开 App，IDB 数据仍在
- [ ] Web Push（需添加到主屏 + 授权）能收到提醒

### Android Chrome

- [ ] 安装提示出现，安装后桌面图标可用
- [ ] BackgroundSync 触发（关闭 App → 等服务器恢复 → 数据已同步）

---

## 6. 验收命令一览

```bash
pnpm test               # vitest 全部
pnpm test:e2e           # playwright（含离线）
pnpm test:fuzz          # 同步 fuzz
pnpm lighthouse         # PWA 评分
pnpm -C apps/server test:api
```
