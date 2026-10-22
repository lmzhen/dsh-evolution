// @tier pre-tag
import assert from 'node:assert/strict'
import test from 'node:test'
import { renderMarkdown } from '../src/domain/markdown.ts'

test('renders heading/list/code and escapes raw html', () => {
  const html = renderMarkdown('# T\n- a\n<script>x</script>\n\n```\n<b>c</b>\n```')
  assert.match(html, /<h1>T<\/h1>/)
  assert.match(html, /<li>a<\/li>/)
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/)
  assert.match(html, /&lt;b&gt;c&lt;\/b&gt;/)
})
