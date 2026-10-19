// 文档文本解析（前端）：读取 File，提取纯文本
import * as pdfjsLib from "pdfjs-dist";
import mammoth from "mammoth/mammoth.browser";
import JSZip from "jszip";

// pdfjs-dist 4.x 需要设置 worker 路径
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export interface ParsedDocument {
  name: string;
  fileType: string;
  contentText: string;
}

async function parseTxt(arrayBuffer: ArrayBuffer): Promise<string> {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(arrayBuffer);
    if (text.includes("\uFFFD")) {
      try {
        return new TextDecoder("gbk").decode(arrayBuffer);
      } catch {
        return text;
      }
    }
    return text;
  } catch {
    return new TextDecoder("gbk").decode(arrayBuffer);
  }
}

async function parsePdf(arrayBuffer: ArrayBuffer): Promise<string> {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const items = content.items as Array<{ str?: string }>;
    text += items.map((item) => item.str ?? "").join(" ") + "\n";
  }
  return text;
}

async function parseDocx(arrayBuffer: ArrayBuffer): Promise<string> {
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

async function parsePptx(arrayBuffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort();
  const texts: string[] = [];
  for (const name of slideNames) {
    const xml = await zip.files[name].async("string");
    const matches = xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g);
    for (const m of matches) {
      if (m[1]) {
        texts.push(m[1]);
      }
    }
  }
  return texts.join("\n");
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
  let contentText = "";
  switch (fileType) {
    case "txt":
    case "md":
      contentText = await parseTxt(arrayBuffer);
      break;
    case "pdf":
      contentText = await parsePdf(arrayBuffer);
      break;
    case "docx":
      contentText = await parseDocx(arrayBuffer);
      break;
    case "pptx":
      contentText = await parsePptx(arrayBuffer);
      break;
    default:
      contentText = `[暂不支持解析该文件类型: .${fileType}]`;
  }
  return { name: file.name, fileType, contentText };
}

export async function parseTextInput(text: string): Promise<ParsedDocument> {
  return {
    name: `粘贴文本 ${new Date().toLocaleString("zh-CN")}`,
    fileType: "text",
    contentText: text,
  };
}