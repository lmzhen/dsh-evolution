/**
 * Structural IO seam for the evolution plugin family.
 *
 * Every evolution package passes `ctx.evolutionIo.provider()`; standalone
 * consumers (and the core's own tests) can use `nodeEvolutionIo`.
 */

import { type FileHandle, cp, lstat, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
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
   * invalidation only. V9-07 (0.3.51): as of this release NO in-tree consumer
   * calls it — skill-catalog invalidation is event-driven
   * (`evolution/skill-mutated` / `evolution/skills-refresh`). The probe stays
   * as a backend contract extension point; document it here before wiring a
   * consumer.
   */
  mtime?(this: void, path: string): Promise<number | null>
}

/**
 * Run `task` inside `io.transact` when the backend provides it; otherwise fall
 * back to a plain read → task → write/remove sequence (no cross-process lock —
 * callers keep their single-process serialize chain as the second layer).
 */
export async function transactIo(
  io: EvolutionIoLike,
  path: string,
  task: (current: string | null) => string | null | Promise<string | null>,
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
    // Never throws: a backend without the probe reports null (cache keeps its
    // event-driven invalidation only — 0.3.18, E-71).
    mtime: (path) => {
      const io = provider()
      return io.mtime ? io.mtime(path) : Promise.resolve(null)
    },
  }
}

/**
 * F-367 (②): lock paths whose release (the finally `rm`) failed. The next write
 * to the same file proactively recycles our own leftover lock — the holder is
 * us, so a leftover is stale by definition. Module-level by design: it must
 * survive across `nodeEvolutionIo()` instances for the self-heal to be
 * effective. (Not a pure function — the cross-call state is the intent.)
 * V4-05: this set — not an mtime heuristic — is the ONLY signal that a
 * same-pid lock is a leftover rather than a live in-process task, so it is the
 * sole gate for the self-pid recycle branch. Exported (read-only in practice)
 * so `io.spec.ts` can drive the self-heal path deterministically.
 */
export const pendingSelfCleanup = new Map<string, string>()

/**
 * Retry a rename that a peer is temporarily holding on Windows (EPERM/EBUSY):
 * a short 50ms backoff, at most 3 retries (~150ms budget), matching the
 * write-lock cadence. A non-transient code surfaces immediately. `fn` is the
 * rename primitive, injectable for deterministic tests.
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
      if (retry >= 3) throw error
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }
}

/**
 * F-366: commit a freshly-written tmp to its target inside the write lock. On a
 * still-failing rename the tmp is deleted immediately rather than left for the
 * (1h + dead-pid) sweep, so a live writer never leaks a tmp it abandoned.
 */
async function commitTmp(tmp: string, target: string): Promise<void> {
  try {
    await renameWithRetry(tmp, target)
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {})
    throw error
  }
}

