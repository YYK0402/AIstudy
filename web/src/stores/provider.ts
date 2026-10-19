import { defineStore } from "pinia";
import { getData } from "../api";
import type { AiProvider, AiModel, CallLog } from "../api";

export const useProviderStore = defineStore("provider", {
  state: () => ({
    providers: [] as AiProvider[],
    models: [] as AiModel[],
    logs: [] as CallLog[],
  }),
  actions: {
    async load() {
      const data = await getData();
      this.providers = data.providers;
      this.models = data.models;
      this.logs = data.logs;
    },
  },
});
