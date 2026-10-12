/**
 * Structural IO seam for the evolution plugin family.
 *
 * Every evolution package passes `ctx.evolutionIo.provider()`; standalone
 * consumers (and the core's own tests) can use `nodeEvolutionIo`.
 */

import { copyFileSync, existsSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { cp, lstat, mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
// v43 S1-4: the family's ONE definition of "this read failure means it is not
// there" lives in probe.ts; this backend delegates instead of keeping a second
// copy of the same two codes.
import { isMissingPath } from './probe.ts'

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
   * bytes, or `null` when the file does not exist (ENOENT/ENOTDIR);
   * V8-23⑨ (0.3.49): the doc claimed "stat failure → null" but the
   * implementation propagates other stat errors — only missing-file is a
   * "guard not applicable" signal, a real stat failure is an IO error.
   * An implementation without this probe gets no guard: consumers treat an
   * unknown size as "guard not applicable".
   */
  size?(path: string): Promise<number | null>
  /**
   * Optional atomic read-modify-write on one file: the read and the write run
   * inside a single cross-process lock, so two processes that share DSH_HOME
   * cannot interleave their RMW sequences. `task` receives the current content
   * (`null` when missing) and returns the next content; returning `null`
   * deletes the file. A backend without it falls back to plain read+write and
   * the caller keeps its single-process chain as the second layer.
   * 0.3.16: sync returns are allowed (0.3.16 S1.14 X-1 — mutated callers with
   * no await in the task need no Promise residue).
   */
  transact?(this: void, path: string, task: (current: string | null) => string | null | Promise<string | null>): Promise<void>
  /**
   * Optional symlink probe (G7). `true` = the path is a symlink, `false` = a
   * real entry, `null` = guard not applicable (backend without the probe or
   * the path does not exist). Consumers treat `null` as "let it through".
   */
  isSymlink?(this: void, path: string): Promise<boolean | null>
  /**
   * Optional mtime-generation probe (0.3.18, E-71): the path's mtime in
   * milliseconds since epoch, or `null` when unknown (unsupported backend,
   * missing path, stat failure). Intended as a cheap invalidation stamp for a
   * cached directory listing; a backend without it keeps event-driven
   * invalidation only. v20 correction: the former "NO in-tree consumer" note
   * (V9-07, 0.3.51) went stale — in-tree consumers exist, and a
   * custom backend that omits `mtime` degrades them silently (every call
   * site is optional-call + null-fallback, so omission stays legal):
   *   - evolution-curator: run-report recency ordering (2 call sites);
   *   - evolution-commands: `.bak` freshness probe in the preset installer.
   * S3-P2-10: evolution-skill-catalog's summaries stamp — the third consumer —
   * moved to a NAMES-based stamp over `list()` (a required seam method): the
   * root-mtime stamp was invalidated by the family's own sidecar flushes in
   * the watched root, so every usage-counter write paid a full rescan. The
   * names stamp is sidecar-immune and works on mtime-less backends. Register
   * new consumers here (the seam contract).
   */
  mtime?(this: void, path: string): Promise<number | null>
}

/**
 * Run `task` inside `io.transact` when the backend provides it; otherwise fall
 * back to a plain read → task → write/remove sequence (no cross-process lock —
 * callers keep their single-process serialize chain as the second layer). A
 * byte-identical task result skips the write (C-07 — parity with the
 * node backend's V5-03 short-circuit).
 */
export async function transactIo(
  io: EvolutionIoLike,
  path: string,
  task: (current: string | null) => string | null | Promise<string | null>,
): Promise<void> {
  // V27 G1.3: a dir-fsync failure AFTER the rename (`committed: true`) means the
  // bytes ARE on disk. Every durable consumer in this family reaches its write
  // through this helper, so the tolerance lives here instead of in seven
  // packages: propagating it made memory/usage/mutations/state/activity/
  // feedback/events report "not written" for a write that happened, and a
  // two-phase caller could then roll back a visible write. The durability loss
  // is still observable — it is logged, not swallowed.
  const committedOnly = (error: unknown): boolean => isCommittedWarning(error)
  if (io.transact) {
    try {
      await io.transact(path, task)
      return
    } catch (error) {
      if (!committedOnly(error)) throw error
      console.warn(`evolution-io: ${path} was written but its directory fsync failed — the bytes are visible, durability is unconfirmed: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
  }
  const current = await io.readText(path)
  const next = await task(current)
  if (next === null) await io.remove(path)
  // C-07: a byte-identical result is a no-op — the same V5-03
  // short-circuit the node backend's transact already has. Without it every
  // fallback RMW churned a tmp+rename and touched the mtime even when nothing
  // changed, so transact-less backends behaved asymmetrically.
  else if (next !== current) {
    try {
      await io.writeText(path, next)
    } catch (error) {
      if (!committedOnly(error)) throw error
      console.warn(`evolution-io: ${path} was written but its directory fsync failed — the bytes are visible, durability is unconfirmed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

/**
 * V43 F-4 (S0-6): the shared "the transaction really invoked the task" guard.
 * A backend that implements `transact` but never calls `task` resolves
 * cleanly, so every caller that reads the outcome out of the task itself (a
 * result slot filled inside it, a `Promise<void>` save path) reported success
 * for a write that never happened — the silent-lost-write family the inline
 * C-01 (memory-store) and V6-19 (skill-store) guards cover one call site at a
 * time. Wrap the task handed to `transactIo`/`io.transact` and probe after
 * the call: `invoked()` for a path that owns a structured refusal, or
 * `assertInvoked()` for a void-returning path with no result channel (the
 * family's fail-loud discipline, same wording as skill-store's guard).
 *
 * The wrapper is an identity pass-through — neither the backend nor the task
 * sees a difference — and a task that IS invoked but skips the write (a
 * dedupe no-op) counts as invoked: the probe answers "did the write path get
 * to decide", not "did bytes change".
 * @param what - the write being attempted, named in the thrown message
 */
export interface TransactTaskGuard {
  /** Wrap the task handed to the transact backend, marking its invocation. */
  wrap<A, R>(task: (current: A) => R): (current: A) => R
  /** Did the backend invoke the wrapped task? */
  invoked(): boolean
  /** Throw when the backend never invoked it (nothing was written). */
  assertInvoked(): void
}

/** Build a {@link TransactTaskGuard} for one write path. See its doc. */
export function transactTaskGuard(what: string): TransactTaskGuard {
  let invoked = false
  return {
    wrap: <A, R>(task: (current: A) => R): ((current: A) => R) => (current: A): R => {
      invoked = true
      return task(current)
    },
    invoked: () => invoked,
    assertInvoked: () => {
      if (invoked) return
      throw new Error(`internal error: the write transaction for ${what} did not invoke the task; no write was performed`)
    },
  }
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
    // Never throws: a backend without the probe reports null (cache keeps its
    // event-driven invalidation only — 0.3.18, E-71).
    mtime: (path) => {
      const io = provider()
      return io.mtime ? io.mtime(path) : Promise.resolve(null)
    },
  }
}


// C-28: the transient-EPERM/EBUSY retry budget grows from 3x50ms
// (~150ms — shorter than a real antivirus/indexer scan window) to ~2s, the
// same magnitude as the write-lock retry budget (rc.69), with exponential
// backoff so a short hold recovers fast and a long hold still recovers.
const RENAME_RETRY_BASE_MS = 50
const RENAME_RETRY_MAX_DELAY_MS = 800
// 50 + 100 + 200 + 400 + 800 + 800 = 2350ms of backoff (~2s budget).
const RENAME_RETRY_MAX_ATTEMPTS = 6

/**
 * Retry a rename that a peer is temporarily holding on Windows (EPERM/EBUSY):
 * exponential backoff (50ms doubling, capped at 800ms) with a ~2s total
 * budget, matching the write-lock cadence (C-28 — the old 3x50ms
 * budget turned a transient antivirus hold into a permanent write failure).
 * A non-transient code surfaces immediately; a persistent EPERM/EBUSY
 * rethrows with a pointer at the usual causes instead of a bare errno.
 * `fn` is the rename primitive, injectable for deterministic tests.
 *
 * v22 (LOCK-5) documented platform limit: POSIX rename-over-existing is
 * atomic for concurrent READERS, but Windows MoveFileExW(REPLACE_EXISTING)
 * can make the target briefly invisible (ENOENT) while the replacement is in
 * flight. The retry budget above covers the WRITE side only — a LOCKLESS
 * reader (`readText`/`readJson` on a path it does not hold the lock for) can
 * observe that window and see "missing" for a file that was just committed.
 * Verified harmless today: every lockless-read consumer treats the transient
 * miss as self-healing state (no consumer persists a read of null into a
 * write), and distinguishing that ENOENT from a genuinely absent file in
 * `readText` would tax every ordinary missing-file probe. Revisit only if a
 * consumer appears that must never transiently miss.
 *
 * @param tmp - the source path to rename.
 * @param target - the destination path.
 * @param fn - the rename primitive (defaults to `node:fs/promises.rename`).
 * @returns a promise that resolves once the rename succeeds.
 */
export async function renameWithRetry(
  tmp: string,
  target: string,
  fn: (from: string, to: string) => Promise<void> = rename,
): Promise<void> {
  for (let retry = 0; ; retry += 1) {
    try {
      await fn(tmp, target)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      if (code !== 'EPERM' && code !== 'EBUSY') throw error
      if (retry >= RENAME_RETRY_MAX_ATTEMPTS) {
        // C-28: keep the original message (callers match on it) and
        // append the direction a bare EPERM never gave: the target — not the
        // tmp — is the thing being held or refused.
        const final = error as NodeJS.ErrnoException
        final.message = `${final.message} (persisted after ${retry + 1} rename attempts over ~2s — the target may be held by another process or marked read-only; check antivirus, search indexers and file attributes)`
        throw final
      }
      await new Promise(resolve =>
        setTimeout(resolve, Math.min(RENAME_RETRY_BASE_MS * 2 ** retry, RENAME_RETRY_MAX_DELAY_MS)))
    }
  }
}

/**
 * V10-06 (P1-1): the crash-durable tmp half of the upstream storage-json
 * `writeAtomic` protocol (storage-json/src/atomic.ts:24-40): exclusive-create
 * a same-directory tmp (`wx` — never clobbers), write, `handle.sync()`,
 * close, then hand the tmp to `commitTmp` for the rename. Without the fsync a
 * power loss could land the rename (metadata) before the data blocks and
 * leave an empty/truncated target — which the state-json E-9 quarantine then
 * amplifies into a permanent fail-loud. The tmp name keeps the
 * `<target>.<pid>.<rand>.tmp` shape so sweepStaleTmps keeps matching.
 * Mode parity note: no explicit mode is passed (upstream uses 0o600) — this
 * seam also writes operator-editable skill/memory files, so the previous
 * `writeFile` default (0o666 & ~umask) is deliberately preserved.
 * `openImpl` is injectable so the sync-failure regression test can drive a
 * failing `handle.sync()` deterministically.
 */
export async function writeDurableTmp(
  target: string,
  content: string,
  openImpl: typeof open = open,
): Promise<string> {
  const tmp = `${target}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  try {
    // P3-9 (v14): commitTmp renames the tmp ONTO the target, so the target
    // inherits the tmp's inode and mode. Without carrying the target's own
    // mode, a file an operator tightened to 0o600 silently widened to
    // 0o666 & ~umask on the next write. POSIX only — Windows ignores mode bits.
    const mode = process.platform === 'win32'
      ? undefined
      : await stat(target).then(value => value.mode & 0o777).catch(() => undefined)
    const handle = await openImpl(tmp, 'wx', mode)
    try {
      await handle.writeFile(content, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    return tmp
  } catch (error) {
    // Never leak the tmp of a failed durable write (same tail as upstream).
    await rm(tmp, { force: true }).catch(() => {})
    throw error
  }
}

/** V10-06 (P1-1): fsync a POSIX directory so a just-renamed entry is
 * crash-durable (upstream atomic.ts `fsyncDirectory`). */
/* v8 ignore start -- Windows rejects O_RDONLY directory opens; POSIX coverage exercises this. */
async function fsyncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}
/* v8 ignore stop */

/**
 * F-366: commit a freshly-written tmp to its target inside the write lock. On a
 * still-failing rename the tmp is deleted immediately rather than left for the
 * (1h + dead-pid) sweep, so a live writer never leaks a tmp it abandoned.
 * V10-06 (P1-1): after a successful rename the parent directory is fsynced on
 * POSIX so the new directory entry itself is crash-durable (upstream atomic.ts
 * tail; Windows skips — it rejects O_RDONLY directory opens). A dir-fsync
 * failure propagates like upstream: the data is on disk, but the durability
 * contract failed loud.
 */
async function commitTmp(tmp: string, target: string): Promise<void> {
  try {
    await renameWithRetry(tmp, target)
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {})
    throw error
  }
  try {
    await fsyncDirectory(dirname(target))
  } catch (error) {
    // A1-15 (v18): the rename already landed, so the bytes ARE on disk and the
    // tmp is gone. Mark the failure so the write path can still audit/notify
    // and report "written, durability unconfirmed" instead of a plain failure
    // that a two-phase caller would try to roll back (deleting a visible write).
    throw Object.assign(
      new Error(`commitTmp: ${target} was renamed but the directory fsync failed: ${error instanceof Error ? error.message : String(error)}`),
      { committed: true, cause: error },
    )
  }
}

/**
 * True when the pid is alive (EPERM = alive but unowned; ESRCH = gone).
 * V18 single source: the node backend's lock takeover and SkillLibrary's
 * stranded-lock sweep must use the same liveness rule.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException | undefined)?.code === 'EPERM'
  }
}

/** How long an abandoned quarantine copy is kept for operator rescue. G2 S4: hoisted to module scope
 * (it used to live inside `nodeEvolutionIo`, in the region the lock protocol occupied). */
const CORRUPT_SWEEP_AGE_MS = 7 * 24 * 3_600_000

/** V27 G1.4: every quarantine-copy name this family has ever produced —
 * `<file>.corrupt` (current fixed name), `<file>.corrupt.<epoch>`, and the
 * v10-05 legacy `<file>.corrupt-<epoch>-<rand>` series. A user support file
 * keeps a final extension (`.corrupt-backup.md`) and therefore stays. */
const CORRUPT_COPY_RE = /\.corrupt(\.\d+|-\d+-[0-9a-z]+)?$/

/**
 * V27 G1.3: the error `commitTmp` throws when the rename landed but the parent
 * directory fsync failed — the bytes ARE visible, only their durability is
 * unconfirmed. A consumer that treats it as a plain failure reports "not
 * written" for a write that happened (and a two-phase caller may try to roll
 * back a visible write). Every transaction consumer must therefore treat this
 * shape as SUCCESS-with-warning, never as a rejection.
 */
export function isCommittedWarning(error: unknown): boolean {
  return (error as { committed?: unknown } | undefined)?.committed === true
}

/**
 * Build the Node IO backend: plain fs promises, durable tmp + rename commits (crash atomicity) and
 * ONE concurrency guarantee of its own — writes to the same path are serialized in-process (see
 * `inProcessWrite`). G2 S4 removed the cross-process write lock and its takeover protocol; the
 * plugin path gets cross-process safety from the platform provider (`ctx.fs`).
 */
export function nodeEvolutionIo(): EvolutionIoLike {
  /**
   * v43 S1-4: delegates to the canonical `isMissingPath` (probe.ts) — one
   * definition for the whole family instead of a second copy of the same two
   * codes. EISDIR deliberately stays OUT of that predicate: a directory
   * squatting on a file path is not "absent" — rotation and event reads must
   * still see it as malformed (rc.72 G-2), while the SkillLibrary.read boundary
   * absorbs EISDIR into "absent" for its own surface (E-43).
   * @param error - the caught read failure.
   * @returns true only for ENOENT/ENOTDIR.
   */
  const isMissing = (error: unknown): boolean => isMissingPath(error)
  /** True when the pid is alive (single source: `isProcessAlive`). */
  const isAlive = isProcessAlive

  /**
   * G2 S4: the family write-lock protocol is retired. Concurrency is the PLATFORM’s job now — the
   * plugin path requires `ctx.fs`, whose writes are versioned — so this backend keeps exactly one
   * guarantee of its own: writes to the SAME path inside THIS process are serialized (a promise
   * chain per path: no timers, no lock files, no takeover windows). Cross-process RMW safety comes
   * from the provider; a standalone caller sharing a directory across processes must not rely on
   * this backend alone. The durable tmp + rename commit stays — crash atomicity and mutual
   * exclusion are different concerns.
   */
  const queues = new Map<string, Promise<unknown>>()
  const inProcessWrite = async <T>(path: string, run: () => Promise<T>): Promise<T> => {
    const previous = queues.get(path) ?? Promise.resolve()
    const result = previous.then(run, run)
    const settled = result.then(() => {}, () => {})
    queues.set(path, settled)
    try {
      return await result
    } finally {
      if (queues.get(path) === settled) queues.delete(path)
    }
  }

  /**
   * Sweep transient files a crashed writer left behind, lazily: once per write, for the directory
   * that write is about to touch.
   * `<target>.<pid>.<rand>.tmp` — the durable-write tmp. This process's own leftover is recycled
   * immediately (a live writer's tmp is a current write, not a crash artifact); a foreign tmp
   * needs an age past an hour AND a dead holder.
   * `.corrupt*` — quarantine copies past their rescue window.
   * G2 S4: the lock and takeover-ticket branches are gone with the write-lock protocol.
   */
  const sweepStaleTmps = async (path: string): Promise<void> => {
    const dir = dirname(path)
    const base = basename(path)
    let entries: string[]
    try { entries = await readdir(dir) } catch { return }
    for (const name of entries) {
      // A1-9 (v18): only a tmp whose EXACT prefix is our base belongs to this target; the old
      // `startsWith(prefix) && endsWith('.tmp')` shape also matched a SIBLING target's tmp.
      const tmpMatch = /^(.*)\.(\d+)\.([0-9a-f]+)\.tmp$/.exec(name)
      if (tmpMatch !== null && tmpMatch[1] === base) {
        const tmpPath = join(dir, name)
        const holder = Number(tmpMatch[2])
        try {
          const st = await stat(tmpPath)
          const deadHolder = !Number.isInteger(holder) || holder <= 0 || !isAlive(holder)
          const selfLeftover = holder === process.pid
          if (selfLeftover || (Date.now() - st.mtimeMs > 3_600_000 && deadHolder)) {
            await rm(tmpPath, { force: true })
          }
        } catch {
          // The tmp vanished (or a race with its reaper); nothing to clean.
        }
        continue
      }
      // S-10: a quarantine copy past the rescue window is removed (best-effort: a vanished file
      // needs no cleanup). A1-1 (v18): the namespace layer reserves `.corrupt`/`.tmp` suffixes.
      // Only names belonging to THIS target's series (the same `base.` prefix filter the tmps get):
      // without it a sibling's quarantine copy was fair game.
      if (name.startsWith(base + '.') && CORRUPT_COPY_RE.test(name)) {
        const corruptPath = join(dir, name)
        try {
          const st = await stat(corruptPath)
          if (Date.now() - st.mtimeMs > CORRUPT_SWEEP_AGE_MS) await rm(corruptPath, { force: true })
        } catch {
          // The copy vanished (or raced its reaper); nothing to clean.
        }
      }
    }
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
      // S4: serialized in-process; the durable tmp + rename commit is unchanged.
      await inProcessWrite(path, async () => {
        await sweepStaleTmps(path)
        const tmp = await writeDurableTmp(path, content)
        await commitTmp(tmp, path)
      })
    },
    async transact(path, task) {
      await mkdir(dirname(path), { recursive: true })
      await inProcessWrite(path, async () => {
        await sweepStaleTmps(path)
        let current: string | null
        try {
          current = await readFile(path, 'utf8')
        } catch (error) {
          // Only "missing" maps to null; a real read failure surfaces so an unreadable store is
          // never treated as empty and overwritten.
          if (isMissing(error)) current = null
          else throw error
        }
        const next = await task(current)
        if (next === null) {
          await rm(path, { force: true })
          return
        }
        // A byte-identical result is a no-op: no tmp/rename churn and no misleading "written".
        if (next === current) return
        const tmp = await writeDurableTmp(path, next)
        await commitTmp(tmp, path)
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
      // P2-6 (v11): the seam's rename routes through the SAME transient
      // EPERM/EBUSY retry as the writeText/transact commit path (C-28) —
      // legacy retirement and archive/restore moves were bare-rename and
      // could fail on antivirus/indexer hold while the commit path retried.
      await renameWithRetry(path, destination)
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
      try { return (await lstat(path)).isSymbolicLink() } catch (error) {
        // G7 guard (P3-8, v14): `null` means "probe not applicable", which for
        // this guard is exactly a MISSING path. A real lstat failure
        // (EACCES/EIO/…) must not read as "not a symlink" — the caller would
        // then move a link it was supposed to refuse. Same discipline as the
        // sibling probes (`size`/`mtime`/`exists`).
        if (isMissing(error)) return null
        throw error
      }
    },
    async mtime(path) {
      try { return (await stat(path)).mtimeMs } catch (error) {
        if (isMissing(error)) return null
        throw error
      }
    },
  }
}

// G7-3: the family ONE atomic writer, moved here from evolution-commands so the write path lives
// beside the seam it belongs to. F-211 / V4-17 / V5-17 / V6-28 / V6-42 semantics verbatim.

/** F-211: the fs surface atomicWriteFiles uses — injectable so the commit-phase
 * rename-failure path is deterministically testable. Defaults to node:fs.
 * `mtime` (optional) probes a path's last-write time so the failed-commit
 * recovery message can name the generation it restored from. */
interface FsOps {
  writeFileSync(path: string, data: string | Uint8Array): void
  existsSync(path: string): boolean
  copyFileSync(from: string, to: string): void
  renameSync(from: string, to: string): void
  rmSync(path: string, options?: { force?: boolean; recursive?: boolean }): void
  mtime?(path: string): number | null
}

const defaultFs: FsOps = {
  writeFileSync: (path, data) => { writeFileSync(path, data) },
  existsSync: path => existsSync(path),
  copyFileSync: (from, to) => { copyFileSync(from, to) },
  renameSync: (from, to) => { renameSync(from, to) },
  rmSync: (path, options) => { rmSync(path, options) },
  // N14: only a MISSING file is "no mtime" (null). Any other stat failure
  // rejects, so probeMtime() reports it as unknown instead of as absent.
  mtime: (path) => {
    try { return statSync(path).mtimeMs } catch (error) {
      // v43 S1-4: the canonical predicate (core/probe.ts) — one definition of
      // "this read failure means it is not there" instead of a second copy.
      if (isMissingPath(error)) return null
      throw error
    }
  },
}

/**
 * S6.3 (E-40): atomically replace a set of files within one directory.
 * Each file is staged to a sibling `<name>.tmp`, then renamed into place
 * (atomic on the same filesystem); a pre-existing file keeps a single
 * `<name>.bak`. A failure at ANY staging step removes the staged temps and
 * leaves the previous files untouched — a half-written target is impossible
 * up to the staging and backup phases.
 *
 * F-211: the rename COMMIT phase does not carry the same guarantee. When a
 * filesystem refuses to overwrite the destination, the code removes it and
 * retries the rename; if the retry ALSO fails the destination is gone. The
 * single `.bak` created above still holds the previous content, so the target
 * is restored from it (best-effort) before the original rename error is
 * rethrown, so a failed commit never leaves the file missing.
 *
 * V4-17: the `.bak` is refreshed to the committed content after every
 * successful commit, so a later failed commit always recovers to the most
 * recent good generation (a once-at-first-install `.bak` could otherwise
 * restore content several installs old). The recovery error names the `.bak`
 * source (and mtime when available) so the caller knows the generation it
 * restored from.
 */
export function atomicWriteFiles(
  targetDir: string,
  writes: Array<{ name: string; content: string | Uint8Array }>,
  fs: FsOps = defaultFs,
  // F3 (P2-19, v11): warnings go through the caller's logger (the runtime
  // pipeline), not a raw console.warn — the .bak-refresh failure is a
  // real production event and must be observable in the operator logs.
  logger: (message: string) => void = console.warn,
): void {
  const stage = (name: string): string => join(targetDir, `${name}.tmp`)
  // V6-42 (0.3.36): a duplicate name makes the commit re-visit the same
  // target: the second rename ENOENTs (the tmp already moved), then the
  // remove-then-rename recovery DELETES the file the first commit just
  // installed and restores an old `.bak` generation — a self-referential,
  // confusing failure. Fail loud on the input instead.
  const dupes = [...new Set(writes.map(write => write.name).filter((name, index, all) => all.indexOf(name) !== index))]
  if (dupes.length > 0) {
    throw new Error(`atomicWriteFiles: duplicate input names: ${dupes.join(', ')}`)
  }
  try {
    for (const { name, content } of writes) fs.writeFileSync(stage(name), content)
    for (const { name } of writes) {
      const finalPath = join(targetDir, name)
      const bakPath = join(targetDir, `${name}.bak`)
      // Back up the currently installed file once, so an interrupted commit can
      // fall back to the previous usable composition.
      if (fs.existsSync(finalPath) && !fs.existsSync(bakPath)) fs.copyFileSync(finalPath, bakPath)
    }
    const committed: string[] = []
    for (const { name } of writes) {
      const finalPath = join(targetDir, name)
      const bakPath = join(targetDir, `${name}.bak`)
      const tmp = stage(name)
      try {
        fs.renameSync(tmp, finalPath)
        committed.push(name)
      } catch {
        // Some filesystems refuse to overwrite the destination; the single
        // .bak above already holds the previous file, so remove-then-rename is
        // safe here.
        try {
          fs.rmSync(finalPath, { force: true })
        } catch (removeError) {
          // V6-28 (0.3.36): a failed remove must not escape WITHOUT the
          // disclosure chain — `committed` is the only trace of a partial
          // install and the recovery narration would be lost (Windows: rename
          // and unlink often fail together with EPERM/EBUSY).
          const already = committed.length > 0 ? `; already committed: ${committed.join(', ')}` : ''
          throw new Error(`atomicWriteFiles: could not remove "${name}" to replace it (${removeError instanceof Error ? removeError.message : String(removeError)})${already}`)
        }
        try {
          fs.renameSync(tmp, finalPath)
          committed.push(name)
        } catch (renameError) {
          // F-211: the retry failed AFTER the target was removed — restore it
          // from .bak before surfacing the error, so the file is not left
          // missing. Best-effort: if the restore also fails, note that and
          // throw the original rename error so the caller still knows why.
          // V5-17 (0.3.31): a multi-file commit that fails midway is PARTIAL —
          // the error must disclose which files already landed (the caller is
          // otherwise told only about the file that failed).
          const already = committed.length > 0 ? `; already committed: ${committed.join(', ')}` : ''
          if (fs.existsSync(bakPath)) {
            try {
              fs.copyFileSync(bakPath, finalPath)
            } catch {
              throw new Error(`atomicWriteFiles: "${name}" was removed but recovery from ${bakPath} failed (${renameError instanceof Error ? renameError.message : String(renameError)}); verify the file manually${already}`)
            }
            // V4-17: recovery succeeded — name the source generation so a caller
            // is not misled into thinking the attempt actually landed.
            const bakMtime = fs.mtime?.(bakPath)
            const when = bakMtime !== null && bakMtime !== undefined && Number.isFinite(bakMtime) ? ` (bak mtime ${new Date(bakMtime).toISOString()})` : ''
            throw new Error(`atomicWriteFiles: "${name}" was removed during commit and restored from the last good generation ${bakPath}${when}; original error: ${renameError instanceof Error ? renameError.message : String(renameError)}${already}`)
          }
          throw new Error(`${renameError instanceof Error ? renameError.message : String(renameError)}${already}`)
        }
      }
    }
    // V4-17: a successful commit refreshes each .bak to the content that just
    // landed, so a later failed commit recovers to the most recent good
    // generation rather than one several installs ago (the backup phase above
    // only ever created a .bak on first install).
    // V5-17 (0.3.31): the refresh is best-effort maintenance — a failure here
    // must NOT turn a successful install into a reported failure, and must not
    // abort mid-loop (which would split the bak pair: some fresh, some old).
    for (const { name } of writes) {
      const finalPath = join(targetDir, name)
      try {
        if (fs.existsSync(finalPath)) fs.copyFileSync(finalPath, join(targetDir, `${name}.bak`))
      } catch (refreshError) {
        logger(`atomicWriteFiles: committed "${name}" but failed to refresh its .bak (${refreshError instanceof Error ? refreshError.message : String(refreshError)}); a later failed commit will recover to an OLDER generation`)
      }
    }
  } catch (error) {
    // OPT-24 (2026-09): the cleanup loop runs INSIDE the catch — an rmSync
    // that hits EPERM/EBUSY (Windows: AV indexer, open handle; force only
    // suppresses ENOENT) escaped the catch and REPLACED the carefully built
    // recovery diagnostic (including the already-committed disclosure), and
    // left the remaining staged temps behind. Cleanup failures are now
    // collected and appended to the original error; every temp gets its
    // removal attempt.
    const cleanupFailures: string[] = []
    for (const { name } of writes) {
      try {
        fs.rmSync(stage(name), { force: true, recursive: true })
      } catch (cleanupError) {
        cleanupFailures.push(`${name}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`)
      }
    }
    if (cleanupFailures.length > 0) {
      const original = error instanceof Error ? error.message : String(error)
      throw new Error(`${original} (staged-temp cleanup also failed: ${cleanupFailures.join('; ')})`)
    }
    throw error
  }
}
