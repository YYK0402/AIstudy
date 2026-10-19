import { defineStore } from "pinia";

export const useModalStore = defineStore("modal", {
  state: () => ({
    newCourseOpen: false,
    newProviderOpen: false,
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
    },
    closeNewProvider() {
      this.newProviderOpen = false;
    },
  },
});
