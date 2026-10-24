/** Durable target claim: one approve writer per merge target at a time. */
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { contentHash, isProcessAlive, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { acquireClaim, releaseClaim, type Claim } from './domain/claim.ts'

const PROCESS_STARTED_AT = Date.now() - process.uptime() * 1000

function claimPath(home: string, target: string): string {
  return join(home, 'merge', 'claims', contentHash(target) + '.json')
}

function parseClaim(raw: string | null): Claim | undefined {
  if (raw === null) return undefined
  const parsed = JSON.parse(raw) as Partial<Claim>
  if (typeof parsed.token !== 'string' || typeof parsed.expiresAt !== 'number') throw new Error('corrupt target claim')
  return {
    id: 'claim', token: parsed.token, expiresAt: parsed.expiresAt,
    ...(typeof parsed.pid === 'number' ? { pid: parsed.pid } : {}),
    ...(typeof parsed.startedAt === 'number' ? { startedAt: parsed.startedAt } : {}),
  }
}

async function withGuard<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const guard = path + '.guard'
  await mkdir(dirname(path), { recursive: true })
  for (let attempt = 0; attempt < 500; attempt += 1) {
    try {
      const handle = await open(guard, 'wx')
      await handle.writeFile(String(process.pid))
      await handle.close()
      try { return await fn() } finally { await unlink(guard).catch(() => {}) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const pid = Number(await readFile(guard, 'utf8').catch(() => ''))
      if (Number.isFinite(pid) && pid > 0 && !isProcessAlive(pid)) await unlink(guard).catch(() => {})
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
  throw new Error('target-claim-guard-timeout')
}

async function compareAndSwap(io: EvolutionIoLike, path: string, task: (current: string | null) => string | null): Promise<void> {
  await withGuard(path, async () => {
    if (io.transact !== undefined) {
      await io.transact(path, current => task(current))
      return
    }
  const current = (await io.exists(path)) ? await io.readText(path) : null
  const next = task(current)
  if (next === null) {
    if (current !== null) try { await io.remove(path) } catch { /* already gone */ }
  } else if (next !== current) {
    await io.writeText(path, next)
  }
  })
}

export interface TargetClaim {
  readonly token: string
  release(): Promise<void>
}

export async function releaseTargetClaimQuietly(claim: TargetClaim | null | undefined): Promise<void> {
  if (claim === null || claim === undefined) return
  try { await claim.release() } catch { /* best effort; dead-holder reclaim or TTL handles it */ }
}

export async function acquireTargetClaim(io: EvolutionIoLike, home: string, target: string, now: number): Promise<TargetClaim | null> {
  const path = claimPath(home, target)
  const token = randomUUID()
  let granted: Claim | undefined
  await compareAndSwap(io, path, (raw) => {
    const current = parseClaim(raw)
    const reused = current !== undefined && current.pid === process.pid && current.startedAt !== undefined && Math.abs(current.startedAt - PROCESS_STARTED_AT) > 1_000
    const abandoned = reused || (current !== undefined && current.expiresAt > now
      && current.pid !== undefined && current.pid !== process.pid && !isProcessAlive(current.pid))
    const claim = acquireClaim(abandoned ? undefined : current, now, Number.MAX_SAFE_INTEGER, token, process.pid, PROCESS_STARTED_AT)
    if (claim === undefined) return raw
    granted = claim
    return JSON.stringify(claim) + '\n'
  })
  if (granted === undefined) return null
  return {
    token,
    async release() {
      await compareAndSwap(io, path, (raw) => {
        const next = releaseClaim(parseClaim(raw), token)
        return next === undefined ? null : JSON.stringify(next) + '\n'
      })
    },
  }
}
