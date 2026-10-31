import type { AppSettings } from "../types/appData";
import { getData, saveData } from "./storage";

export async function getSettings(): Promise<AppSettings> {
  const data = await getData();
  return {
    chapterMode: data.settings?.chapterMode ?? "manual",
    persistToSiyuan: data.settings?.persistToSiyuan ?? false,
    notebookName: data.settings?.notebookName ?? "AI 研习",
    aiRetryCount: data.settings?.aiRetryCount ?? 0,
    aiRateLimitPerMin: data.settings?.aiRateLimitPerMin ?? 0,
    studyRetentionDays: data.settings?.studyRetentionDays ?? 90,
  };
}

export async function updateSettings(input: Partial<AppSettings>): Promise<void> {
  const data = await getData();
  if (!data.settings) {
    data.settings = { chapterMode: "manual", persistToSiyuan: false, notebookName: "AI 研习" };
  }
  Object.assign(data.settings, input);
  await saveData(data);
}
