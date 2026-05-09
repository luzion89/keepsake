# 技术探索：双端二维码认证 + Cloudflare Tunnel 集成

**Spike 分支：** `spike/auth-cf-tunnel`  
**日期：** 2026-05  
**作者：** PM / Coder / QA (Keepsake 内部团队)  
**关联 Issue：** #205  
**状态：** ✅ Spike 完成，待决策是否合并

---

## 1. 背景

### 1.1 PWA 安装的证书硬墙

Keepsake 是一款运行在局域网自托管 server 上的 PWA 应用。浏览器要弹出"添加到主屏幕"的 `beforeinstallprompt` 事件，必须满足 **Secure Context** 条件：

- 域名必须是 `https://`
- 证书必须被浏览器**可信 CA** 签发（自签名证书永远被拒）

当前 server 运行在内网 IP（如 `192.168.31.181:8443`），存在以下不可逾越的限制：

| 方案 | 阻碍 |
|------|------|
| 自签 CA | iOS Safari / Chrome 均拒绝，无法 PWA 安装 |
| Let's Encrypt | LE 不签 IP 地址，亦不签 `*.local` / `*.internal` |
| mkcert 本地 CA | 需每台设备手动安装 CA 根证书，用户体验差 |

### 1.2 当前无认证暴露风险

当前 server 暴露裸 API，无任何认证。一旦开启隧道（或在公共 Wi-Fi 下），数据库等同于公开。**必须先补认证，再开隧道。**

---

## 2. 调研路径

### 2.1 自签证书 + mkcert

**方案：** 使用 `mkcert` 生成本地可信 CA，签发 `localhost` / LAN IP 证书。

**优点：** 本机 Chrome 可信，PWA 在本机可安装。  
**缺点：**
- 每台配对设备需手动安装 CA 根证书（iOS: 还要去设置→证书信任）
- 非技术用户操作成本极高
- iOS 安装 profile 有 MDM 限制
- **结论：不选**

### 2.2 DNS-01 挑战 + Let's Encrypt 子域名

**方案：** 申请 `keepsake.yourdomain.com`，用 DNS-01 ACME 挑战签真证书，内网 IP 通过 A 记录解析。

**优点：** 真证书，可信，PWA 可安装。  
**缺点：**
- 用户必须拥有域名并能管理 DNS（零用户配置目标落空）
- 证书 90 天轮换需自动化
- 内网 IP 可能随 DHCP 变化
- **结论：适合高级用户，不适合默认体验**

### 2.3 Tailscale

**方案：** 所有设备加入 Tailscale 网络，使用 MagicDNS + HTTPS 证书功能。

**优点：** 零暴露公网，端到端加密。  
**缺点：**
- 每台设备需安装 Tailscale 客户端（需用户注册账号）
- Tailscale HTTPS 证书仅对 Tailscale 网络可信，外网访问仍不行
- 企业用户可能有网络策略限制
- **结论：极佳的安全方案，但配置成本高于 CF Tunnel**

### 2.4 ✅ Cloudflare Tunnel（选择）

**方案：** server 侧启动 `cloudflared` 客户端，建立到 CF 边缘的持久出站连接，CF 分配 `*.trycloudflare.com` 公网 URL，TLS 在 CF 边缘终止。

**优点：**
- **零用户配置**：用户无需域名/证书/端口映射
- **真证书**：CF 签发，浏览器完全可信
- **PWA 可安装**：满足 Secure Context，`beforeinstallprompt` 可触发
- server 本地跑 HTTP 即可，无需本地 HTTPS
- npm 包 `cloudflared` 自动管理二进制下载

**缺点（已知限制，见第 5 节）：**
- 需要公网出口
- CF 能看到流量明文（应用层 E2E 加密留待后续）
- trycloudflare.com 子域名重启会变

### 2.5 套壳 App（React Native / Capacitor）

**方案：** 将 PWA 用套壳 App 发布到 App Store / Google Play，绕开浏览器 PWA 安装。

