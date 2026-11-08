import type { InjectionKey } from "vue";
import type { Chapter } from "../api";
import type { DropPos } from "../utils/chapterMove";

/** 章节树行上下文（CourseContentView provide，递归 ChapterTreeRow inject，免 props 逐层透传） */
export interface ChapterTreeCtx {
  isArchived(): boolean;
  isBatchMode(): boolean;
  isSelected(id: number): boolean;
  isBatchChecked(id: number): boolean;
  isExpanded(id: number): boolean;
  isRowMenuOpen(id: number): boolean;
  /** 该行的落点高亮位置（null = 无） */
  dropPos(id: number): DropPos | null;
  /** 当前拖拽中的节点 id（落自身行不提示） */
  draggingId(): number | null;
  toggleExpand(id: number): void;
  toggleSelect(id: number): void;
  closeRowMenu(): void;
  kpCountOf(id: number): number;
  addChapterChild(ch: Chapter): void;
  openReview(ch: Chapter): void;
  editChapter(ch: Chapter): void;
  delChapter(ch: Chapter): void;
  onRowDragLeave(id: number): void;
  onDragEnd(): void;
}

export const chapterTreeCtxKey: InjectionKey<ChapterTreeCtx> = Symbol("chapterTreeCtx");
