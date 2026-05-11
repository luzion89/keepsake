# HTTPS Setup（本地 mkcert 证书）

本文说明如何用 [mkcert](https://github.com/FiloSottile/mkcert) 在开发环境启用 HTTPS。

---

## 1. 前置：安装 mkcert

```bash
brew install mkcert nss
mkcert -install   # 将本地 CA 注册到系统/浏览器信任链（需要 sudo）
```

---

## 2. 生成证书

```bash
cd apps/server/certs
mkcert -cert-file dev-cert.pem -key-file dev-key.pem \
  localhost 127.0.0.1 <你的内网IP> ::1
```

将 `<你的内网IP>` 替换为实际 LAN 地址（如 `192.168.31.181`）。  
生成的文件一律被 `.gitignore` 排除，**不会进入版本库**。

---

## 3. 启动 HTTPS 服务端

```bash
KEEPSAKE_TLS=1 pnpm -C apps/server start
```

服务器仍监听端口 **8443**，日志会打印 `https://0.0.0.0:8443`。

### 可选环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `KEEPSAKE_TLS` | 未设置（HTTP） | 设为 `1` 启用 HTTPS |
| `KEEPSAKE_TLS_CERT` | `apps/server/certs/dev-cert.pem` | 自定义证书路径 |
| `KEEPSAKE_TLS_KEY` | `apps/server/certs/dev-key.pem` | 自定义私钥路径 |

---

## 4. 安卓安装 CA 证书

安卓系统默认不信任用户安装的 CA（仅 System CA 受 Chrome 信任），需要将 `rootCA.pem` 安装为**用户 CA** 并配合网络安全配置，或使用 Android 14 以下的"用户信任根"方式：

1. 将 `apps/server/certs/rootCA.pem` 传到手机（AirDrop / 微信 / USB 均可）。
2. 手机 → **设置 → 安全 → 加密与凭据 → 从存储设备安装**（部分机型路径略有不同）。
3. 选中 `rootCA.pem`，命名为 `Keepsake Dev CA`，类型选**CA 证书**。
4. 在 Chrome 地址栏访问 `https://<内网IP>:8443`，应出现绿锁。

> **注意（Android 7+）**：Chrome 默认只信任系统 CA。若绿锁不出现，请参考
> [Android 网络安全配置](https://developer.android.com/training/articles/security-config)
> 在 PWA/WebView 中声明信任用户 CA，或使用 Android 的 ADB 将证书推入系统分区（需 root）。

---

## 5. PWA 客户端配置

将客户端中配置的服务端地址从：

```
http://192.168.31.181:8443
```

改为：

```
https://192.168.31.181:8443
```

Service Worker / fetch 请求在 HTTPS 源下才能完整运行。

---

## 6. 重新生成证书（IP 变更时）

```bash
cd apps/server/certs
rm -f dev-cert.pem dev-key.pem
mkcert -cert-file dev-cert.pem -key-file dev-key.pem \
  localhost 127.0.0.1 <新IP> ::1
```

`rootCA.pem` 不需要重新生成，手机无需重新安装 CA。