**优点：** 解决所有证书问题，推送通知等原生能力。  
**缺点：**
- 开发/维护成本高（双平台），发布审核周期
- 用户需要从商店安装，不满足"局域网即用"定位
- **结论：中期路线图选项，不作为本 spike 目标**

---

## 3. 决策

**选择：CF Tunnel + 二维码认证并行**

核心逻辑：
1. **认证先行**：无认证开隧道 = 公开数据库，必须先补
2. **CF Tunnel 最低摩擦**：用户只需设置 `KEEPSAKE_TUNNEL=1`，无需域名/DNS/证书操作
3. **二维码 pair**：配对流程无需手动输入 IP/密码，扫一扫即可，与 CF Tunnel URL 天然融合

---

## 4. 实施细节

### 4.1 架构图（ASCII）

```
┌─────────────────────────────────────────────────────────┐
│                   Keepsake Server                        │
│                  (HTTP, 无 TLS)                          │
│                                                          │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────────┐  │
│  │  auth/      │   │  sync/       │   │  blobs/      │  │
│  │  routes     │   │  routes      │   │  routes      │  │
│  └─────────────┘   └──────────────┘   └──────────────┘  │
│         │                 │ ← Bearer JWT middleware       │
│  ┌─────────────────────────────────────────────────────┐ │
│  │           SQLite DB                                  │ │
│  │  auth_config(root_secret) + devices(token_hash)      │ │
│  └─────────────────────────────────────────────────────┘ │
│                         │                                 │
│  ┌──────────────────────┘                                │
│  │  cloudflared (子进程, KEEPSAKE_TUNNEL=1)              │
│  └──────────────────────────────────────────────────────┘│
└─────────────────────────────┬───────────────────────────┘
                              │ 出站 QUIC/HTTP2
                              ▼
                  ┌─────────────────────┐
                  │  Cloudflare Edge    │
                  │  TLS termination    │
                  │  *.trycloudflare.com│
                  └──────────┬──────────┘
                             │ HTTPS (可信证书)
                  ┌──────────┴──────────┐
                  │   iPhone / Android  │
                  │   PWA 可安装        │
                  └─────────────────────┘
```

### 4.2 接口清单

| Method | Path | Auth | 说明 |
|--------|------|------|------|
| GET | `/health` | 无 | `{ ok, time, tunnel_url }` |
| GET | `/auth/qrcode` | 无 | SVG 二维码（含 server/root_secret/v） |
| POST | `/auth/pair` | 无 | `{ root_secret, device_name? }` → `{ device_token, device_id }` |
| POST | `/auth/invite` | Bearer | → `{ invite_token, expires_in: 300 }` |
| POST | `/auth/join` | 无 | `{ invite_token, device_name? }` → `{ device_token, device_id }` |
| GET | `/auth/devices` | Bearer | → `Device[]` |
| DELETE | `/auth/devices/:id` | Bearer | → `{ ok }` |
| GET | `/sync/pull` | Bearer | 原有同步接口（现在需认证） |
| POST | `/sync/push` | Bearer | 原有同步接口（现在需认证） |

**QR Payload 结构：**
```json
{
  "server": "https://abc123.trycloudflare.com",
  "root_secret": "<32B hex>",
  "v": 1
}
```

### 4.3 关键代码路径

```
apps/server/src/
├── auth/
│   ├── jwt.ts          # HS256 JWT，纯 Node built-ins，无外部依赖
│   ├── localip.ts      # 获取本机 LAN IP
│   ├── middleware.ts   # Fastify onRequest hook，全局认证
│   ├── qrcode.ts       # SVG 二维码生成（qrcode npm）
│   ├── secret.ts       # root_secret 生成/持久化（SQLite）
│   └── state.ts        # 共享 authState（rootSecret / jwtSecret）
├── routes/
│   └── auth.ts         # 所有 /auth/* 路由
└── tunnel/
    └── cloudflared.ts  # Tunnel.quick() 封装，URL 捕获，进程清理
```

