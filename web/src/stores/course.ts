import { defineStore } from "pinia";
import type { Course } from "../api";

export const useCourseStore = defineStore("course", {
  state: () => ({
    courses: [] as Course[],
    currentCourseId: 0,
  }),
  getters: {
    currentCourse: (state): Course | null =>
      state.courses.find((c) => c.id === state.currentCourseId) ?? null,
  },
  actions: {
    setCourses(courses: Course[]) {
      this.courses = courses;
      if (this.currentCourseId === 0 && courses.length > 0) {
        this.currentCourseId = courses[0].id;
      }
    },
    setCurrent(id: number) {
      this.currentCourseId = id;
    },
  },
});
