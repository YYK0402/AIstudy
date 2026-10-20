import { defineStore } from "pinia";
import type { AiProvider, Course } from "../api";

export const useModalStore = defineStore("modal", {
  state: () => ({
    newCourseOpen: false,
    editingCourse: null as Course | null,
    newProviderOpen: false,
    editingProvider: null as AiProvider | null,
    uploadMaterialOpen: false,
    uploadMaterialCourseId: 0,
  }),
  actions: {
    openNewCourse() {
      this.editingCourse = null;
      this.newCourseOpen = true;
    },
    openEditCourse(course: Course) {
      this.editingCourse = course;
      this.newCourseOpen = true;
    },
    closeNewCourse() {
      this.newCourseOpen = false;
      this.editingCourse = null;
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
    openUploadMaterial(courseId: number) {
      this.uploadMaterialCourseId = courseId;
      this.uploadMaterialOpen = true;
    },
    closeUploadMaterial() {
      this.uploadMaterialOpen = false;
      this.uploadMaterialCourseId = 0;
    },
  },
});