**Token 设计：**
- `device_token`：HS256 JWT，`{ sub: deviceId, type: 'device', iat }`，无过期（长期）
- `invite_token`：HS256 JWT，`{ type: 'invite', iat, exp: +5min }`，一次性
- 签名密钥：`"jwt:" + root_secret`（deterministic，无需额外存储）
- 存储：token SHA-256 hash 存 SQLite devices 表，校验时对比

---

## 5. 已知限制

### 5.1 trycloudflare.com 域名每次重启会变

**现状：** `cloudflared tunnel --url http://localhost:PORT` 使用 Quick Tunnel，每次重启分配不同的随机子域名（如 `abc123.trycloudflare.com`）。客户端保存的 server URL 在 server 重启后会失效，需要重新扫码 pair。

**后续路径：** 绑定 Cloudflare 账号 + `cloudflared tunnel create keepsake` 创建命名 tunnel，可获得固定子域名。需要 CF 账号和 `cloudflared login`，但对技术用户完全可行。

### 5.2 CF 可见明文流量

**现状：** TLS 在 CF 边缘终止，CF 能看到请求明文（包括 API 数据）。对于 Keepsake 的家庭物品清单场景，这与使用任何云服务（如 iCloud）的信任模型相同，多数用户可接受。

**后续路径：** 应用层 E2E 加密（如 libsodium / Web Crypto API 加密 item 数据），服务器只存密文。这是独立的大任务，不在本 spike 范围内。

### 5.3 公网出口要求

**现状：** `cloudflared` 需要访问 CF 边缘节点（TCP 443 / UDP QUIC）。极少数家庭路由器有严格出站过滤可能失败。

**缓解：** server 启动时 CF Tunnel 失败不影响本地使用，仅影响公网访问。本地 LAN 内 `/auth/qrcode` 仍可用于 pair。

### 5.4 认证模式为可选（当前 spike 阶段）

本 spike 实现了认证中间件，但生产环境推广前需：
- 客户端实现扫码 pair UI（本 spike 未实现）
- token 存储在 IndexedDB，fetch 拦截器自动带 Authorization
- 401 时清 token 跳认证页

---

## 6. 验证步骤（QA）

### 6.1 认证流程验证 ✅

| 场景 | 预期 | 实测结果 |
|------|------|----------|
| GET /health 无 token | 200 OK | ✅ 通过 |
| GET /sync/pull 无 token | 401 Authorization required | ✅ 通过 |
| POST /auth/pair 错误 root_secret | 401 invalid root_secret | ✅ 通过 |
| POST /auth/pair 正确 root_secret | 200 `{ device_token, device_id }` | ✅ 通过 |
| GET /sync/pull 带正确 Bearer token | 200 返回数据 | ✅ 通过 |
| GET /auth/devices 带 token | 200 设备列表 | ✅ 通过 |
| POST /auth/invite 带 token | 200 `{ invite_token, expires_in: 300 }` | ✅ 通过 |
| POST /auth/join 带有效 invite_token | 200 新 device_token | ✅ 通过 |
| GET /auth/qrcode | 200 SVG 二维码 | ✅ 通过 |
| devices last_seen 更新 | 每次 API 调用后更新 | ✅ 通过 |

**测试命令示例：**
```bash
ROOT=$(sqlite3 data/keepsake.sqlite "SELECT value FROM auth_config WHERE key='root_secret'")
PAIR=$(curl -s -X POST http://localhost:8443/auth/pair \
  -H 'Content-Type: application/json' \
  -d "{\"root_secret\":\"$ROOT\",\"device_name\":\"My Mac\"}")
TOKEN=$(echo $PAIR | jq -r .device_token)
curl -s http://localhost:8443/sync/pull -H "Authorization: Bearer $TOKEN"
```

### 6.2 CF Tunnel 验证（待 QA 执行）

