/** Tool-result budget: keep the head and tail, mark what was omitted. */
export function fitToolText(text: string, max = 8000): string {
  if (text.length <= max) return text
  const marker = '\n... [truncated ' + String(text.length - max) + ' chars] ...\n'
  const keep = Math.max(0, max - marker.length)
  const head = Math.ceil(keep * 0.7)
  const tail = keep - head
  return text.slice(0, head) + marker + (tail === 0 ? '' : text.slice(-tail))
}
