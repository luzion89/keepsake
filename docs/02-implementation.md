# Keepsake — 代码实现大纲

> 配套：`01-plan.md`（背景与架构）、`03-testing.md`（测试方案）。

---

## 1. 仓库结构

```
Keepsake/
├── apps/
│   ├── pwa/                    # 前端
│   │   ├── public/manifest.webmanifest
│   │   ├── public/icons/{192,512,maskable}.png
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── app/router.tsx
│   │   │   ├── pages/{Home,Room,Area,Item,Capture,Search,Settings}.tsx
│   │   │   ├── components/{RoomList,AreaGrid,ItemList,PhotoCarousel,
│   │   │   │               VoiceMicButton,ConflictBanner,ApiKeyForm}.tsx
│   │   │   ├── db/dexie.ts                       # IDB schema (rooms/areas/items/...)
│   │   │   ├── db/repositories/{room,area,item,photo,snapshot,outbox}.ts
│   │   │   ├── sync/{client.ts,conflict.ts,outbox.ts,blobs.ts}
│   │   │   ├── ai/
│   │   │   │   ├── providers/{openai.ts,gemini.ts,qwen.ts}   # 浏览器直连
│   │   │   │   ├── router.ts                                  # 客户端优先；服务器代理回退
│   │   │   │   └── prompts.ts
│   │   │   ├── speech/recognizer.ts
│   │   │   ├── camera/capture.ts
│   │   │   └── sw/registerSW.ts
│   │   ├── vite.config.ts                        # vite-plugin-pwa, Workbox
│   │   └── package.json
│   └── server/                 # 后端
│       ├── src/
│       │   ├── index.ts                          # Fastify bootstrap
│       │   ├── db/{schema.sql,migrate.ts,queries.ts}
│       │   ├── routes/{auth,sync,blobs,ai,health}.ts   # ai 路由可选
│       │   ├── sync/{merge.ts,validators.ts}
│       │   ├── ai/{openai.ts,gemini.ts,qwen.ts,router.ts,prompts.ts}  # 可选代理
│       │   ├── workers/recognizeQueue.ts         # 仅当客户端选"先存草稿"时使用
│       │   └── config.ts                         # env: API keys, FAMILY_PASSWORD
│       └── package.json
├── packages/
│   └── shared/                 # 前后端共享
│       ├── src/types.ts                          # Zod schemas (Location/Item/Photo/Snapshot)
│       ├── src/sync-protocol.ts                  # pull/push 报文类型
│       └── src/merge-rules.ts                    # 同款合并函数（前后端复用）
├── tools/
│   └── mkcert-setup.sh
├── docs/
│   ├── 01-plan.md
│   ├── 02-implementation.md
│   └── 03-testing.md
├── pnpm-workspace.yaml
└── README.md
```

---

## 2. 关键模块接口（伪代码）

### 2.1 共享同步协议

`packages/shared/src/sync-protocol.ts`

```ts
export type PullResp = { serverTime: number; changes: Change[] };
export type PushReq  = { deviceId: string; ops: Op[] };
export type PushResp = {
  serverTime: number;
  accepted: string[];
  conflicts: { id: string; server: any; client: any; field: string }[];
};
export type Op =
  | { kind:'upsert'; table:'room'|'area'|'item'|'photo'|'snapshot'; row:any }
  | { kind:'delete'; table:string; id:string; updated_at:number }
  | { kind:'qty_delta'; itemId:string; delta:number; updated_at:number };
```

### 2.2 客户端同步入口

`apps/pwa/src/sync/client.ts`

```ts
export async function syncOnce() {
  const since = await getCursor();
  const { changes, serverTime } = await api.pull(since);
  await applyRemote(changes);          // 走 merge-rules
  const ops = await outbox.drain(500);
  const { accepted, conflicts } = await api.push(ops);
  await outbox.ack(accepted);
  await conflictStore.put(conflicts);  // UI 显示横幅
  await setCursor(serverTime);
}
```

### 2.3 合并规则（前后端复用，保证一致）

`packages/shared/src/merge-rules.ts`

