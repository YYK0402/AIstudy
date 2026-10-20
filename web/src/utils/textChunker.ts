// 文本分块：按段落切分，长块超过 maxChars 时切出
export function chunkText(text: string, maxChars: number = 2000): string[] {
  const lines = text.split(/\n+/);
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    const lineLen = line.length;
    if (current.length > 0 && current.length + lineLen + 1 > maxChars) {
      chunks.push(current.trim());
      current = "";
    }
    current += (current ? "\n" : "") + line;
  }
  if (current.trim()) {
    chunks.push(current.trim());
  }
  if (chunks.length === 0 && text.length > 0) {
    chunks.push(text);
  }
  return chunks;
}

export interface HeadingChunk {
  title: string;
  content: string;
}

// 判断一行是否为标题（markdown #/## 或编号模式：第X章/第X节/X.X/一、/（一））
function isHeadingLine(line: string): boolean {
  if (!line || line.length > 40) return false;
  if (/^#{1,2}\s+/.test(line)) return true;
  if (/^第[一二三四五六七八九十百\d]+[章节部编]/.test(line)) return true;
  if (/^\d+(\.\d+){1,2}[\s、．.．]/.test(line)) return true;
  if (/^[一二三四五六七八九十]+[、．.]/.test(line)) return true;
  if (/^[（(][一二三四五六七八九十\d]+[)）]/.test(line)) return true;
  return false;
}

// 按标题（markdown 或编号模式）切分，返回 { 标题, 内容 } 片段。
// 相比固定字符分块，按标题切分语义更完整、块数更少，可显著降低 AI 抽取的 token 消耗。
export function chunkByMarkdownHeadings(text: string): HeadingChunk[] {
  const lines = text.split("\n");
  const chunks: HeadingChunk[] = [];
  let title = "";
  let contentLines: string[] = [];
  const flush = () => {
    if (title || contentLines.some((l) => l.trim())) {
      chunks.push({ title, content: contentLines.join("\n").trim() });
    }
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (isHeadingLine(trimmed)) {
      flush();
      title = trimmed.replace(/^#{1,2}\s+/, "");
      contentLines = [];
    } else {
      contentLines.push(line);
    }
  }
  flush();
  return chunks;
}