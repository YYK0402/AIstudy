// @vitest-environment jsdom
import { nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import KnowledgePointEditModal from "../KnowledgePointEditModal.vue";
import { createKnowledgePoint, queryChapters, updateKnowledgePoint } from "../../api";
import type { Chapter, KnowledgePoint } from "../../api";

vi.mock("../../api", () => ({
  docsEnabled: () => false,
  parseTagsInput: (s: string) => s.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
  queryChapters: vi.fn(),
  updateKnowledgePoint: vi.fn(),
  createKnowledgePoint: vi.fn(),
}));

function ch(id: number, parentId: number | null, level: number, sort: number, name: string): Chapter {
  return { id, courseId: 1, parentId, siyuanBlockId: null, name, level, sort };
}

// L1 → L2 → L3
const CHAPTERS = [
  ch(1, null, 1, 1, "第一章"),
  ch(2, 1, 2, 1, "1.1 节"),
  ch(3, 2, 3, 1, "1.1.1 小节"),
];

// 知识点已归属 L3（现状下拉不可见不可选的场景）
const KP: KnowledgePoint = {
  id: 10,
  courseId: 1,
  chapterId: 3,
  blockId: null,
  name: "测试知识点",
  content: "",
  mastery: "unlearn",
  sourceAssetIds: "",
  prevKpIds: "",
  chapterName: "1.1.1 小节",
  sort: 1,
  createTime: "2026-01-01",
};

let host: HTMLDivElement | null = null;
let wrapper: VueWrapper | null = null;

/** 组件 Teleport 到 .ai-study-app，直接查挂载点 DOM */
function q(sel: string): Element | null {
  return host?.querySelector(sel) ?? null;
}

/** 按行内章节名找下拉行 */
function rowOf(name: string): HTMLElement {
  const el = [...(host?.querySelectorAll(".ct-row") ?? [])].find(
    (r) => r.querySelector(".ct-name")?.textContent === name,
  );
  if (!el) throw new Error(`未找到下拉行: ${name}`);
  return el as HTMLElement;
}

function mountModal() {
  host = document.createElement("div");
  host.className = "ai-study-app";
  document.body.appendChild(host);
  wrapper = mount(KnowledgePointEditModal, { props: { open: true, courseId: 1, knowledgePoint: KP } });
}

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  host?.remove();
  host = null;
});

describe("KnowledgePointEditModal 归属章节下拉（N 级）", () => {
  it("L3 行出现在下拉、tag/缩进按深度，L3 可选且选中 label 正确", async () => {
    vi.mocked(queryChapters).mockResolvedValue(CHAPTERS);
    mountModal();
    await flushPromises();
    // 已归属 L3：触发器直接显示 L3 名称
    expect(q(".chapter-tree-trigger")!.textContent).toContain("1.1.1 小节");

    (q(".chapter-tree-trigger") as HTMLElement).click();
    await nextTick();
    // 三行均渲染，L3 不再缺失
    const l1 = rowOf("第一章");
    const l2 = rowOf("1.1 节");
    const l3 = rowOf("1.1.1 小节");
    expect(l1.style.paddingLeft).toBe("8px");
    expect(l2.style.paddingLeft).toBe("26px");
    expect(l3.style.paddingLeft).toBe("44px");
    // tag 按深度：章/节/小节
    expect(l1.querySelector(".tp-tag")!.className).toContain("chapter");
    expect(l2.querySelector(".tp-tag")!.className).toContain("unit");
    expect(l3.querySelector(".tp-tag")!.className).toContain("sub");
    expect(l3.querySelector(".tp-tag")!.textContent).toBe("小节");

    // 点 L3 选中：面板关闭，label 保持 L3
    l3.click();
    await nextTick();
    expect(q(".chapter-tree-panel")).toBeNull();
    expect(q(".chapter-tree-trigger")!.textContent).toContain("1.1.1 小节");
  });

  it("点 L1 行可选中顶层章并更新 label", async () => {
    vi.mocked(queryChapters).mockResolvedValue(CHAPTERS);
    mountModal();
    await flushPromises();
    (q(".chapter-tree-trigger") as HTMLElement).click();
    await nextTick();
    rowOf("第一章").click();
    await nextTick();
    expect(q(".chapter-tree-panel")).toBeNull();
    expect(q(".chapter-tree-trigger")!.textContent).toContain("第一章");
  });
});

describe("KnowledgePointEditModal 新建态", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("新建态：标题「新建知识点」、表单空、章节默认 defaultChapterId，保存走 createKnowledgePoint", async () => {
    vi.mocked(queryChapters).mockResolvedValue(CHAPTERS);
    vi.mocked(createKnowledgePoint).mockResolvedValue({ ...KP, id: 11 });
    host = document.createElement("div");
    host.className = "ai-study-app";
    document.body.appendChild(host);
    wrapper = mount(KnowledgePointEditModal, {
      props: { open: true, courseId: 1, knowledgePoint: null, defaultChapterId: 2 },
    });
    await flushPromises();
    expect(q(".modal h2")!.textContent).toBe("新建知识点");
    const nameInput = q('input[aria-label="知识点名称"]') as HTMLInputElement;
    expect(nameInput.value).toBe("");
    // 默认章节 = defaultChapterId（1.1 节）
    expect(q(".chapter-tree-trigger")!.textContent).toContain("1.1 节");

    nameInput.value = "手动知识点";
    nameInput.dispatchEvent(new Event("input"));
    await nextTick();
    (q(".btn.primary") as HTMLElement).click();
    await flushPromises();

    expect(vi.mocked(createKnowledgePoint)).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(createKnowledgePoint).mock.calls[0][0];
    expect(arg.courseId).toBe(1);
    expect(arg.chapterId).toBe(2);
    expect(arg.name).toBe("手动知识点");
    expect(arg.content).toBe("");
    expect(arg.mastery).toBe("unlearn");
    expect(arg.blockId).toBeNull();
    expect(vi.mocked(updateKnowledgePoint)).not.toHaveBeenCalled();
    expect(wrapper.emitted("saved")).toBeTruthy();
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("编辑态保存仍走 updateKnowledgePoint，不走 createKnowledgePoint", async () => {
    vi.mocked(queryChapters).mockResolvedValue(CHAPTERS);
    vi.mocked(updateKnowledgePoint).mockResolvedValue(undefined);
    mountModal();
    await flushPromises();
    expect(q(".modal h2")!.textContent).toBe("编辑知识点");
    (q(".btn.primary") as HTMLElement).click();
    await flushPromises();
    expect(vi.mocked(updateKnowledgePoint)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createKnowledgePoint)).not.toHaveBeenCalled();
  });
});
