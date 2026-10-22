/** Pre-commit snapshot: enough to restore the target and archived sources after a crash. */
import { join, resolve, sep } from 'node:path'
import type { CommitMergePlan, EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'

export interface CommitSnapshot {
  readonly runId: string
  readonly target: string
  readonly create: boolean
  readonly sources: readonly string[]
  readonly targetBody: string | null
  readonly sourceBodies: readonly { readonly name: string; readonly body: string }[]
  readonly targetSupport?: readonly { readonly path: string; readonly content: string }[]
  readonly targetSupportAfter?: readonly { readonly path: string; readonly content: string }[]
  readonly sourceSupport?: readonly { readonly name: string; readonly path: string; readonly content: string }[]
  readonly at: string
}

export function snapshotPath(home: string, runId: string): string {
  return join(home, 'merge', 'snapshots', runId.replace(/[^A-Za-z0-9_-]+/g, '_') + '.json')
}

export async function writeCommitSnapshot(
  io: EvolutionIoLike,
  home: string,
  runId: string,
  plan: CommitMergePlan,
  now: number,
  port?: { readSupportFiles?(name: string): Promise<readonly { readonly path: string; readonly content: string }[]> },
): Promise<CommitSnapshot> {
  if (!isSafeSkillName(plan.target) || plan.sources.some(name => !isSafeSkillName(name))) {
    throw new Error('unsafe skill name in commit plan: ' + plan.target)
  }
  const readSupport = port?.readSupportFiles === undefined
    ? undefined
    : (name: string) => port.readSupportFiles?.(name) ?? Promise.resolve([])
  const targetSupport = readSupport === undefined || !plan.targetExists ? [] : await readSupport(plan.target)
  const sourceSupport: { name: string; path: string; content: string }[] = []
  if (readSupport !== undefined) {
    for (const name of plan.sources) {
      for (const file of await readSupport(name)) sourceSupport.push({ name, path: file.path, content: file.content })
    }
  }
  const snapshot: CommitSnapshot = {
    runId, target: plan.target, create: !plan.targetExists, sources: plan.sources,
    targetBody: plan.expectedTargetBody,
    sourceBodies: plan.expectedSourceBodies.map(item => ({ name: item.name, body: item.body })),
    ...(targetSupport.length === 0 ? {} : { targetSupport }),
    ...(plan.supportFiles.length === 0 ? {} : { targetSupportAfter: plan.supportFiles }),
    ...(sourceSupport.length === 0 ? {} : { sourceSupport }),
    at: new Date(now).toISOString(),
  }
  await io.writeText(snapshotPath(home, runId), JSON.stringify(snapshot, null, 2))
  return snapshot
}

export async function readCommitSnapshot(io: EvolutionIoLike, home: string, runId: string): Promise<CommitSnapshot | null> {
  const raw = await io.readText(snapshotPath(home, runId))
  if (raw === null) return null
  try { return JSON.parse(raw) as CommitSnapshot } catch { return null }
}

export function isSafeSkillName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && name !== '.' && name !== '..'
}

export function skillFilePath(root: string, name: string, path: string): string {
  if (!isSafeSkillName(name) || path.startsWith('/') || path.split('/').includes('..')) throw new Error('unsafe skill file: ' + name + '/' + path)
  const base = resolve(root, name)
  const file = resolve(base, path)
  if (!file.startsWith(base + sep)) throw new Error('skill file escapes skill: ' + name + '/' + path)
  return file
}

export function skillBodyPath(root: string, name: string): string {
  if (!isSafeSkillName(name)) throw new Error('unsafe skill name: ' + name)
  const base = resolve(root)
  const path = resolve(base, name, 'SKILL.md')
  if (!path.startsWith(base + sep)) throw new Error('skill path escapes root: ' + name)
  return path
}
