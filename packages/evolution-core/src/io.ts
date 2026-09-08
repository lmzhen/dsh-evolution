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
 * callers keep their single-process serialize chain as the second layer). A
 * byte-identical task result skips the write (C-07 — parity with the
 * node backend's V5-03 short-circuit).
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
  // C-07: a byte-identical result is a no-op — the same V5-03
  // short-circuit the node backend's transact already has. Without it every
  // fallback RMW churned a tmp+rename and touched the mtime even when nothing
  // changed, so transact-less backends behaved asymmetrically.
  else if (next !== current) await io.writeText(path, next)
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
    const handle = await openImpl(tmp, 'wx')
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
    await fsyncDirectory(dirname(target))
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {})
    throw error
  }
}

/**
 * Build the Node IO backend. `lockAttempts` scales the write-lock retry budget
 * (attempts × 50ms); the default 40 (~2s, rc.69) covers production contention,
 * while contention TESTS on a loaded runner may raise it (e.g. 240 ≈ 12s) —
 * V10-06 integration: full-suite parallel load made 32-way takeover bursts
 * exceed the default budget and fail loud.
 */
export function nodeEvolutionIo(lockAttempts = 40): EvolutionIoLike {
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
   * V10-07 (P2-1): age threshold for taking over a lock whose body is TORN
   * (non-empty, but the pid prefix does not parse to a positive integer). 1h:
   * a legal hold (the ~2s lock/rename retry budgets, a slow task) never
   * approaches minutes, so 1h fires only in the "torn write + creator long
   * dead" scenario — far above any legitimate hold, far below "forever".
   */
  const LOCK_TEAR_TAKEOVER_MS = 3_600_000

  /**
   * V10-06 (P1-1 integration fix): a takeover TICKET must never be reclaimed
   * while its (live) holder can still be committing — the C-28 rename retry
   * budget is ~2.35s under AV/indexer pressure, so the former 1s ticket age
   * threshold let a contender steal an in-flight ticket, double-enter the
   * critical section and drop one RMW (observed as 5/6 increments under
   * full-suite load). 5s = retry budget + comfortable margin; a DEAD holder's
   * ticket is still reclaimed immediately via the pid probe.
   */
  const TICKET_STALE_MS = 5_000

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
   * V10-07 (P2-1): a third takeover shape — a TORN body (non-empty, no
   * parseable pid) — is taken over after a wide 1h threshold with a
   * console.warn; before this branch such a lock blocked every future writer
   * forever.
   */
  const withWriteLock = async <T>(path: string, task: () => Promise<T>): Promise<T> => {
    const lock = `${path}.lock`
    let myClaim = ''
    for (let attempt = 0; attempt < lockAttempts; attempt += 1) {
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
          // V10-07 (P2-1): a TORN body (non-empty, unparseable pid — a crash
          // mid-write) matched neither the dead-pid nor the empty-body branch,
          // so the lock blocked every future writer FOREVER (sweepStaleTmps
          // deliberately skips `.lock`); past LOCK_TEAR_TAKEOVER_MS it is
          // taken over too, with a console.warn marking the anomaly.
          const staleDead = Number.isInteger(holder) && holder > 0 && Date.now() - st.mtimeMs > 1000 && !holderAlive
          const staleEmpty = holderContent === '' && Date.now() - st.mtimeMs > 1000
          const staleCorrupt = holderContent !== ''
            && !(Number.isInteger(holder) && holder > 0)
            && Date.now() - st.mtimeMs > LOCK_TEAR_TAKEOVER_MS
          if (staleDead || staleEmpty || staleCorrupt) {
            if (staleCorrupt) {
              // Exactly one warn per actual takeover — an anomaly that should
              // not exist in a healthy deployment.
              console.warn(`evolution-io: took over a corrupt write lock "${lock}" (body ${JSON.stringify(holderContent)} has no parseable pid, lock older than 1h) — a previous writer likely crashed mid-write`)
            }
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
                  || !isAlive(ticketHolder) || Date.now() - ticketMtime > TICKET_STALE_MS
                // V6-04: an empty body carries no pid to probe — reclaim only an
                // OLD ticket (a live creator writes its body right after open;
                // beyond TICKET_STALE_MS with no body = crashed between create
                // and write). The ticket grants no lock, so a wrong reclaim
                // costs the former owner one retry round — never a second
                // holder. The age threshold must exceed the rename retry
                // budget (see TICKET_STALE_MS above).
                if (ticketStale && (ticketBody !== '' || Date.now() - ticketMtime > TICKET_STALE_MS)) {
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
                // C-27: the staleEmpty shape cannot name its creator
                // from an empty body, so re-parse the FRESH body right before
                // the removal — if a pid has appeared AND is alive, a creator
                // stalled >1s between open and write has materialized its
                // claim, and removing its lock would double-hold a live
                // writer. The byte-equality re-check above stays the primary
                // TOCTOU gate (a fully written body already fails it); this
                // explicit liveness probe is the belt that narrows the
                // event-loop-starvation window the v10 audit called out.
                const verifyHolder = Number(verify.split(':')[0] ?? '')
                const verifyAlive = Number.isInteger(verifyHolder) && verifyHolder > 0 && isAlive(verifyHolder)
                if (!verifyAlive) {
                  await rm(lock, { force: true }).catch(() => {})
                }
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
          // V10-06 (integration fix): the release rm RETRIES before falling
          // back to the pending-self-cleanup snapshot. A single-shot rm fails
          // under AV/indexer pressure (EPERM/EBUSY on a freshly-written file),
          // and every contender then waits on our (alive) pid until its whole
          // budget expires — observed as a lost RMW under full-suite load.
          await rm(lock, { force: true, maxRetries: 20, retryDelay: 100 }).catch(async () => {
            const body = await readFile(lock, 'utf8').catch(() => '')
            pendingSelfCleanup.set(lock, body)
          })
        }
      }
    }
    throw new Error(`could not acquire write lock for ${path} after ${lockAttempts} attempts`)
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
    // S-10: quarantine copies (the state-json provider's fixed
    // `<file>.corrupt`, and any legacy timestamped `.corrupt-*` series) older
    // than 7 days are sweepable — the operator rescue window is days, the
    // fixed-name copy is bounded at one per target, and without this rule an
    // abandoned corrupt copy lived forever.
    const CORRUPT_SWEEP_AGE_MS = 7 * 24 * 3_600_000
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
          continue
        }
        // S-10: a quarantine copy past the rescue window is removed
        // (best-effort: a vanished file needs no cleanup).
        if (name.includes('.corrupt')) {
          const corruptPath = join(dir, name)
          try {
            const st = await stat(corruptPath)
            if (Date.now() - st.mtimeMs > CORRUPT_SWEEP_AGE_MS) await rm(corruptPath, { force: true })
          } catch {
            // The copy vanished (or raced its reaper); nothing to clean.
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
        // V10-06 (P1-1): durable tmp (exclusive create + handle fsync) before
        // the rename — the upstream storage-json crash-durable protocol, not
        // a bare writeFile whose data blocks could trail the rename metadata
        // across a power loss.
        const tmp = await writeDurableTmp(path, content)
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
        // V10-06 (P1-1): same durable tmp protocol as writeText.
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
