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
