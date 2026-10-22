/** Minimal safe Markdown renderer for the read-only body route. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function renderMarkdown(source: string): string {
  const fence = String.fromCharCode(96, 96, 96)
  const lines = source.split(/\r?\n/)
  const out: string[] = []
  let inCode = false
  let inList = false
  for (const line of lines) {
    if (line.startsWith(fence)) {
      if (inCode) { out.push('</code></pre>'); inCode = false } else { out.push('<pre><code>'); inCode = true }
      continue
    }
    if (inCode) { out.push(escapeHtml(line)); continue }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading !== null) {
      if (inList) { out.push('</ul>'); inList = false }
      const level = heading[1]?.length ?? 1
      out.push('<h' + String(level) + '>' + escapeHtml(heading[2] ?? '') + '</h' + String(level) + '>')
      continue
    }
    if (/^[-*]\s+/.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true }
      out.push('<li>' + escapeHtml(line.replace(/^[-*]\s+/, '')) + '</li>')
      continue
    }
    if (inList) { out.push('</ul>'); inList = false }
    out.push(line.trim() === '' ? '' : '<p>' + escapeHtml(line) + '</p>')
  }
  if (inList) out.push('</ul>')
  if (inCode) out.push('</code></pre>')
  return out.join('\n')
}
