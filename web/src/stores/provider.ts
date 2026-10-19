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
      this.providers = data.providers;
      this.models = data.models;
      this.logs = data.logs;
      this.taskModelMap = await getTaskModelMap();
    },
  },
});
