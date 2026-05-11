# QA Round-14 真机验证报告（commit 5ba3d543）

> 验证日期：2026-05-11  
> 目标 PR：#216（SQLite 自动备份）、#217（启动信息块美化）、#218（PWA 连接状态指示器）

---

## 0. 环境

| 项目 | 值 |
|------|-----|
| HEAD commit | `5ba3d543eca06d65c521c7412bd88af17dbf8ed0` |
| node | v25.9.0 |
| pnpm | 9.15.9 |
| OS | macOS（tuntundeMacBook-Pro） |
| pnpm install | ✅ OK（lockfile up to date, 1.3s） |

**环境准备命令：**
```bash
git checkout main && git pull --ff-only  # Already up to date
git rev-parse HEAD                        # 5ba3d543eca06d65c521c7412bd88af17dbf8ed0
pnpm install                              # Done in 1.3s
lsof -ti:8443 | xargs kill 2>/dev/null   # cleared
rm -rf apps/server/data/backups           # cleared
```

---

## 1. 服务端启动

**命令：**
```bash
KEEPSAKE_BACKUP_INTERVAL_DAYS=0 pnpm -C apps/server dev
```

**结果：❌（服务启动成功，但立即陷入无限错误循环）**

**stdout 前 60 行（完整）：**

```
> @keepsake/server@0.1.0 dev /Users/tuntun/Documents/Keepsake/apps/server
> tsx watch src/index.ts

{"level":30,"time":1778429824588,"pid":87019,...,"msg":"Server listening at http://127.0.0.1:8443"}
╔════════════════════════════════════════════════╗
║ 🗝  Keepsake Server 已启动                         ║
╠════════════════════════════════════════════════╣
║ LAN      http://192.168.31.181:8443             ║
║ 本机     http://localhost:8443                    ║
╠════════════════════════════════════════════════╣
║ 手机/平板请使用 LAN URL                                ║
║ 浏览器红屏点"高级 → 继续"即可访问                             ║
╚════════════════════════════════════════════════╝
[backup] 备份完成：.../data/backups/keepsake-2026-05-10.sqlite   ← ✅ 第一次成功
{"level":30,...,"msg":"Server listening at http://192.168.31.181:8443"}
{"level":30,...,"msg":"Server listening at http://198.18.0.1:8443"}
{"level":30,...,"msg":"Keepsake server on http://0.0.0.0:8443"}
[backup] 备份失败： SqliteError: output file already exists   ← ❌ 开始无限循环
    at Database.exec (.../better-sqlite3/.../wrappers.js:9:14)
    at runBackup (.../backup.ts:60:6)
    at Timeout.doBackup (.../backup.ts:98:20)
    at listOnTimeout (node:internal/timers:605:17)
    at process.processTimers (node:internal/timers:541:7) {
  code: 'SQLITE_ERROR'
}
[backup] 备份失败： SqliteError: output file already exists
... （此后每 0ms 一次，无止境重复相同堆栈）
```

- **框线信息块：** ✅（#217 正常）
- **LAN IP 显示：** ✅（值：`192.168.31.181`）
- **备份文件生成（第一次）：** ✅（`keepsake-2026-05-10.sqlite` 成功写入）
- **备份循环错误：** ❌ — 详见 Bug #219

### 根因

`KEEPSAKE_BACKUP_INTERVAL_DAYS=0` → `intervalMs = 0` → `setInterval(doBackup, 0)`（每 tick 触发）。  
`VACUUM INTO` 要求目标文件不存在，第一次成功后文件已存在，后续每次均抛出 `SQLITE_ERROR: output file already exists`。

---

## 2. 备份文件验证

```bash
ls -la apps/server/data/backups/
# -rw-r--r--  1 tuntun  staff  196608 May 11 00:17 keepsake-2026-05-10.sqlite

sqlite3 apps/server/data/backups/keepsake-2026-05-10.sqlite ".tables"
# areas  auth_config  blob_meta  client_logs  conflict_log
# devices  families  items  kv  photos  reminders  rooms  snapshots

sqlite3 apps/server/data/backups/keepsake-2026-05-10.sqlite "SELECT count(*) FROM rooms;"
# 2
```

**结果：✅** 备份文件存在、可正常 open、表结构完整合理、数据可查询。

---

## 3. 备份保留策略

**验证方法：** 手动造 5 个不同日期备份文件（05-06 ～ 05-10），直接调用 `pruneBackups(dir, 4)` 验证。

```bash
# 准备 5 个文件
cp keepsake-2026-05-10.sqlite backups/keepsake-2026-05-{06,07,08,09}.sqlite
# → 共 5 个: 05-06, 05-07, 05-08, 05-09, 05-10

# 调用 pruneBackups
pnpm -C apps/server exec tsx /tmp/test-prune.ts
```

