/**
 * Structural IO seam for the evolution plugin family.
 *
 * Every evolution package passes `ctx.evolutionIo.provider()`; standalone
 * consumers (and the core's own tests) can use `nodeEvolutionIo`.
 */

import { cp, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
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
  /**
   * Optional atomic read-modify-write on one file: the read and the write run
   * inside a single cross-process lock, so two processes that share DSH_HOME
   * cannot interleave their RMW sequences. `task` receives the current content
   * (`null` when missing) and returns the next content; returning `null`
   * deletes the file. A backend without it falls back to plain read+write and
   * the caller keeps its single-process chain as the second layer.
   */
  transact?(this: void, path: string, task: (current: string | null) => Promise<string | null>): Promise<void>
  /**
   * Optional symlink probe (G7). `true` = the path is a symlink, `false` = a
   * real entry, `null` = guard not applicable (backend without the probe or
   * the path does not exist). Consumers treat `null` as "let it through".
   */
  isSymlink?(this: void, path: string): Promise<boolean | null>
}

/**
 * Run `task` inside `io.transact` when the backend provides it; otherwise fall
 * back to a plain read → task → write/remove sequence (no cross-process lock —
 * callers keep their single-process serialize chain as the second layer).
 */
export async function transactIo(
  io: EvolutionIoLike,
  path: string,
  task: (current: string | null) => Promise<string | null>,
): Promise<void> {
  if (io.transact) {
    await io.transact(path, task)
    return
  }
  const current = await io.readText(path)
  const next = await task(current)
  if (next === null) await io.remove(path)
  else await io.writeText(path, next)
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
    // Transact and symlink probes are forwarding-only: the fallback semantics
    // live in the consumer helper / the backend itself.
    transact: (path, task) => {
      const io = provider()
      return io.transact ? io.transact(path, task) : transactIo(io, path, task)
    },
    isSymlink: (path) => {
      const io = provider()
      return io.isSymlink ? io.isSymlink(path) : Promise.resolve(null)
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
    async transact(path, task) {
      await mkdir(dirname(path), { recursive: true })
      await withWriteLock(path, async () => {
        let current: string | null
        try {
          current = await readFile(path, 'utf8')
        } catch (error) {
          // Only "missing" maps to null; any other read failure surfaces so an
          // unreadable store is never treated as empty and overwritten.
          if (isMissing(error)) current = null
          else throw error
        }
        const next = await task(current)
        if (next === null) {
          await rm(path, { force: true })
          return
        }
        const tmp = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
        await writeFile(tmp, next, 'utf8')
        await rename(tmp, path)
      })
    },
    async remove(path) {
      await rm(path, { recursive: true, force: true })
    },
    async list(path) {
      // "Missing" reads as empty; any other failure (EACCES/EIO) surfaces so a
      // caller never mistakes an unreadable tree for an empty one (rc.50 P2-4).
      try { return await readdir(path) } catch (error) {
        if (isMissing(error)) return []
        throw error
      }
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
    async isSymlink(path) {
      try { return (await lstat(path)).isSymbolicLink() } catch {
        // Guard not applicable: missing path or an lstat failure never blocks.
        return null
      }
    },
  }
}
