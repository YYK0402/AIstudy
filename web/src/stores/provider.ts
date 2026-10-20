import { defineStore } from "pinia";
import { getData, getTaskModelMap } from "../api";
import type { AiProvider, AiModel, CallLog } from "../api";

export const useProviderStore = defineStore("provider", {
  state: () => ({
    providers: [] as AiProvider[],
    models: [] as AiModel[],
    logs: [] as CallLog[],
    taskModelMap: {} as Record<string, number | null>,
  }),
  actions: {
    async load() {
      const data = await getData();
      // 深拷贝，避免 store 直接持有插件数据的引用，防止被意外原地修改污染真相源
      this.providers = structuredClone(data.providers);
      this.models = structuredClone(data.models);
      this.logs = structuredClone(data.logs);
      this.taskModelMap = await getTaskModelMap();
    },
  },
});
