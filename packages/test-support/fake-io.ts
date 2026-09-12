/**
 * In-memory `EvolutionIoLike` fixture shared by the skill-store suites.
 *
 * `isSymlink` answers per entry through a `<path>.symlink` marker, so a suite
 * that needs a link writes the marker instead of touching the real filesystem.
 */
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'

export function fakeIo(): EvolutionIoLike & { files: Map<string, string> } {
  const files = new Map<string, string>()
  const normalize = (path: string) => path.replaceAll('\\', '/')
  const children = (path: string) => {
    const prefix = normalize(path).replace(/[\\/]+$/, '') + '/'
    const names = new Set<string>()
    for (const key of files.keys()) {
      if (!key.startsWith(prefix)) continue
      const rest = key.slice(prefix.length)
      const name = rest.split('/')[0]
      if (name) names.add(name)
    }
    return [...names]
  }
  const removePrefix = (path: string) => {
    const prefix = normalize(path).replace(/[\\/]+$/, '') + '/'
    for (const key of [...files.keys()]) {
      if (key === normalize(path) || key.startsWith(prefix)) files.delete(key)
    }
  }
  return {
    files,
    async readText(path) { return files.get(normalize(path)) ?? null },
    async writeText(path, content) { files.set(normalize(path), content) },
    async remove(path) { removePrefix(path) },
    async list(path) { return children(path) },
    async exists(path) {
      const key = normalize(path)
      if (files.has(key)) return true
      const prefix = key.replace(/\/$/, '') + '/'
      return [...files.keys()].some(file => file.startsWith(prefix))
    },
    async rename(_path, _destination) { throw new Error('rename unsupported') },
    async copy(path, destination) {
      const prefix = normalize(path).replace(/[\\/]+$/, '') + '/'
      const destPrefix = normalize(destination).replace(/\/$/, '') + '/'
      for (const [key, value] of files) {
        if (key === normalize(path) || key.startsWith(prefix)) {
          const suffix = key === normalize(path) ? key.slice(key.lastIndexOf('/') + 1) : key.slice(prefix.length)
          files.set(destPrefix + suffix, value)
        }
      }
    },
    // G7 fake: the probe answers per-entry symlink-ness (default: not a link).
    async isSymlink(path) {
      const key = normalize(path)
      return files.get(`${key}.symlink`) === 'true'
    },
  }
}
