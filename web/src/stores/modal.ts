import { defineStore } from "pinia";

export const useModalStore = defineStore("modal", {
  state: () => ({
    newCourseOpen: false,
  }),
  actions: {
    openNewCourse() {
      this.newCourseOpen = true;
    },
    closeNewCourse() {
      this.newCourseOpen = false;
    },
  },
});