**输出：**
```
before: ['keepsake-2026-05-06.sqlite','keepsake-2026-05-07.sqlite','keepsake-2026-05-08.sqlite','keepsake-2026-05-09.sqlite','keepsake-2026-05-10.sqlite']
after:  ['keepsake-2026-05-07.sqlite','keepsake-2026-05-08.sqlite','keepsake-2026-05-09.sqlite','keepsake-2026-05-10.sqlite']
```

**结果：✅** 5 → 4，最旧的 `keepsake-2026-05-06.sqlite` 被正确删除。keep=4 逻辑正确。

> 注：由于 Bug #219（`intervalMs=0` 时 setInterval 无限触发），生产路径下 `pruneBackups` 实际上**从未被调用**（`runBackup` 先抛出异常，`pruneBackups` 在同一个 try 块之后 —— 实际代码中 `pruneBackups` 在 `runBackup` 之后，若 `runBackup` 抛出则不会执行）。此验证是直接调用函数级别的逻辑验证。

---

## 4. PWA 连接状态指示器（#218）

### 4a. `/health` 端点

```bash
curl -s http://localhost:8443/health
# {"ok":true,"time":1778429850064}
```

**结果：✅** 响应正常。

### 4b. 源码审查

**`apps/pwa/src/sync/useServerStatus.ts`**

| 检查项 | 结果 |
|--------|------|
| 使用相对路径 `fetch('/health')` | ✅（无 serverUrl 概念） |
| 30 秒 `setInterval` | ✅（`POLL_INTERVAL_MS = 30_000`） |
| 5 秒 `AbortController` 超时 | ✅（`FETCH_TIMEOUT_MS = 5_000`） |
| 离线时不 throw、不 toast | ✅（catch 块只 `return false`，无副作用） |
| 不影响 sync 逻辑 | ✅（hook 仅返回状态值，无 sync 调用） |

**`apps/pwa/src/components/ServerStatusBadge.tsx`**

| 状态 | 颜色 className |
|------|---------------|
| `checking`（灰） | `bg-gray-400` |
| `online`（绿） | `bg-green-500` |
| `offline`（红） | `bg-red-500` |

三种状态通过 Tailwind className 明确区分。✅

**页面集成：**
- `Home.tsx` — 引入 `ServerStatusDot`，渲染于 header 右侧（仅圆点）✅
- `Settings.tsx` — 引入 `ServerStatusBadge`，渲染圆点 + 文字 ✅

### 4c. PWA 编译

```bash
pnpm -C apps/pwa build
# ✓ built in 3.52s
```

**结果：✅** 零编译错误。

---

## 5. 离线行为（server 停止后 PWA 仍可 build）

```bash
lsof -ti:8443 | xargs kill 2>/dev/null
pnpm -C apps/pwa build
# ✓ built in 3.52s
```

**结果：✅** 前端 build 不依赖 server 运行。

---

## 6. 全量回归编译 & 测试

| 项目 | 命令 | 结果 |
|------|------|------|
| packages/shared build | `pnpm -C packages/shared build` | ✅ |
| apps/pwa build | `pnpm -C apps/pwa build` | ✅ |
| apps/server build | `pnpm -C apps/server build` | ✅ |
| packages/shared test | `pnpm -C packages/shared test` | ✅ 28/28 passed |
| apps/server test | `pnpm -C apps/server test` | ✅ 16/16 passed (4 files) |

**全部绿色，零失败。**

---

## 7. 后台进程清理

```bash
lsof -ti:8443 | xargs kill 2>/dev/null
pkill -f "tsx watch" 2>/dev/null
lsof -i:8443 || echo "port 8443 free"
# port 8443 free
```

✅ 端口 8443 空闲

---

## 发现的 Bug

- [x] **#219** `[QA] backup：KEEPSAKE_BACKUP_INTERVAL_DAYS=0 导致 setInterval(0) 疯狂重复触发，每次 VACUUM INTO 因目标文件已存在而失败`
  - 已开 issue：https://github.com/luzion89/keepsake/issues/219
  - 类型：type:bug / priority:high / area:server
  - **这是用户"跑命令直接就报错"的直接原因**
  - 服务进程本身未崩溃（HTTP 仍响应），但终端被无限错误日志淹没，严重影响使用

---

## 综合结论

| 功能 | PR | 结论 |
|------|-----|------|
| 启动信息块美化 | #217 | ✅ 框线、LAN IP、URL 全部正常 |
| SQLite 自动备份（首次写入 + keep 逻辑） | #216 | ⚠️ **部分通过**：首次备份文件正常生成，keep=4 裁剪逻辑正确；但 `intervalMs=0` 触发 setInterval(0) 无限循环错误（Bug #219） |
| PWA 连接状态指示器 | #218 | ✅ 源码逻辑全部符合规范，编译通过，/health 端点响应正常 |

**待 #219 修复后需重测**：`KEEPSAKE_BACKUP_INTERVAL_DAYS=0` 场景的完整备份流程（含 pruneBackups 在实际调度路径中的触发）。