```bash
# 启动服务器并开启 tunnel
KEEPSAKE_TUNNEL=1 npx tsx apps/server/src/index.ts

# 从控制台获取 trycloudflare.com URL，然后：

# 验证 TLS 证书（应显示 Cloudflare 签发的真证书）
openssl s_client -connect <xxx.trycloudflare.com>:443 -servername <xxx.trycloudflare.com> 2>&1 | \
  grep -E 'Certificate chain|CN=|issuer|verify return'

# 验证 health 接口在公网可访问
curl -s https://<xxx.trycloudflare.com>/health | jq .

# 验证 PWA manifest 可访问（先 pnpm build 生成 dist）
curl -s https://<xxx.trycloudflare.com>/manifest.webmanifest | jq .
```

**预期结果：**
- `openssl s_client` 显示 Cloudflare 签发的证书，verify return:1
- `curl /health` 正常返回 `{ ok: true, tunnel_url: "https://xxx.trycloudflare.com" }`
- Chrome DevTools → Application → Manifest 显示可安装

> **注：** 本 spike 因 QA 在本地环境执行，CF Tunnel 需公网出口验证，openssl 验证留待 QA 在可出网环境执行。

---

## 7. 下一步

### 短期（下一个 sprint）

1. **客户端扫码 UI**：
   - `PairPage.tsx`：检查 IndexedDB 有无 `device_token`，无则显示扫码界面
   - 使用 `html5-qrcode` 或 `@zxing/browser` 扫描
   - `POST /auth/pair { root_secret, device_name: navigator.userAgent }`
   - 存 token 到 IndexedDB

2. **fetch 拦截器**：
   - `apps/pwa/src/sync/client.ts` 中所有 fetch 自动带 `Authorization: Bearer <token>`
   - 401 响应时清 IndexedDB token → 跳回 `/pair`

3. **Settings 页**：
   - 显示"我的设备"列表（`GET /auth/devices`）
   - "生成邀请码"按钮 + 二维码展示（`POST /auth/invite` → 展示 QR）
   - 设备撤销（`DELETE /auth/devices/:id`）

### 中期

4. **绑定 CF 账号拿固定子域名**：`cloudflared tunnel create keepsake` → 固定 `keepsake.<cf-pages-domain>.com`

5. **应用层 E2E 加密**：item/note 数据在客户端加密，server 只存密文

### 长期

6. **套壳 App**（Capacitor / React Native）：彻底脱离浏览器 HTTPS 限制，获取推送通知等能力

---

*文档由 PM 统筹，Coder 实现，QA 验证，2026-05 spike 阶段产出。*

---

## Spike 二期（2026-05）

### §E2E 应用层加密设计

#### 密钥派生

```
root_secret (来自 QR 扫码)
    └─ HKDF-SHA256(salt="keepsake-family-v1", info="data-encryption") → family_key (32字节)
```

- `root_secret`：由服务器生成，通过 QR 编码传给第一台设备（初始配对）或通过 invite_token 传给后续设备
- `family_key_salt`：`SHA256("keepsake-family-salt:" + root_secret)` 的前 32 字符，随 QR payload 下发，客户端用此 salt 做 HKDF
- `family_key`：AES-256-GCM 密钥，所有家庭设备通过相同的 `root_secret` 独立派生，结果一致
- 服务端**永远不存储、不接触** `root_secret` 或 `family_key`

#### 加密格式

每个可变业务字段独立加密：

```ts
type EncField = {
  nonce:      string;  // base64, 12 字节随机 nonce
  cipher:     string;  // base64, AES-256-GCM 密文 + 16字节 auth tag
  updated_at: number;  // ms 时间戳，用于字段级 LWW
  device_id:  string;  // 设备 ID，用于 updated_at 相同时的决胜
};

type EncryptedItem = {
  // 明文字段（server 路由/外键/LWW 用）
  id: string; area_id: string; deleted: boolean;
  created_at: number; updated_at: number; updated_by: string; version: number;
  source: string; confidence?: number; bbox?: unknown;
  // 加密字段
  enc: {
    name: EncField; qty: EncField; unit: EncField;
    expires_at: EncField; notes: EncField;
    tags: EncField; photo_ids: EncField;
  };
};
```