export function nodeEvolutionIo(): EvolutionIoLike {
  const isMissing = (error: unknown): boolean => {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    // EISDIR deliberately stays OUT: a directory squatting on a file path is
    // not "absent" — rotation and event reads must still see it as malformed
    // (rc.72 G-2), while the SkillLibrary.read boundary absorbs EISDIR into
    // "absent" for its own surface (E-43).
    return code === 'ENOENT' || code === 'ENOTDIR'
  }
  /** True when the pid is alive (EPERM = alive but unowned; ESRCH = gone). */
  const isAlive = (pid: number): boolean => {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      return (error as NodeJS.ErrnoException | undefined)?.code === 'EPERM'
    }
  }

  /**
   * Cross-process write lock (claw `withFileLock` parity): an O_EXCL lock file
   * guards the atomic write. A >1s-old lock is taken over ONLY after probing
   * the holder pid it carries (rc.66): a LIVE holder is never stolen, so a
   * slow writer no longer loses its lock to a peer at the threshold (the
   * takeover is the only best-effort surface; the retry budget fails loud —
   * rc.65 — instead of ever proceeding unlocked). Budget = 40 * 50ms (~2s,
   * rc.69): 8-writer contention bursts on a loaded CI runner exceed 10
   * attempts (500ms), and a fail-loud throw was observed instead of a clean
   * serialization.
   * 0.3.17 (E-8): acquisition and the task are now SEPARATE try blocks — a
   * task error (win32 rename/EBUSY surfaces as EPERM) used to be mistaken for
   * lock contention, retried up to 40x and finally reported as
   * "could not acquire write lock" while the real cause was hidden.
   * 0.3.17 (E-8a): the takeover threshold (1000ms) now fits INSIDE the ~2s
   * retry budget (budget >= 2 x threshold), so a dead holder's lock is
   * actually recoverable within one budget instead of being arithmetically
   * unreachable.
   * 0.3.21 (F-101), V4-04: takeover re-reads the lock right before acting and
   * only proceeds when the content still names the dead pid — a peer that
   * acquired the lock after our stale probe wrote its own pid, and deleting a
   * LIVE lock is the double-hold (concurrent task) the probe must prevent. The
   * re-read is necessary but not sufficient: two peers can both pass it, so the
   * commit itself is an atomic rename to a unique name (only one peer's rename
   * can succeed; the loser's source is gone). A naive rm lets the later peer
   * delete the winner's freshly re-acquired live lock.
   * 0.3.21 (F-367), V4-05: a self-pid lock is recycled ONLY when the failed
   * release was recorded in pendingSelfCleanup — never on age alone, because an
   * mtime over 1s is indistinguishable from a long task still executing in this
   * process, and recycling that live lock would double-hold it. A failure to
   * release in finally is recorded so the next write self-heals.
   */
  const withWriteLock = async <T>(path: string, task: () => Promise<T>): Promise<T> => {
    const lock = `${path}.lock`
    let myClaim = ''
    for (let attempt = 0; attempt < 40; attempt += 1) {
      // Phase 1 — acquire. ONLY acquisition errors are retryable contention.
      // 0.3.28 (V4-04 32-way repro): the lock body carries `pid:token` so a
      // takeover probe can tell a stale claim from a freshly created one, and
      // release verifies identity before deleting. NB: creation MUST stay an
      // exclusive `open('wx')` — an atomic tmp+rename would be a
      // REPLACE-on-Windows semantic (MOVEFILE_REPLACE_EXISTING), which
      // let every contender overwrite the winner's lock (9/9 double-held in
      // the 10-way repro — far worse than the gap it was meant to close).
      let lockHandle: FileHandle | null = null
      try {
        myClaim = `${process.pid}:${randomBytes(4).toString('hex')}`
        // V6-04 (0.3.35): the exclusive create is opened explicitly so a failure
        // AFTER the create (write/close) still knows the on-disk file is OURS
        // (`lockHandle` set). An unhandled 0-byte lock would block every future
        // writer forever — its body fails the pid probe, so no takeover could
        // ever clear it.
        lockHandle = await open(lock, 'wx')
        await lockHandle.writeFile(myClaim)
        await lockHandle.close()
        lockHandle = null
      } catch (error) {
        const code = (error as NodeJS.ErrnoException | undefined)?.code
        // V6-04: our create opened the file, so the failure is post-create —
        // remove OUR artifact before throwing (a leftover 0-byte/partial lock
        // outlives this writer as a permanent deadlock). A wrong rm is
        // impossible here: `open('wx')` is the exclusive create, and while the
        // file exists no other process can have created that name.
        if (lockHandle) {
          await lockHandle.close().catch(() => {})
          await rm(lock, { force: true }).catch(() => {})
          throw error
        }
        // Windows surfaces the concurrent-create race as EPERM ("open ... .lock")
        // when a peer's holder-lock delete races our create; treat it as the
        // same retryable contention as EEXIST (rc.67).
        if (code !== 'EEXIST' && code !== 'EPERM') throw error
        try {
          const st = await stat(lock)
          const holderContent = await readFile(lock, 'utf8').catch(() => '')
          const holder = Number(holderContent.split(':')[0] ?? '')
          const holderAlive = Number.isInteger(holder) && holder > 0 && isAlive(holder)
          // F-367 (①), V4-05: a self-pid lock is recycled ONLY when the failed
          // release was recorded in pendingSelfCleanup (a task that ended but
          // could not rm in finally). A same-process lock is NEVER recycled on
          // age alone: an mtime older than 1s is indistinguishable from a LONG
          // task still executing in this very process, so the old mtime branch
          // let a concurrent same-process writer steal a live lock (double-hold
          // → double execution). An executing lock (of any age) is never
          // stolen; a leftover-but-unrecorded same-pid lock is deliberately
          // never recycled either (safe-conservative: the dead owner's
          // cross-process takeover covers the common crash case; a leftover
          // naming a REUSED live pid fails loud after the retry budget
          // instead of ever double-holding; this process's own failed
          // release is always recorded via pendingSelfCleanup).
          if (holder === process.pid && pendingSelfCleanup.has(lock)) {
            // V8-05 (0.3.46): the registration carries the body TOKEN from the
            // failed release — only a matching current body is our leftover; a
            // mismatched body is a NEW lock another same-process writer owns.
            const token = pendingSelfCleanup.get(lock)
            const current = await readFile(lock, 'utf8').catch(() => '')
            if (current === token) {
              try {
                await rm(lock, { force: true })
                // Only a successful removal retires the registration; a failed
                // rm keeps it so the next write still self-heals (the old form
                // deleted unconditionally and orphaned the record — the
                // process then never re-tried and failed loud until restart).
                pendingSelfCleanup.delete(lock)
              } catch { /* raced with the holder — keep the registration */ }
            }
            continue
          }
          // V4-04 / F-101: only a stale (>1s) lock NOT held by a live peer is
          // taken over — with a TICKET. The probe's re-read and the removal are
          // not atomic, and a naive rename/rm let N peers claim each other's
          // mid-creation locks (cascade double-hold: 32-way repro lost 94% of
          // RMWs, 8-way 25% — a peer that inserted a fresh claim between the
          // probe and the rename got its live lock moved aside, and the former
          // owner + insertor double-held). The ticket makes the dangerous step
          // (removing the dead lock) single-owner: `lock.next` is an O_EXCL
          // creation — exactly one contender holds it; contenders without it
          // loop. The ticket holder re-verifies the dead body, removes it, then
          // drops the ticket and RE-ENTERS the fair O_EXCL acquisition loop —
          // every claim is then won by exactly one peer (whoever wins the
          // create), so mutual exclusion can never be broken. NB the ticket
          // file itself is ownership-free: a stale ticket (dead holder, or the
          // holder crashed) is removed by any prober (its removal is harmless —
          // the ticket grants no lock).
          // V6-04: a 0-byte lock (a creator that died between open and write)
          // carries no pid to probe — it is reclaimable only when also older
          // than the takeover threshold (a live creator writes its body right
          // after open, so a lingering empty lock is a crashed creator; the 1s
          // gate keeps an in-flight create safe). The re-read + ticket flow
          // below stays the single execution gate for BOTH shapes.
          const staleDead = Number.isInteger(holder) && holder > 0 && Date.now() - st.mtimeMs > 1000 && !holderAlive
          const staleEmpty = holderContent === '' && Date.now() - st.mtimeMs > 1000
          if (staleDead || staleEmpty) {
            const current = await readFile(lock, 'utf8').catch(() => '')
            if (current === holderContent) {
              const ticket = `${lock}.next`
              // First, reclaim a stale ticket (dead pid in its body, or simply
              // older than the takeover threshold). Best-effort and ownership-
              // free: a wrong removal only delays a takeover by one loop.
              try {
                const ticketBody = await readFile(ticket, 'utf8').catch(() => '')
                const ticketMtime = await stat(ticket).then(s => s.mtimeMs, () => 0)
                const ticketHolder = Number(ticketBody.split(':')[0] ?? '')
                const ticketStale = !Number.isInteger(ticketHolder) || ticketHolder <= 0
                  || !isAlive(ticketHolder) || Date.now() - ticketMtime > 1000
                // V6-04: an empty body carries no pid to probe — reclaim only an
                // OLD ticket (a live creator writes its body right after open;
                // >1s with no body = crashed between create and write). The
                // ticket grants no lock, so a wrong reclaim costs the former
                // owner one retry round — never a second holder.
                if (ticketStale && (ticketBody !== '' || Date.now() - ticketMtime > 1000)) {
                  await rm(ticket, { force: true }).catch(() => {})
                }
              } catch { /* ticket vanished — nothing to do */ }
              try {
                await writeFile(ticket, `${process.pid}:${randomBytes(4).toString('hex')}`, { flag: 'wx' })
              } catch {
                // Another contender owns the ticket (or a stale one was just
                // reclaimed by someone else's create) — re-attempt the loop.
                continue
              }
              // Ticket held: verify the dead body one more time, then remove
              // it. Only the ticket owner reaches this line, and no OTHER
              // contender can have re-created the lock name meanwhile (an
              // exclusive create cannot succeed while the lock name exists,
              // and same-pid self-heal never fires for a foreign dead pid) —
              // so the removed file IS the dead lock, not a live claim.
              const verify = await readFile(lock, 'utf8').catch(() => '')
              if (verify === holderContent) {
                await rm(lock, { force: true }).catch(() => {})
              }
              await rm(ticket, { force: true }).catch(() => {})
              continue
            }
          }
        } catch {
          continue // the lock vanished between fails
        }
        await new Promise(resolve => setTimeout(resolve, 50))
        continue
      }
      // Phase 2 — run the task under the held lock. Its own errors propagate
      // (the lock was released in finally); they are never lock contention.
      try {
        return await task()
      } finally {
        // F-367 (②): a failed release is no longer silently swallowed — record
        // the path so the NEXT write to the same file self-heals it.
        // 0.3.28 (V4-04 follow-up): release ONLY a claim that is still OUR
        // body — a takeover cascade may have moved our lock aside and another
        // peer re-created the name; deleting it would remove a live peer's lock
        // (cascade double-hold). A foreign body (or a vanished lock) is left
        // untouched — the owner/rebuilder owns it.
        const mine = await readFile(lock, 'utf8').catch(() => null)
        if (mine === myClaim) {
          // V8-05 (0.3.46): record the failed release WITH the lock-body token
          // — the later self-recycle compares the CURRENT body against this
          // snapshot, so a fresh lock another same-process writer created at
          // the same path (the stale-entry hazard) is never removed as if it
          // were our own leftover.
          await rm(lock, { force: true }).catch(async () => {
            const body = await readFile(lock, 'utf8').catch(() => '')
            pendingSelfCleanup.set(lock, body)
          })
        }
      }
    }
    throw new Error(`could not acquire write lock for ${path} after 40 attempts`)
  }

  /** 0.3.17 (E-8b): sweep tmp files a crashed writer left behind — same
   * `<target>.<pid>.<rand>.tmp` shape, older than 1h AND held by a dead pid.
   * Lazy: only the directory a write is about to touch gets swept, once per
   * write, inside the write lock. */
  const sweepStaleTmps = async (path: string): Promise<void> => {
    const dir = dirname(path)
    const base = basename(path)
    let entries: string[]
    try { entries = await readdir(dir) } catch { return }
    const prefix = `${base}.`
    // V6-18 (0.3.35): the ticket name is a known transient too. `base.lock` is
    // skipped — this sweep runs inside the held write lock, so that file IS
    // our live lock; `base.lock.next` is an ownership-free ticket a crashed
    // takeover leaves behind, reclaimed with the same dead-pid/old semantics
    // as the per-attempt reclaim.
    const lockName = `${base}.lock`
    const ticketName = `${lockName}.next`
    for (const name of entries) {
      if (!name.startsWith(prefix) || name === lockName) continue
      if (!name.endsWith('.tmp')) {
        if (name === ticketName) {
          const ticketPath = join(dir, name)
          try {
            const body = await readFile(ticketPath, 'utf8').catch(() => '')
            const holder = Number(body.split(':')[0] ?? '')
            const st = await stat(ticketPath)
            // Same semantics as the per-attempt reclaim: dead-pid or >1s-old
            // tickets are reclaimable (an empty body has no pid to probe, so
            // only its age proves a crashed creator — V6-04).
            const dead = !Number.isInteger(holder) || holder <= 0 || !isAlive(holder)
            const old = Date.now() - st.mtimeMs > 1000
            if (dead || old) await rm(ticketPath, { force: true })
          } catch {
            // The ticket vanished (or a race with its reaper); nothing to clean.
          }
        }
        continue
      }
      const tmpPath = join(dir, name)
      const holder = Number(name.slice(prefix.length, name.length - 4).split('.')[0] ?? '')
      try {
        const st = await stat(tmpPath)
        const deadHolder = !Number.isInteger(holder) || holder <= 0 || !isAlive(holder)
        // F-366 (③): this process's own leftover tmp is recycled immediately (a
        // live writer's tmp is a current write, not a crash artifact); foreign
        // live pids keep the >1h protection so an in-flight write is not reaped.
        const selfLeftover = holder === process.pid
        if (selfLeftover || (Date.now() - st.mtimeMs > 3_600_000 && deadHolder)) {
          await rm(tmpPath, { force: true })
        }
      } catch {
        // The tmp vanished (or a race with its reaper); nothing to clean.
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
      await withWriteLock(path, async () => {
        await sweepStaleTmps(path)
        const tmp = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
        await writeFile(tmp, content, 'utf8')
        await commitTmp(tmp, path)
      })
    },
    async transact(path, task) {
      await mkdir(dirname(path), { recursive: true })
      await withWriteLock(path, async () => {
        await sweepStaleTmps(path)
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
        // V5-03 (0.3.29): a byte-identical result is a no-op — do not rewrite
        // the file (tmp+rename churn, mtime touch, and the misleading "nothing
        // written" report on the caller side). noop update/patch, repeated
        // memory adds and the state-json dedupe short-circuit all funnel here.
        if (next === current) {
          return
        }
        const tmp = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
        await writeFile(tmp, next, 'utf8')
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
    async mtime(path) {
      try { return (await stat(path)).mtimeMs } catch (error) {
        if (isMissing(error)) return null
        throw error
      }
    },
  }
}
