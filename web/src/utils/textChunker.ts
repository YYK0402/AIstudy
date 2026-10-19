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