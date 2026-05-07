import { db } from '../db/dexie.js';
import type { ReminderRule, Item } from '@keepsake/shared';

export interface TriggeredReminder {
  rule: ReminderRule;
  item: Item;
  reason: string;
}

export async function scanReminders(): Promise<TriggeredReminder[]> {
  const rules = await db.reminders.filter(r => !r.deleted).toArray();
  const now = Date.now();
  const triggered: TriggeredReminder[] = [];

  for (const rule of rules) {
    const item = await db.items.get(rule.item_id);
    if (!item || item.deleted) continue;

    // Throttle: don't re-fire within 1 hour of last firing
    if (rule.last_fired_at && now - rule.last_fired_at < 60 * 60 * 1000) continue;

    if (rule.kind === 'expiry' && rule.threshold_at != null) {
      // Trigger if expiry is within threshold_at ms from now (or already passed)
      const expiresAt = item.expires_at;
      if (expiresAt != null && expiresAt - now <= rule.threshold_at) {
        triggered.push({ rule, item, reason: `"${item.name}" 即将过期` });
      }
    } else if (rule.kind === 'low_stock' && rule.threshold_qty != null) {
      if (item.qty <= rule.threshold_qty) {
        triggered.push({ rule, item, reason: `"${item.name}" 库存不足（当前 ${item.qty}）` });
      }
    } else if (rule.kind === 'recheck' && rule.threshold_at != null) {
      // threshold_at is the re-check interval in ms; fire if enough time passed since last_fired_at
      const lastCheck = rule.last_fired_at ?? rule.updated_at;
      if (now - lastCheck >= rule.threshold_at) {
        triggered.push({ rule, item, reason: `"${item.name}" 需要重新检查` });
      }
    }
  }

  return triggered;
}