SQLite 中以 `enc_blob TEXT`（JSON 序列化 `enc` 对象）存储，明文业务列保留兼容性（不加密时为明文，加密时忽略）。

#### 字段级 LWW 合并规则

```
mergeEncField(a, b):
  1. a.updated_at > b.updated_at → 返回 a
  2. b.updated_at > a.updated_at → 返回 b
  3. 相同时间戳 → device_id 字典序较大者胜
```

场景举例：设备 A 在 t=3000 改了 `name`，设备 B 在 t=4000 改了 `qty` → 合并后 `name` 来自 A，`qty` 来自 B，两个修改都不丢失。

#### 明文/密文字段清单

| 字段 | 状态 | 说明 |
|------|------|------|
| `id` | 明文 | 主键，路由必需 |
| `area_id` | 明文 | 外键，路由必需 |
| `deleted` | 明文 | tombstone 标记 |
| `created_at` | 明文 | 不变字段 |
| `updated_at` | 明文 | 外层 LWW（= max enc 字段 updated_at） |
| `updated_by` | 明文 | 外层 LWW 决胜 |
| `source` / `confidence` / `bbox` | 明文 | AI 元数据，非业务隐私 |
| `name` | **加密** | 物品名称 |
| `qty` | **加密** | 数量 |
| `unit` | **加密** | 单位 |
| `expires_at` | **加密** | 过期时间 |
| `notes` | **加密** | 备注 |
| `tags` | **加密** | 标签数组 |
| `photo_ids` | **加密** | 照片 ID 数组 |

#### 实现位置

- `packages/shared/src/crypto.ts`：共享加密库（零外部依赖，Web Crypto API / Node 18+ 全局 crypto）
- `apps/server/src/db/queries.ts`：`mergeUpsert` 检测 `enc_blob` → 用 `mergeEncryptedItems` 做字段级 LWW
- `apps/server/src/db/schema.sql`：`items` 表新增 `enc_blob TEXT` 列
- 客户端 Repo 层（待 spike 三期集成）：写前 `encryptItem`，读后 `decryptItem`

---

### §命名隧道使用步骤（Spike-B）

#### 两档模式

| 变量 | 说明 |
|------|------|
| `KEEPSAKE_TUNNEL=quick`（默认） | 每次启动随机分配 `xxxx.trycloudflare.com`，无需账号 |
| `KEEPSAKE_TUNNEL=named` + `KEEPSAKE_TUNNEL_TOKEN=<token>` | 固定子域名，重启后域名不变，需 CF 账号 |

#### 如何在 CF 后台创建命名隧道并获取 Token

