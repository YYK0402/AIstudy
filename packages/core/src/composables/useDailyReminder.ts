import { getData, saveData, formatLocalDate } from "../api";
import { getBridgeSafe } from "../bridge";
import { buildDailyReminderSummary } from "../utils/dailyReminder";

/**
 * 今日任务提醒：应用启动/当日首次打开时推送摘要。
 * 去重按自然日（reminders.lastReminderDate），零任务不推；失败静默（不打扰 > 提醒）。
 */
export async function maybeShowDailyReminder(): Promise<void> {
  try {
    const today = formatLocalDate();
    const data = await getData();
    if (data.reminders?.lastReminderDate === today) return;
    const summary = buildDailyReminderSummary(data, today);
    if (!summary) return;
    getBridgeSafe()?.showMessage(summary.text);
    data.reminders = { ...data.reminders, lastReminderDate: today };
    await saveData(data);
  } catch (e) {
    console.error("今日任务提醒失败:", e);
  }
}
