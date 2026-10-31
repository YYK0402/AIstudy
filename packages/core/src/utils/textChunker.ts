// 文本分块：按段落切分，长块超过 maxChars 时切出
export function chunkText(text: string, maxChars: number = 2000): string[] {
  const lines = text.split(/\n+/);
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    // 单行超 maxChars：先落已累积部分，再行内顺序硬切，保证每块不超长且不改变内容顺序
    if (line.length > maxChars) {
      if (current.trim()) chunks.push(current.trim());
      for (let i = 0; i < line.length; i += maxChars) {
        chunks.push(line.slice(i, i + maxChars));
      }
      current = "";
      continue;
    }
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

// 判断一行是否为标题（markdown #/##/### 或编号模式：第X章/第X节/X.X）
function isHeadingLine(line: string): boolean {
  if (!line || line.length > 40) return false;
  if (/^#{1,3}\s+/.test(line)) return true;
  if (/^第[一二三四五六七八九十百\d]+[章节部编]/.test(line)) return true;
  if (/^\d+(\.\d+){1,2}[\s、．.．]/.test(line)) return true;
  return false;
}

// 判断一行是否为章级标题（markdown 单 #，或「第X章/部/编/讲」；##、###、第X节、X.X 均属非章级）
function isChapterHeadingLine(line: string): boolean {
  if (!line || line.length > 40) return false;
  if (/^#\s+/.test(line)) return true;
  if (/^第[一二三四五六七八九十百\d]+[章部编讲]/.test(line)) return true;
  return false;
}

// 按章切分：一块 = 完整一章（含章内节结构），供 AI 抽取时看到整章上下文。
// 与 chunkByMarkdownHeadings 的区别：节级标题不断块，只在章级标题处断。
export function chunkByChapters(text: string): HeadingChunk[] {
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
    if (isChapterHeadingLine(trimmed)) {
      flush();
      title = trimmed.replace(/^#\s+/, "");
      contentLines = [];
    } else {
      contentLines.push(line);
    }
  }
  flush();
  return chunks;
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
      title = trimmed.replace(/^#{1,3}\s+/, "");
      contentLines = [];
    } else {
      contentLines.push(line);
    }
  }
  flush();
  return chunks;
}