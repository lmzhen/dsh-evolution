/** The one owner of plugin `<style>` tags; a new owner replaces the old tag so the
 * old disposer only removes a detached node. */
export function injectPluginStyles(doc: Document | undefined, css: string, tagId: string): () => void {
  if (doc === undefined) return () => {}
  doc.querySelector('style[data-plugin-css="' + tagId + '"]')?.remove()
  const tag = doc.createElement('style')
  tag.setAttribute('data-plugin-css', tagId)
  tag.textContent = css
  doc.head.append(tag)
  return () => { tag.remove() }
}
