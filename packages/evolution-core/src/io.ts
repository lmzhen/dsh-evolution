/**
 * Structural IO seam for the legacy facade stores.
 *
 * The facade accepts any object exposing this small async file-tree surface.
 * Native DSH packages pass `ctx.evolutionIo.provider()`; standalone consumers
 * (and the facade's own tests) can use `nodeEvolutionIo`.
 */

import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'

export interface EvolutionIoLike {
  readText(path: string): Promise<string | null>
  writeText(path: string, content: string): Promise<void>
  remove(path: string): Promise<void>
  list(path: string): Promise<string[]>
  exists(path: string): Promise<boolean>
  rename(path: string, destination: string): Promise<void>
  copy(path: string, destination: string): Promise<void>
  /**
   * Optional byte-size probe for the read guard. Return the file's size in
   * bytes, or `null`/`undefined` when unknown (unsupported backend, missing
   * file, stat failure). An implementation without this probe gets no guard:
   * consumers treat an unknown size as "guard not applicable".
   */
  size?(path: string): Promise<number | null>
}

/** Lazy adapter over an IO provider registry, shared by every evolution consumer. */
export function evolutionIoAdapter(provider: () => EvolutionIoLike): EvolutionIoLike {
  return {
    readText: path => provider().readText(path),
    writeText: (path, content) => provider().writeText(path, content),
    remove: path => provider().remove(path),
    list: path => provider().list(path),
    exists: path => provider().exists(path),
    rename: (path, destination) => provider().rename(path, destination),
    copy: (path, destination) => provider().copy(path, destination),
    // Never throws: a backend without a size probe means "guard not applicable".
    size: (path) => {
      const io = provider()
      return io.size ? io.size(path) : Promise.resolve(null)
    },
  }
}

export function nodeEvolutionIo(): EvolutionIoLike {
  const isMissing = (error: unknown): boolean => {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    return code === 'ENOENT' || code === 'ENOTDIR'
  }
  /**
   * Cross-process write lock (claw `withFileLock` parity): an O_EXCL lock file
   * guards the atomic write; a >5s-old lock is treated as stale and taken
   * over. After the retry budget the write proceeds unlocked — the lock is a
   * best-effort accommodation for multi-process deployments, never a read of
   * availability.
   */
  const withWriteLock = async <T>(path: string, task: () => Promise<T>): Promise<T> => {
    const lock = `${path}.lock`
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        await writeFile(lock, String(process.pid), { flag: 'wx' })
        try {
          return await task()
        } finally {
          await rm(lock, { force: true }).catch(() => {})
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException | undefined)?.code
        if (code !== 'EEXIST') throw error
        try {
          const st = await stat(lock)
          if (Date.now() - st.mtimeMs > 5000) {
            try { await rm(lock, { force: true }) } catch { /* raced with the holder */ }
            continue
          }
        } catch {
          continue // the lock vanished between fails
        }
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    }
    return await task()
  }
  return {
    async readText(path) {
      try { return await readFile(path, 'utf8') } catch (error) {
        // Only "missing" maps to null (the "not there" signal); any other
        // read failure (EACCES/EIO/EMFILE) surfaces so a caller never
        // mistakes an unreadable store for an empty one and overwrites it.
        if (isMissing(error)) return null
        throw error
      }
    },
    async writeText(path, content) {
      await mkdir(dirname(path), { recursive: true })
      await withWriteLock(path, async () => {
        const tmp = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
        await writeFile(tmp, content, 'utf8')
        await rename(tmp, path)
      })
    },
    async remove(path) {
      await rm(path, { recursive: true, force: true })
    },
    async list(path) {
      // Swallowed: an absent or unreadable directory reads as empty.
      try { return await readdir(path) } catch { return [] }
    },
    async exists(path) {
      try { await stat(path); return true } catch (error) {
        if (isMissing(error)) return false
        throw error
      }
    },
    async rename(path, destination) {
      await mkdir(dirname(destination), { recursive: true })
      await rename(path, destination)
    },
    async copy(path, destination) {
      await mkdir(dirname(destination), { recursive: true })
      await cp(path, destination, { recursive: true, force: true })
    },
    async size(path) {
      try { return (await stat(path)).size } catch (error) {
        if (isMissing(error)) return null
        throw error
      }
    },
  }
}
