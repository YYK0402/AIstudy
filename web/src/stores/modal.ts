import { defineStore } from "pinia";
import type { AiProvider } from "../api";

export const useModalStore = defineStore("modal", {
  state: () => ({
    newCourseOpen: false,
    newProviderOpen: false,
    editingProvider: null as AiProvider | null,
  }),
  actions: {
    openNewCourse() {
      this.newCourseOpen = true;
    },
    closeNewCourse() {
      this.newCourseOpen = false;
    },
    openNewProvider() {
      this.newProviderOpen = true;
      this.editingProvider = null;
    },
    openEditProvider(provider: AiProvider) {
      this.newProviderOpen = true;
      this.editingProvider = provider;
    },
    closeNewProvider() {
      this.newProviderOpen = false;
      this.editingProvider = null;
    },
  },
});
