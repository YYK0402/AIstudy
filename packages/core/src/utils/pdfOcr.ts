// 扫描件 PDF OCR：逐页渲染成 PNG，上传到宿主资源目录调 OCR，完成后清理临时图片
import * as pdfjsLib from "pdfjs-dist";
import { uploadAsset } from "../api";
import { getBridge } from "@/bridge";

/**
 * 逐页用宿主 OCR 识别纯图片 PDF，返回按页拼接的文本。
 * onProgress 在每页识别前回调（页码从 1 开始 / 总页数）。
 * 无论成功或失败，已上传的临时页图片都会被清理。
 */
export async function ocrPdfText(
  file: File,
  onProgress: (page: number, total: number) => void,
): Promise<string> {
  const ocr = getBridge().ocrAsset;
  if (!ocr) throw new Error("当前宿主不支持 OCR（capabilities.ocr = none）");
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const total = pdf.numPages;
  if (total === 0) return "";
  const uploaded: string[] = [];
  const texts: string[] = [];
  try {
    for (let i = 1; i <= total; i++) {
      onProgress(i, total);
      const page = await pdf.getPage(i);
      // scale 2 ≈ 144 DPI，兼顾识别质量与 PNG 体积
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvas, viewport }).promise;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error(`第 ${i} 页渲染失败`);
      const path = await uploadAsset(new File([blob], `ai-study-ocr-${Date.now()}-${i}.png`, { type: "image/png" }));
      uploaded.push(path);
      texts.push((await ocr(path)).trim());
    }
    return texts.join("\n\n");
  } finally {
    for (const p of uploaded) {
      try {
        await getBridge().removeAsset(p);
      } catch (e) {
        console.warn("清理 OCR 临时图片失败:", p, e);
      }
    }
  }
}
