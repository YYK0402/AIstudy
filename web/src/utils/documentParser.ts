// 文档文本解析（前端）：读取 File，提取 markdown 文本与标题结构
import * as pdfjsLib from "pdfjs-dist";
import mammoth from "mammoth/mammoth.browser";
import JSZip from "jszip";

// pdfjs-dist 需要设置 worker 路径；经 vite 构建后 worker 会被内联为 data URL
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export interface ParsedHeading {
  level: number;
  text: string;
}

export interface ParsedDocument {
  name: string;
  fileType: string;
  /** markdown 文本（含标题层级，用于落库思源与 AI 抽取） */
  contentText: string;
  /** 标题结构（用于章节识别） */
  headings: ParsedHeading[];
}

interface ParsedContent {
  markdown: string;
  headings: ParsedHeading[];
}

/** 判断标题层级：1=章，2=节，0=非标题。只识别明确的章/节编号（第X章/第X节/X.X），避免误判三级标题 */
function detectHeadingLevel(text: string): number {
  // 章：第X章 / 第X部 / 第X编
  if (/^第[一二三四五六七八九十百\d]+[章部编]/.test(text)) return 1;
  // 节：第X节
  if (/^第[一二三四五六七八九十百\d]+节/.test(text)) return 2;
  // 节：X.X / X.X.X
  if (/^\d+(\.\d+){1,2}[\s、．.．]/.test(text)) return 2;
  return 0;
}

/** 从 markdown 中提取一级/二级标题（### 及更深层级忽略）。支持编号模式识别（无 # 标记的纯文本标题）。 */
function extractHeadingsFromMarkdown(markdown: string): ParsedHeading[] {
  const headings: ParsedHeading[] = [];
  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^(#{1,2})\s+(.+?)\s*$/);
    const markLevel = m ? m[1].length : 0;
    const text = m ? m[2].trim() : trimmed;
    if (!text || text.length > 40) continue;
    // 层级判断：编号模式优先，其次 markdown 标记
    const level = detectHeadingLevel(text) || markLevel;
    if (level > 0) {
      headings.push({ level, text });
    }
  }
  return headings;
}

async function parseTxt(arrayBuffer: ArrayBuffer): Promise<ParsedContent> {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(arrayBuffer);
    if (text.includes("\uFFFD")) {
      try {
        text = new TextDecoder("gbk").decode(arrayBuffer);
      } catch {
        // 保留带替换符的 utf-8 结果
      }
    }
  } catch {
    text = new TextDecoder("gbk").decode(arrayBuffer);
  }
  return { markdown: text, headings: extractHeadingsFromMarkdown(text) };
}

async function parsePdf(arrayBuffer: ArrayBuffer): Promise<ParsedContent> {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  // 聚合所有行：每行 = { 文本, 字号 }（字号用于启发式识别标题）
  const lines: Array<{ text: string; height: number }> = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const items = content.items as Array<{
      str?: string;
      transform?: number[];
      height?: number;
      width?: number;
    }>;
    // 页面尺寸，用于过滤页眉页脚
    const viewport = page.getViewport({ scale: 1 });
    const pageHeight = viewport.height;

    // 按 y 坐标聚合成行
    const rows: Array<{ y: number; parts: Array<{ x: number; str: string; height: number; width: number }> }> = [];
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const y = it.transform?.[5] ?? 0;
      const x = it.transform?.[4] ?? 0;
      const height = Math.abs(it.transform?.[3] ?? it.height ?? 12);
      const width = it.width ?? 0;
      // 过滤页眉页脚（顶部/底部固定区域的重复文本）
      if (y > pageHeight - 70 || y < 70) continue;
      let row = rows.find((r) => Math.abs(r.y - y) < 3);
      if (!row) {
        row = { y, parts: [] };
        rows.push(row);
      }
      row.parts.push({ x, str: it.str, height, width });
    }
    // pdfjs 的 y 坐标从下往上（原点在左下角），降序排序 = 从上往下的视觉顺序
    rows.sort((a, b) => b.y - a.y);
    for (const row of rows) {
      row.parts.sort((a, b) => a.x - b.x);
      // 按 x 间隙补空格（词间距/表格多列），避免文字粘连
      let text = "";
      let prevRight: number | null = null;
      for (const p of row.parts) {
        if (prevRight !== null && p.x - prevRight > 5) {
          text += " ";
        }
        text += p.str;
        prevRight = p.x + p.width;
      }
      const trimmed = text.trim();
      if (!trimmed) continue;
      const height = Math.max(...row.parts.map((p) => p.height));
      lines.push({ text: trimmed, height });
    }
  }

  // 字号中位数作为正文字号基线，明显更大者判定为标题（启发式，best-effort）
  const heights = lines.map((l) => l.height).sort((a, b) => a - b);
  const median = heights.length ? heights[Math.floor(heights.length / 2)] : 12;

  let markdown = "";
  const headings: ParsedHeading[] = [];
  for (const line of lines) {
    // 层级判断：编号模式（第X章/第X节/X.X）优先，字号启发式兜底
    const numLevel = detectHeadingLevel(line.text);
    const sizeLevel = line.height > median * 1.35 ? 1 : line.height > median * 1.12 ? 2 : 0;
    const level = numLevel || sizeLevel;
    if (level === 1) {
      markdown += `# ${line.text}\n\n`;
      headings.push({ level: 1, text: line.text });
    } else if (level === 2) {
      markdown += `## ${line.text}\n\n`;
      headings.push({ level: 2, text: line.text });
    } else {
      markdown += `${line.text}\n`;
    }
  }
  return { markdown, headings };
}

