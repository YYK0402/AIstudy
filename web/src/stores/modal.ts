import { defineStore } from "pinia";
import type { AiProvider, Course } from "../api";
import type { ParsedHeading } from "../utils/documentParser";

export const useModalStore = defineStore("modal", {
  state: () => ({
    newCourseOpen: false,
    editingCourse: null as Course | null,
    newProviderOpen: false,
    editingProvider: null as AiProvider | null,
    uploadMaterialOpen: false,
    uploadMaterialCourseId: 0,
    // 资料保存后递增，通知课程内容页刷新资料列表（App 层 modal 与 router-view 视图无父子关系，用信号传递）
    materialVersion: 0,
    // 目录预览（上传资料后自动识别章节的确认弹窗）
    chapterPreviewOpen: false,
    chapterPreviewCourseId: 0,
    chapterPreviewHeadings: [] as ParsedHeading[],
    // 章节导入后递增，通知课程内容页刷新目录树
    chapterVersion: 0,
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
    notifyMaterialSaved() {
      this.materialVersion++;
    },
    openChapterPreview(courseId: number, headings: ParsedHeading[]) {
      this.chapterPreviewCourseId = courseId;
      this.chapterPreviewHeadings = headings;
      this.chapterPreviewOpen = true;
    },
    closeChapterPreview() {
      this.chapterPreviewOpen = false;
      this.chapterPreviewCourseId = 0;
      this.chapterPreviewHeadings = [];
    },
    notifyChapterImported() {
      this.chapterVersion++;
    },
  },
});
