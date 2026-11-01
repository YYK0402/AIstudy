// 落库文档路径校验：路径由课程/章节名（用户输入）拼接，
// 须防 `..` 段越出插件笔记本、`/` 注入额外层级、控制字符导致内核行为异常。
const MAX_SEGMENT_LENGTH = 128;

/** 校验落库文档路径格式；非法时抛错。格式：`/段/段/...`（绝对形式，段间单斜杠） */
export function validateDocPath(path: string): void {
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("落库路径非法：为空");
  }
  if (!path.startsWith("/")) {
    throw new Error("落库路径非法：须以 / 开头");
  }
  const segments = path.split("/").slice(1);
  if (segments.length === 0) {
    throw new Error("落库路径非法：无文档名");
  }
  for (const seg of segments) {
    if (seg.length === 0) {
      throw new Error("落库路径非法：存在空段（连续 / 或缺失段）");
    }
    if (seg === "." || seg === "..") {
      throw new Error("落库路径非法：段名不能为 . 或 ..");
    }
    if (seg.length > MAX_SEGMENT_LENGTH) {
      throw new Error(`落库路径非法：段名超过 ${MAX_SEGMENT_LENGTH} 字符`);
    }
    if (/[\u0000-\u001f]/.test(seg)) {
      throw new Error("落库路径非法：段名含控制字符");
    }
  }
}
