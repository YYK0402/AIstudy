const emojis = ["📐", "🌲", "📖", "📚", "🧪", "💻"];

export function emojiOf(id: number): string {
  return emojis[id % emojis.length];
}
