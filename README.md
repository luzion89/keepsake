<div align="center">

# Keepsake

**自托管的家庭物品管理 PWA —— 知道家里有什么、放在哪里。**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](./LICENSE)

[English](./README.en.md) · 简体中文

<!-- 主截图占位（建议拼接图：左边桌面端房间列表，右边手机端物品详情，宽约 800px） -->
![cover](docs/img/cover.png)

</div>

> 单家庭、单服务器设计。所有数据只在你家局域网内流转，AI Key 也是你自己的。

## 为什么会有 Keepsake

家里那瓶半年前买的消毒水放哪了？阳台上的备用电池还剩几节？换季的羽绒服塞进哪个箱子了？

这些问题听起来都是「下次我会记住的」，但事实是 —— 我们不会。低频物品的存放位置在大脑里几乎是写不进长期记忆的。

市面上的方案要么太重（Notion / Excel 要手敲、家庭账号同步麻烦），要么太轻（拍张照片塞在相册里再也找不到），要么太重云（专业仓储管理软件、还要把家里有什么告诉别人的服务器）。

Keepsake 走另一条路：

- **就跑在你家**：一个 SQLite 文件 + 一个 Fastify 服务，丢在常开机的电脑或 NAS 上，全家设备通过局域网访问
- **离线优先**：所有 CRUD 先写浏览器 IndexedDB，服务器一上线就同步；没网也能用
- **AI 是配料不是主菜**：可选接 DeepSeek / OpenRouter，让你说一句「买了三瓶洗发水和一盒牙膏」就自动结构化；不接也照样手动管理
- **隐私是默认**：AI Key 存在你浏览器里，请求**直接打到 AI 厂商**，不经过家庭服务器之外的任何中转。物品数据从不出局域网

## 主要特性

**📦 物品管理**
- 三级层级：房间 → 区域 → 物品（例：厨房 → 洗手台柜子 → 消毒水 × 2）
- 预设房间/区域名称（厨房、阳台、洗手台柜子、抽屉…），一键添加
- 物品支持名称、数量、单位、备注、过期日期、标签、照片

**🤖 AI 辅助**（可选）
- **自然语言录入**：「买了三瓶洗发水和一盒牙膏」→ 自动拆成 3 个物品
- **自然语言搜索**：「卫生间还有创可贴吗？」→ AI 从所有物品里找答案
- 支持 DeepSeek（便宜）和 OpenRouter（模型多）

**🔄 多设备同步**
- iOS / Android / 电脑浏览器都能改，自动推拉合并
- 4 种同步操作（upsert / delete / qty_delta / patch），字段级 LWW
- 联网时每 60 秒或切到前台时自动触发；冲突顶部红条提示，可手动选择保留方

**📴 离线 & 备份**
- IndexedDB 本地优先，断网也能查询和编辑
- 服务端每周 `VACUUM INTO` 一份 SQLite 快照，默认保留 4 份
- 设置页一键导出 JSON 全量备份

**🌏 双语**
- UI 中英文切换
- AI 的 system prompt 同步切换语言

## 技术栈

| 端 | 栈 |
|---|---|
| 前端 | React 18 + Vite 5 + TypeScript + Tailwind + Dexie（IndexedDB）|
| 后端 | Fastify + better-sqlite3，单进程单文件 |
| AI | DeepSeek 或 OpenRouter，**客户端直连** |
| 共享 | `packages/shared` 同步协议 + 合并规则，前后端复用 |

更多细节：[`docs/02-implementation.md`](docs/02-implementation.md)

## 快速开始

### 1. 装依赖 + 构建

```bash
pnpm install        # 含 better-sqlite3 原生编译，首次约 4 分钟
pnpm build          # 顺序 build shared / pwa / server
```

### 2. 配置 HTTPS（强烈建议）

现代浏览器在非 secure context 下会限制 fetch / IndexedDB / 摄像头权限。用 mkcert 给局域网 IP 签个本地证书：

```bash
brew install mkcert nss
mkcert -install
cd apps/server && mkdir -p certs && cd certs
mkcert -cert-file dev-cert.pem -key-file dev-key.pem \
  192.168.x.x localhost 127.0.0.1
```

详见 [`docs/HTTPS-SETUP.md`](docs/HTTPS-SETUP.md)（含安卓 CA 安装方法）。

### 3. 启动

```bash
KEEPSAKE_TLS=1 pnpm start
```

终端会打印：

```
╔════════════════════════════════════════════════╗
║ 🗝  Keepsake Server 已启动                       ║
╠════════════════════════════════════════════════╣
║ LAN      https://192.168.31.181:8443           ║
╚════════════════════════════════════════════════╝
```

