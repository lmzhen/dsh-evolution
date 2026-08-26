/**
 * Small crash-safe JSON state store for plugin-owned sidecar state.
 * Writes are atomic (temp + rename). Reads are synchronous for startup use.
 */

import { readFileSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { randomBytes } from 'node:crypto'

export function evolutionHome(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.DSH_HOME ?? join(homedir(), '.dsh'), 'evolution')
}

export class JsonState<T> {
  readonly path: string
  private value: T

  constructor(
    name: string,
    private readonly initial: T,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    this.path = join(evolutionHome(env), name)
    this.value = this.loadSync()
  }

  /**
   * Deep-merge persisted state over the initial defaults. Nested plain
   * objects merge recursively (so a new default field added under an existing
   * object is preserved), while arrays and primitives take the on-disk value
   * wholesale. Keeps forward-compatible defaults across schema additions.
   */
  private static mergeDeep<T>(initial: T, persisted: unknown): T {
    const isRecord = (v: unknown): v is Record<string, unknown> =>
      typeof v === 'object' && v !== null && !Array.isArray(v)
    if (!isRecord(initial) || !isRecord(persisted)) {
      // Single values: the persisted value wins when present, otherwise the
      // initial default stands. Arrays are treated as opaque values.
      return (isRecord(persisted) ? persisted : (persisted == null ? initial : persisted)) as T
    }
    const out: Record<string, unknown> = { ...initial }
    for (const [key, value] of Object.entries(persisted)) {
      out[key] = key in initial
        ? JsonState.mergeDeep((initial as Record<string, unknown>)[key], value)
        : value
    }
    return out as T
  }

  private loadSync(): T {
    try {
      const raw = readFileSync(this.path, 'utf8')
      const parsed = JSON.parse(raw) as T
      return JsonState.mergeDeep(this.initial, parsed)
    } catch {
      return { ...this.initial }
    }
  }

  get(): T {
    return this.value
  }

  set(value: T): void {
    this.value = value
  }

  update(mutator: (value: T) => void): void {
    mutator(this.value)
  }

  async flush(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
    await writeFile(tmp, JSON.stringify(this.value, null, 2), 'utf8')
    await rename(tmp, this.path)
  }

  /** Merge-on-load helper for persisted maps/records. */
  async reload(): Promise<void> {
    try {
      const raw = await readFile(this.path, 'utf8')
      this.value = JsonState.mergeDeep(this.initial, JSON.parse(raw) as T)
    } catch {
      this.value = { ...this.initial }
    }
  }
}
