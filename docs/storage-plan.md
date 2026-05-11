# 客户端存储上限 & 长期规划评估

> 评估日期：2026-05-07  关联 issue：#44

---

## 1. IndexedDB 配额（各浏览器）

| 浏览器 | 配额策略 | 实际上限 |
|--------|----------|----------|
| **Chrome / Edge** | `navigator.storage.estimate()` 可查；默认 ≤ 总磁盘的 60%，单 origin 无额外上限 | 通常 **数 GB～数十 GB**（典型设备 50 GB 磁盘 → ~30 GB 可用） |
| **Firefox** | 磁盘剩余空间的 50%，单 origin 上限为该池的 1/5 | 通常 **数 GB** |
| **Safari** | 硬限 **1 GB**（iOS/macOS 均如此）；超过需弹权限对话框 | **1 GB**（注意：iOS Safari 实测更保守，约 500 MB～1 GB） |

**结论**：Safari 是短板，1 GB 硬限需认真对待；用户需保证定期访问以避免 ITP 清理。

---

## 2. 用户用量估算（1 年 · 100 张/月 · 200 KB/张）

```
100 张/月 × 200 KB × 12 月 = 240 MB/年
```

- 压缩后（代码已用 browser-image-compression 降到 ≤ 0.8 MB）实际更低。
- **结论**：正常用法 1 年内不会达到 Safari 1 GB 上限；但重度用户（高分辨率 / 大量照片）+ 3 年以上可能逼近。**不会立即爆，但需要 GC 策略**。

---

## 3. Safari 7 天 ITP 清理风险

Safari 的 **Intelligent Tracking Prevention (ITP)** 规则：
- 若用户 **7 天内未主动访问** 该 origin，Safari 可能将 IndexedDB 数据标记为可清除（在低磁盘压力下实际清除）。

**缓解方案（行动项）**：
1. 每次 sync 成功后立即 push 所有关键数据到服务器（当前已有 sync 机制）。
2. 在 Settings 页提示用户定期打开 App（至少 7 天一次）。
3. 将照片 blob 同步到服务器后，本地标记 `remote_url` 并可 GC 本地 blob（见第 5 节）。

---

## 4. 服务端 SQLite（better-sqlite3）性能边界

| 规模 | 典型表现 |
|------|----------|
| < 1 GB 单文件 | 无感知，WAL 模式读写并发良好 |
| 1–10 GB | 仍可用，大查询需索引；`VACUUM` 时会短暂锁定 |
| > 10 GB | 需考虑分库或迁移到 PostgreSQL；`full-text search` 变慢 |

当前 `client_logs` 表：每条约 200–500 字节，200 条/设备/次同步 → **基本不会成为瓶颈**。

**结论**：Keepsake 场景（家庭仓储，数万物品级别）在 better-sqlite3 下单库 < 500 MB，预计 3–5 年内无性能问题。

---

## 5. 长期规划（行动项）

### 5a. Blob GC 策略
- **触发条件**：照片已同步到服务器（`blob_meta` 有记录 + `remote_url` 非空）且本地 `blobs` 表中对应 blob 存在。
- **清除逻辑**：sync 完成后扫描 `blobs` 表，对已有 `remote_url` 的照片删除本地 blob，保留 metadata。
- **实现位置**：`apps/pwa/src/sync/blobs.ts` 加 `gcSyncedBlobs()` 函数，在 `syncOnce` 末尾调用。
- **保护**：用户明确标记"本地缓存"的照片不清除。

### 5b. 配额预警 UI
```typescript
// 检测剩余配额
const { usage, quota } = await navigator.storage.estimate();
const usagePct = (usage ?? 0) / (quota ?? 1);
if (usagePct > 0.8) showQuotaWarning(usage, quota);
```
- 在 Settings 页加"存储使用情况"展示条，超过 80% 时显示橙色警告。
- 超过 95% 弹 modal，引导用户手动 GC 或导出备份。

### 5c. 定期备份建议
- 服务端：通过 cron 或 systemd timer 每日备份 SQLite（`sqlite3 keepsake.sqlite ".backup keepsake-$(date +%F).sqlite"`）。
- 客户端：已有"导出 JSON 备份"功能；建议在 Settings 加提示"上次导出：N 天前"。

### 5d. 应急导出全部数据
- 当前 `exportJson()` 已导出 rooms/areas/items/photos(metadata)/snapshots。
- **缺失**：photos 的实际 blob 未包含在 JSON 导出中。
- **行动项**：加 `exportZip()` 函数，将 blobs 表中的所有 blob 打包成 zip（可用 `fflate` 库），与 metadata JSON 一起导出。这是"应急导出"的完整形态。

---

## 核心结论

1. **短期无风险**：100 张/月用量 1 年仅 240 MB，不会撑爆任何浏览器。
2. **Safari 是最大威胁**：1 GB 上限 + ITP 7 天清理，必须保证定期访问 + 定期同步。
3. **立即可行**：实现 `gcSyncedBlobs()`（已同步 blob 本地删除），加配额展示到 Settings。
4. **中期**：加 zip 导出（含 blob）；服务端加每日 SQLite 备份脚本。