家里所有设备的浏览器打开 LAN URL 即可使用。

> ⚠️ `localhost` 已被服务端屏蔽（避免 IndexedDB origin 不一致导致数据看似"丢失"）。统一用 LAN IP 访问。开发时如需 localhost，设 `KEEPSAKE_ALLOW_LOCALHOST=1`。

### 4. 配置 AI（可选）

进入设置页 →「AI 助手」开关 → 选 DeepSeek 或 OpenRouter → 粘贴你的 API Key → 测试连通 → 保存。Key 会自动同步到家庭服务器（其他设备启动时拉取，多设备共用同一份 Key）。

## 用法演示

### 添加房间 / 区域 / 物品

<!-- GIF 占位：从空房间列表 → 点 + → 选「厨房」预设 → 进入 → 加「洗手台柜子」→ 点「文字输入」→ AI 解析 -->
![add-item](docs/img/add-item.gif)

### 查找物品

<!-- GIF 占位：搜索框输入"创可贴"→ 列表展示 → 点击跳转到所在区域 -->
![search-item](docs/img/search.gif)

### 多设备同步

<!-- GIF 占位：左手机右桌面，一边改另一边几秒后更新 -->
![sync](docs/img/sync.gif)

## 项目结构

```
Keepsake/
├── apps/
│   ├── pwa/      # React + Vite + Dexie 前端
│   └── server/   # Fastify + better-sqlite3 后端
├── packages/
│   └── shared/   # 类型 + 同步协议 + 合并规则
└── docs/         # 设计、实现、测试、QA 报告、演进记录
```

## 开发

```bash
# 终端 A：watch shared 包
pnpm -C packages/shared build -w

# 终端 B：后端 hot-reload
pnpm -C apps/server dev

# 终端 C：前端 dev server (5173, 自动代理 /sync /blobs /settings 到 8443)
pnpm -C apps/pwa dev
```

### 测试

```bash
pnpm -C packages/shared test    # 合并规则、sync 协议、patch op
pnpm -C apps/pwa test           # AI router、i18n、item-repo、patch
pnpm -C apps/server test        # /sync pull/push、LWW、qty_delta、patch
```

无 e2e / Playwright，UI 验收靠人肉 + [`.claude/agents/qa.md`](.claude/agents/qa.md) 描述的 QA 流程。

## 环境变量（服务端）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8443` | 监听端口 |
| `KEEPSAKE_DB` | `./data/keepsake.sqlite` | 数据库文件路径 |
| `KEEPSAKE_TLS` | 未设置 | `1` 启用 HTTPS（需配 mkcert 证书）|
| `KEEPSAKE_TLS_CERT` | `apps/server/certs/dev-cert.pem` | 自定义证书路径 |
| `KEEPSAKE_TLS_KEY` | `apps/server/certs/dev-key.pem` | 自定义私钥路径 |
| `KEEPSAKE_BACKUP_INTERVAL_DAYS` | `7` | 自动备份间隔天数 |
| `KEEPSAKE_BACKUP_KEEP` | `4` | 保留备份份数 |
| `KEEPSAKE_ALLOW_LOCALHOST` | 未设置 | `1` 允许 localhost 访问 SPA（仅开发用） |
| `LOG_LEVEL` | `info` | Fastify 日志级别 |

## 文档导航

- [`docs/01-plan.md`](docs/01-plan.md) — 项目愿景、功能范围、架构、数据模型、同步协议
- [`docs/02-implementation.md`](docs/02-implementation.md) — 技术栈、目录、关键模块（AI router / sync / i18n / 备份）
- [`docs/03-testing.md`](docs/03-testing.md) — 测试现状 + QA 流程
- [`docs/HTTPS-SETUP.md`](docs/HTTPS-SETUP.md) — mkcert + 安卓 CA 安装
- [`docs/storage-plan.md`](docs/storage-plan.md) — IndexedDB / Blob / 备份策略
- [`docs/explorations.md`](docs/explorations.md) — 走过的弯路（含已弃用的 PWA 方案、cloudflared 等）
- [`docs/qa-reports/`](docs/qa-reports/) — 历轮 QA 报告归档

## 路线图

参见 [GitHub Issues](https://github.com/luzion89/keepsake/issues)。当前重点：

- 完整 e2e 测试（暂用人肉 + QA agent）
- 物品照片识别（DeepSeek 不支持视觉，等 OpenRouter 视觉模型稳定）
- 移动端进一步优化

## License

[MIT](./LICENSE) © 2026 luzion89

家用项目，欢迎 fork 折腾。如果对你也有用，给个 ⭐ 让我知道。
