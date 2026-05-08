# Round-13 QA 审查：多人同步冲突机制

**关联 Issue**: #135  
**状态**: 🔴 待执行  
**日期**: 2026-05-08  

---

## 测试范围

验证 LWW（Last-Write-Wins）+ `deviceId` tiebreaker 在家庭多设备并发场景下的健壮性。

## 场景矩阵

| # | 场景 | 预期 | 实际 | 结论 |
|---|------|------|------|------|
| S1 | 两设备同时修改同一物品 qty（updated_at 不同） | updated_at 更大者胜出 | 待测 | — |
| S2 | 两设备 updated_at 完全相同 | deviceId 字典序大者胜出，无数据丢失 | 待测 | — |
| S3 | 两设备同时删除同一条记录 | 删除优先，不报错 | 待测 | — |
| S4 | 设备 A 离线，outbox 积压，恢复后回放 | 不覆盖设备 B 期间更新（若 B updated_at 更新） | 待测 | — |
| S5 | 时钟漂移：设备 A 系统时间快 5 分钟 | 不导致旧数据覆盖新数据（服务端时间戳校验） | 待测 | — |

## 验证点

- `packages/shared/src/merge.ts`（或同等文件）：LWW merge 规则
- `apps/pwa/src/sync/client.ts`：outbox 回放逻辑
- `deviceId` tiebreaker 在 updated_at 相同时实际生效

## 执行方式

若测试基础设施不支持双浏览器并发，用 mock `updated_at` 单元测试覆盖 S1-S5：

```ts
// 示例：S1 单元测试骨架
it('S1: LWW — updated_at 更大者胜出', () => {
  const local  = { id: '1', qty: 3, updated_at: 1000, updated_by: 'device-A' };
  const remote = { id: '1', qty: 5, updated_at: 2000, updated_by: 'device-B' };
  expect(merge(local, remote).qty).toBe(5);
});
```

## 发现（待填写）

> QA 完成测试后在此填写发现的 bug，另开 issue。

---

_此文档由 PM 自动创建，待 QA 填写测试结果。_