async function parseDocx(arrayBuffer: ArrayBuffer): Promise<ParsedContent> {
  // convertToMarkdown 将 Word 的标题样式映射为 # / ## 标题
  const result = await mammoth.convertToMarkdown({ arrayBuffer });
  const markdown = result.value;
  return { markdown, headings: extractHeadingsFromMarkdown(markdown) };
}

interface PptxShape {
  type: string;
  text: string;
}

function extractPptxShapes(xml: string): PptxShape[] {
  const shapes: PptxShape[] = [];
  const spRegex = /<p:sp[\s\S]*?<\/p:sp>/g;
  let m: RegExpExecArray | null;
  while ((m = spRegex.exec(xml))) {
    const sp = m[0];
    const typeMatch = sp.match(/<p:ph type=["']([^"']*)["']/);
    const type = typeMatch ? typeMatch[1] : "";
    // 按段落 <a:p> 提取，段落内 <a:t> 拼接，段落间换行分隔
    const paragraphs: string[] = [];
    const pRegex = /<a:p[\s\S]*?<\/a:p>/g;
    let pm: RegExpExecArray | null;
    while ((pm = pRegex.exec(sp))) {
      const pText = [...pm[0].matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)]
        .map((x) => x[1])
        .join("")
        .trim();
      if (pText) paragraphs.push(pText);
    }
    const text = paragraphs.join("\n");
    if (text) {
      shapes.push({ type, text });
    }
  }
  return shapes;
}

async function parsePptx(arrayBuffer: ArrayBuffer): Promise<ParsedContent> {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort();
  let markdown = "";
  const headings: ParsedHeading[] = [];
  for (const name of slideNames) {
    const xml = await zip.files[name].async("string");
    const shapes = extractPptxShapes(xml);
    // 标题占位符优先；无占位符时用第一个非空形状作为标题
    const titleShape = shapes.find((s) => s.type === "title" || s.type === "ctrTitle" || s.type === "subTitle");
    const title = titleShape ? titleShape.text : shapes[0]?.text;
    const bodies = shapes
      .filter((s) => s !== titleShape)
      .filter((s) => s.text !== title)
      .map((s) => s.text);
    if (title) {
      markdown += `# ${title}\n\n`;
      headings.push({ level: 1, text: title });
    }
    if (bodies.length) {
      markdown += `${bodies.join("\n\n")}\n\n`;
    }
  }
  return { markdown: markdown.trim(), headings };
}

export function detectFileType(file: File): string {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "txt") return "txt";
  if (ext === "md" || ext === "markdown") return "md";
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "pptx") return "pptx";
  return ext || "unknown";
}

export async function parseDocument(file: File): Promise<ParsedDocument> {
  const arrayBuffer = await file.arrayBuffer();
  const fileType = detectFileType(file);
  let content: ParsedContent;
  switch (fileType) {
    case "txt":
    case "md":
      content = await parseTxt(arrayBuffer);
      break;
    case "pdf":
      content = await parsePdf(arrayBuffer);
      break;
    case "docx":
      content = await parseDocx(arrayBuffer);
      break;
    case "pptx":
      content = await parsePptx(arrayBuffer);
      break;
    default:
      content = {
        markdown: `[暂不支持解析该文件类型: .${fileType}]`,
        headings: [],
      };
  }
  return { name: file.name, fileType, contentText: content.markdown, headings: content.headings };
}

export async function parseTextInput(text: string): Promise<ParsedDocument> {
  return {
    name: `粘贴文本 ${new Date().toLocaleString("zh-CN")}`,
    fileType: "text",
    contentText: text,
    headings: extractHeadingsFromMarkdown(text),
  };
}
