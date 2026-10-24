import { getData, saveData } from "./storage";
import { GLOBAL_DEFAULT_KEY } from "./constants";

export async function saveTaskModel(taskKey: string, modelId: number | null): Promise<void> {
  const data = await getData();
  const idx = data.taskModels.findIndex((t) => t.taskKey === taskKey);
  if (idx >= 0) {
    data.taskModels[idx].modelId = modelId;
  } else {
    data.taskModels.push({ taskKey, modelId, isGlobalDefault: taskKey === GLOBAL_DEFAULT_KEY });
  }
  await saveData(data);
}

export async function getTaskModelMap(): Promise<Record<string, number | null>> {
  const data = await getData();
  const map: Record<string, number | null> = {};
  for (const t of data.taskModels) {
    map[t.taskKey] = t.modelId;
  }
  return map;
}