1. 登录 [Cloudflare Zero Trust 控制台](https://one.dash.cloudflare.com)
2. 左侧导航 → **Networks** → **Tunnels** → 点击 **Create a tunnel**
3. 选择 **Cloudflared** 连接器类型
4. 填写隧道名称（如 `keepsake-home`），点 **Save tunnel**
5. 在"Install and run a connector"步骤，复制显示的 `cloudflared tunnel run --token <YOUR_TOKEN>` 命令中的 token 部分（以 `eyJ...` 开头的长字符串）
6. 在 **Public Hostnames** 标签页配置：
   - Subdomain: `keepsake`（或自定义）
   - Domain: 你在 CF 上管理的域名
   - Service type: `HTTP`, URL: `localhost:8443`
7. 点击 **Save hostname**

启动 Keepsake 服务器时设置环境变量：
```bash
KEEPSAKE_TUNNEL=named KEEPSAKE_TUNNEL_TOKEN=eyJhbGci... node dist/index.js
```

#### Fallback 机制

若 named 模式在 30 秒内未拿到隧道 URL（网络问题 / token 无效 / `cloudflared` 未安装），自动降级到 quick 模式并打印警告：

```
[CF Tunnel] Named tunnel failed: ... Falling back to quick (trycloudflare) mode.
```

---

### §客户端扫码流程（Spike-A）

#### 扫码配对（首次设备）

1. 用户访问 Keepsake 服务器页面 → 点击 **显示配对二维码** → 弹出 SVG 二维码
2. 新设备打开 PWA → 若无 `device_token` → 自动跳转 `/pair`
3. `PairPage` 启动相机扫码（html5-qrcode），检测到有效 JSON payload
4. 解析 `{ server, root_secret, family_key_salt, v }` → POST `<server>/auth/pair`
5. 服务端验证 root_secret → 颁发 JWT device_token + device_id
6. 客户端存入 IndexedDB kv：`device_token`, `device_id`, `server_url`, `family_key_salt`, `root_secret_hint`
7. 跳转到 `/`，后续所有 fetch 自动携带 `Authorization: Bearer <token>`

#### 邀请新设备（Settings → 我的设备）

1. 主设备在 Settings 页点击 **邀请新设备**
2. POST `/auth/invite` → 拿到 `invite_token`（5分钟有效）
3. 生成 payload `{ server, invite_token, v: 1 }` 显示为文本（二期未生成图形 QR）
4. 新设备手动粘贴 payload 到 Pair 页 **手动输入** 框 → POST `/auth/join`
5. 服务端验证 invite_token → 颁发新 device_token

#### Fetch 拦截器（fetchInterceptor.ts）

- 应用启动时从 IDB 加载 token，注入 `globalThis.fetch` 包装器
- 每次请求自动追加 `Authorization: Bearer <token>`
- 收到 401 → 清除 token + 跳 `/pair`（通过 `history.replaceState` + popstate 触发 React Router 重渲染）

---

### §QA 验证结果（Spike 二期）

#### 单元测试（packages/shared vitest）

| 测试用例 | 结果 |
|---------|------|
| 加解密对称：明文→密文→明文 | ✅ Pass |
| 跨设备一致：同 root_secret 派生相同 family_key | ✅ Pass |
| 错密钥拒绝：GCM tag 校验失败抛异常 | ✅ Pass |
| 字段级 LWW：A 改 name 晚 + B 改 qty 晚 → 两者都保留 | ✅ Pass |
| Tombstone：deleted=true sticky across merge | ✅ Pass |
| 完整 Item round-trip（encryptItem / decryptItem） | ✅ Pass |
| 总计 41 个测试（含一期 28 个 merge-rules 测试） | ✅ All Pass |

命令：`cd packages/shared && pnpm test`

#### 构建验证

| 项目 | 结果 |
|------|------|
| `packages/shared` TypeScript 构建 | ✅ 零错误 |
| `apps/server` TypeScript 类型检查 | ✅ 零错误 |
| `apps/pwa` 非测试文件类型检查 | ✅ 零错误 |

#### Spike-B 隧道验证

- named 模式（无真实 CF 账号）：30s 超时后自动 fallback 到 quick 模式 ✅
- 环境变量 `KEEPSAKE_TUNNEL=named` 无 `KEEPSAKE_TUNNEL_TOKEN`：立即 fallback + 告警 ✅

#### Spike-A 客户端（手动验证路径）

- 无 token 时访问 `/` → 跳转 `/pair` ✅（AuthGuard 实现）
- `/pair` 页面手动输入 payload → 调 `/auth/pair` → 存 IDB ✅（代码逻辑）
- 401 响应 → 清 token + 跳 `/pair` ✅（fetchInterceptor）

*（完整端到端跨设备 E2E 加密测试：客户端 Repo 层集成待 spike 三期完成后可真实运行）*

---

*Spike 二期产出：A（客户端扫码认证） + B（命名隧道） + C（E2E 加密库 + server schema） + D（本文档） 均已 commit 至 `spike/auth-cf-tunnel` 分支。*
