# Keepsake

> 家里那瓶半年前买的消毒水放哪了？Keepsake 是一款跑在家庭局域网内的物品管理应用：把"房间 → 区域 → 物品"记下来，下次想找时一秒定位。AI 可选，离线可用，单家庭单服务器。

<!-- 主截图占位：建议放一张房间列表 + 物品详情的拼图，宽度约 800px -->
![screenshot](docs/img/cover.png)

---

## 为什么要做这个

- **低频物品记忆衰减**：消毒水、备用电池、季节性衣物等，半年后基本忘记放在哪
- **现成方案太重**：Notion / Excel 需要手敲、家庭账号同步麻烦；专业仓储软件杀鸡用牛刀
- **不想把家里的隐私上云**：所有数据只存在你家服务器和你自己的设备里，AI Key 也是你自己的

## 主要特性

- 🏠 **三级层级**：房间 → 区域 → 物品（例：厨房 → 洗手台柜子 → 消毒水 × 2）
- 🤖 **AI 辅助**（可选）：用一句话描述「买了三瓶洗发水和一盒牙膏」，AI 自动结构化为物品列表
- 🔍 **自然语言搜索**（可选）：「卫生间还有创可贴吗？」AI 从所有物品里找答案并跳转
- 🔄 **多设备同步**：iOS / Android / 电脑浏览器都能改，自动推拉合并；冲突按字段级 LWW
- 📴 **离线优先**：所有 CRUD 先写本地 IndexedDB，服务器一上线就同步，没网也能用
- 💾 **自动备份**：服务端每周 `VACUUM INTO` 一份 SQLite 快照，默认保留 4 份
- 🌏 **中英双语**：UI + AI prompt 都跟随语言切换

## 技术栈速览

| 端 | 栈 |
|---|---|
| 前端 | React 18 + Vite 5 + TypeScript + Tailwind + Dexie（IndexedDB）|
| 后端 | Fastify + better-sqlite3，单进程单文件 SQLite |
| AI | DeepSeek 或 OpenRouter，**客户端直连**，Key 存本机不经过家庭服务器 |
| 同步 | 4 种 op：upsert / delete / qty_delta / patch（字段级 LWW）|
| 共享 | `packages/shared` 同步协议 + 合并规则，前后端复用 |

更多细节见 [`docs/02-implementation.md`](docs/02-implementation.md)。

---

## 快速开始

### 1. 装依赖 + 构建

```bash
pnpm install        # 含 better-sqlite3 原生编译，首次约 4 分钟
pnpm build          # 顺序 build shared / pwa / server
```

### 2. 配置 HTTPS（强烈建议）

现代浏览器在非 secure context 下会限制 fetch / IndexedDB / 摄像头权限，且 LAN IP 默认是 `http://`。用 mkcert 生成本地证书：

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

终端会打印类似：

```
╔════════════════════════════════════════════════╗
║ 🗝  Keepsake Server 已启动                       ║
╠════════════════════════════════════════════════╣
║ LAN      https://192.168.31.181:8443           ║
╚════════════════════════════════════════════════╝
```

家里所有设备的浏览器打开 LAN URL 就能用了。第一次会提示证书不被信任，按浏览器的「高级 → 继续访问」即可（或在系统里信任 mkcert 的 CA）。

> ⚠️ `localhost` 已被服务端屏蔽（避免 IndexedDB origin 不一致导致数据看似"丢失"）。统一用 LAN IP 访问。开发时如需 localhost，设 `KEEPSAKE_ALLOW_LOCALHOST=1`。

### 4. 配置 AI（可选）

进入设置页 →「AI 助手」开关 → 选 DeepSeek 或 OpenRouter → 粘贴你的 API Key → 测试连通 → 保存。

