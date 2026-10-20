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
      // 用 splice 变异替换并深拷贝元素：prod 下数组整体赋值不触发依赖，
      // 变异方法（length/索引变更）能可靠触发响应式；深拷贝避免 store 与 data 共享元素引用
      this.courses.splice(0, this.courses.length, ...courses.map((c) => ({ ...c })));
      if (this.currentCourseId === 0 && courses.length > 0) {
        this.currentCourseId = courses[0].id;
      }
    },
    setCurrent(id: number) {
      this.currentCourseId = id;
    },
  },
});