```ts
export function mergeItem(local: Item, remote: Item): Item {
  // LWW 字段、qty delta 累计、photo_ids/tags 集合并集 + tombstone
}
export function mergeRoom(local, remote) { /* LWW */ }
export function mergeArea(local, remote) { /* LWW */ }
```

### 2.4 AI 调用（客户端优先）

`apps/pwa/src/ai/router.ts`

```ts
// 客户端优先：用户在 Settings 里填了 OpenAI/Gemini key 就直连云厂商
// 失败/未配置 → 回退到本地服务器 /ai/* 代理（如果服务器在线）
// 都不行 → 返回 {status:'pending'} 把照片/请求塞进 outbox，等服务器恢复后补做
export async function recognize(photos: Blob[]): Promise<Draft> {
  const cfg = await getAiConfig();          // 从 Dexie 读取
  if (cfg.mode === 'client' && cfg.apiKey) {
    try { return await providers[cfg.provider].recognize(photos, cfg); }
    catch (e) { /* fall through */ }
  }
  if (await isServerReachable()) {
    return await api.serverRecognize(photos);
  }
  await outbox.enqueueRecognize(photos);
  return { status: 'pending' };
}
```

服务器端（**可选**）：

`apps/server/src/routes/ai.ts`

```ts
// 仅当用户开启了"服务器代理"时才会被调用；服务器读 .env 里的 key
fastify.post('/ai/recognize', { schema: recognizeSchema }, async (req) => { ... });
fastify.post('/ai/edit',      async (req) => { ... });
fastify.post('/ai/qa',        async (req) => { ... });
```

### 2.5 同步路由

`apps/server/src/routes/sync.ts`

```ts
fastify.get('/sync/pull', async (req) => {
  // SELECT ... WHERE updated_at > :since ORDER BY updated_at ASC LIMIT 500
});

fastify.post('/sync/push', async (req) => {
  for (const op of req.body.ops) {
    const local = db.get(op.table, op.row.id);
    const merged = applyMergeRule(local, op);
    db.upsert(op.table, merged);
  }
});
```

### 2.6 Service Worker（vite-plugin-pwa runtime caching）

```ts
// API: NetworkFirst 5s timeout → fallback 到上次缓存
// /blobs/*: CacheFirst, 30 天，最多 200 张
// 静态资源: precache + auto-update
// 注册 BackgroundSync 'outbox-flush'（Android only）
```

---

## 3. 关键依赖清单

```
# 前端
dexie, idb-keyval
workbox-window, vite-plugin-pwa
react, react-router-dom, zustand
tailwindcss, @radix-ui/*
browser-image-compression

# 后端
fastify, @fastify/jwt, @fastify/multipart, @fastify/static
better-sqlite3, zod
openai, @google/generative-ai (按需)

# 测试
vitest, @testing-library/react, playwright, supertest, nock
```

---

## 4. 部署与运行

```bash
# 一次性初始化
pnpm i
pnpm -C apps/server db:migrate
./tools/mkcert-setup.sh        # 生成局域网 HTTPS 证书

# 开发
pnpm dev                       # 同时跑 pwa (5173) 与 server (8443)

# 生产（PC/Mac 上）
pnpm build
pnpm -C apps/server start      # 监听 0.0.0.0:8443，托管前端静态资源
# → 手机浏览器访问 https://<家庭 IP>:8443 → "添加到主屏"
```

---

## 5. 实现顺序（关键文件优先）

1. `packages/shared/src/{types,merge-rules,sync-protocol}.ts` — **先行**，前后端依赖
2. `apps/pwa/src/db/dexie.ts` — IDB schema (rooms / areas / items / photos / snapshots / outbox / conflicts / ai_config)
3. `apps/pwa/src/sync/{client,outbox,conflict}.ts` — 同步层，独立可测
4. `apps/pwa/src/ai/{providers,router}.ts` — **客户端直调云 AI**
5. `apps/server/src/db/schema.sql` + `routes/sync.ts` — 服务端真源
6. `apps/server/src/routes/ai.ts` — **可选**代理
7. `apps/pwa/vite.config.ts`（vite-plugin-pwa 配置） + `public/manifest.webmanifest` — PWA 安装能力
8. 业务页面 / UI 组件（Room → Area → Item 三层导航）
9. 提醒、快照、Web Push（VAPID）