- **DeepSeek**：[deepseek.com](https://platform.deepseek.com)，价格便宜
- **OpenRouter**：[openrouter.ai](https://openrouter.ai)，可选任意兼容模型

Key 存在浏览器 IndexedDB，并自动同步到家庭服务器（其他设备启动时拉取，多设备共用同一 Key）。**Key 不经过家庭服务器之外的任何中转**。

---

## 用法演示

### 添加物品

<!-- GIF 占位：从房间列表 → 进区域 → 点 + → 输入"两瓶洗发水"→ AI 解析 → 保存，10 秒以内 -->
![add-item](docs/img/add-item.gif)

1. 房间列表点 + 创建房间（或选预设：厨房/客厅/阳台...）
2. 进入房间点 + 创建区域（或选预设：洗手台柜子/抽屉/吊柜...）
3. 进入区域：
   - **AI 模式**：点「文字输入」→ 用一句话描述「买了三瓶洗发水和一盒牙膏」→ AI 自动拆成 3 个物品
   - **手动模式**：点 + 直接录入名称、数量、单位、备注、过期日期、标签

### 找物品

<!-- GIF 占位：搜索框输入"创可贴"→ 列表展示 → 点击跳转到所在区域 -->
![search-item](docs/img/search.gif)

- 关键词搜索：物品名、备注、标签全文匹配
- AI 自然语言（开 AI 时）：直接问「客厅有没有备用电池」「上个月买的洗发水放哪了」

### 多设备同步

<!-- GIF / 截图占位：左手机右桌面，一边改另一边几秒后更新 -->
![sync](docs/img/sync.gif)

- 联网时每 60 秒或切到前台时自动同步一次
- 设置页有「同步」按钮可手动触发
- 冲突自动按字段级 LWW 合并；无法自动合并的会顶部红条提示，可选择「保留本地」或「采用云端」

### 数据导出 / 备份

- 设置 →「本机数据」→「导出」：下载完整 JSON 快照
- 服务端每周自动 `VACUUM INTO` 备份到 `apps/server/data/backups/`，默认保留 4 份
  - 间隔可改：`KEEPSAKE_BACKUP_INTERVAL_DAYS=7`
  - 保留份数可改：`KEEPSAKE_BACKUP_KEEP=4`

---

## 开发

```bash
# 终端 A：watch shared 包
pnpm -C packages/shared build -w

# 终端 B：后端 hot-reload
pnpm -C apps/server dev

# 终端 C：前端 dev server（5173，自动代理 /sync /blobs /settings 到 8443）
pnpm -C apps/pwa dev
```

### 测试

```bash
pnpm -C packages/shared test    # 合并规则、sync 协议、patch op
pnpm -C apps/pwa test           # AI router、i18n、item-repo、patch
pnpm -C apps/server test        # /sync pull/push、LWW、qty_delta、patch
```

无 e2e / Playwright，UI 验收靠人肉 + `.claude/agents/qa.md` 描述的 QA 流程。

---

## 项目结构

```
Keepsake/
├── apps/
│   ├── pwa/      # React + Vite + Dexie 前端
│   └── server/   # Fastify + better-sqlite3 后端 + 静态文件托管
├── packages/
│   └── shared/   # 类型 + 同步协议 + 合并规则（前后端共用）
└── docs/         # 项目文档（设计、实现、测试、QA 报告、演进记录）
```

---

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

---

## 文档导航

- [`docs/01-plan.md`](docs/01-plan.md) — 项目愿景、功能范围、架构、数据模型、同步协议
- [`docs/02-implementation.md`](docs/02-implementation.md) — 真实技术栈、目录、关键模块（AI router / sync / i18n / 备份）
- [`docs/03-testing.md`](docs/03-testing.md) — 测试现状（vitest）+ QA 流程
- [`docs/HTTPS-SETUP.md`](docs/HTTPS-SETUP.md) — mkcert + 安卓 CA 安装
- [`docs/storage-plan.md`](docs/storage-plan.md) — IndexedDB / Blob / 备份策略
- [`docs/explorations.md`](docs/explorations.md) — 走过的弯路（含已弃用的 PWA 方案、cloudflared 等）
- [`docs/qa-reports/`](docs/qa-reports/) — 历轮 QA 报告归档

---

## License

未指定（家用项目，自取自用）。
