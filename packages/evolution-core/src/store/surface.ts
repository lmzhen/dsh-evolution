/**
 * The DCR-85 section 9 surface registry: the one place a model tool, host
 * command or UI action gets a stable command id and declares the domains it
 * reads/writes. The registry is intentionally data-only; existing handlers are
 * wired to it incrementally (R7) so a new surface cannot appear without an id.
 *
 * Secrets are never represented here: settings/credentials stay on the platform
 * services and carry no store domain.
 *
 * @module @deepseek-ai/dsh-evolution-core/store/surface
 */

import type { StoreDomainId } from './types.ts'

export type StoreSurfaceKind = 'tool' | 'command' | 'ui' | 'provider'

export interface StoreSurfaceCommand {
  /** Stable id shared by the model tool, host command, and UI action. */
  readonly id: string
  readonly kind: StoreSurfaceKind
  /** Domains the surface may read. Empty for platform settings/credentials. */
  readonly reads: readonly StoreDomainId[]
  /** Domains the surface may write. Empty means read-only or platform-owned. */
  readonly writes: readonly StoreDomainId[]
  /** True when the surface must submit an expected commit for CAS. */
  readonly expectsCommit: boolean
}

export const STORE_SURFACE_COMMANDS: readonly StoreSurfaceCommand[] = [
  // State provider: the MVCC StateStore adapter writes/reads the state domain.
  { id: 'state.provider', kind: 'provider', reads: ['state'], writes: ['state'], expectsCommit: false },
  // 9.1 model tools
  { id: 'skill_manage', kind: 'tool', reads: ['state'], writes: ['state'], expectsCommit: true },
  { id: 'memory', kind: 'tool', reads: ['memoryFile', 'userFile'], writes: ['memoryFile', 'userFile'], expectsCommit: true },
  { id: 'skill_search', kind: 'tool', reads: ['discovery', 'domainMap'], writes: [], expectsCommit: false },
  { id: 'merge_stage', kind: 'tool', reads: ['merge', 'mergeMeta'], writes: [], expectsCommit: true },
  { id: 'maintenance_probe', kind: 'tool', reads: ['state', 'merge', 'runs'], writes: [], expectsCommit: false },
  { id: 'review_proposal', kind: 'tool', reads: ['state'], writes: [], expectsCommit: false },
  { id: 'usage_observation', kind: 'tool', reads: [], writes: [], expectsCommit: false },
  // 9.2 host commands
  { id: 'merge', kind: 'command', reads: ['merge', 'mergeMeta', 'runs', 'reports'], writes: ['merge', 'mergeMeta', 'runs', 'reports'], expectsCommit: true },
  // merge's subcommands are one host command with distinct command ids (§9.2).
  { id: 'merge.scan', kind: 'command', reads: ['merge', 'mergeMeta'], writes: ['merge', 'mergeMeta', 'runs'], expectsCommit: true },
  { id: 'merge.pair', kind: 'command', reads: ['merge', 'mergeMeta'], writes: ['merge', 'mergeMeta', 'runs'], expectsCommit: true },
  { id: 'merge.status', kind: 'command', reads: ['merge', 'mergeMeta', 'runs'], writes: [], expectsCommit: false },
  { id: 'merge.report', kind: 'command', reads: ['merge', 'runs', 'reports'], writes: [], expectsCommit: false },
  { id: 'merge.cancel', kind: 'command', reads: ['merge', 'runs'], writes: ['merge', 'runs'], expectsCommit: true },
  { id: 'merge.runs', kind: 'command', reads: ['runs'], writes: [], expectsCommit: false },
  { id: 'merge.doctor', kind: 'command', reads: ['merge', 'mergeMeta', 'runs', 'reports'], writes: [], expectsCommit: false },
  { id: 'merge.reconcile', kind: 'command', reads: ['merge', 'mergeMeta'], writes: ['merge', 'mergeMeta'], expectsCommit: true },
  { id: 'merge.pending', kind: 'command', reads: ['merge'], writes: [], expectsCommit: false },
  { id: 'merge.candidates', kind: 'command', reads: ['merge'], writes: [], expectsCommit: false },
  { id: 'merge.approve', kind: 'command', reads: ['merge'], writes: ['merge', 'mergeMeta'], expectsCommit: true },
  { id: 'merge.reject', kind: 'command', reads: ['merge'], writes: ['merge', 'mergeMeta'], expectsCommit: true },
  { id: 'merge.resume', kind: 'command', reads: ['merge', 'mergeMeta'], writes: ['merge', 'mergeMeta'], expectsCommit: true },
  { id: 'merge.skipped', kind: 'command', reads: ['merge'], writes: ['merge'], expectsCommit: true },
  { id: 'merge.discard', kind: 'command', reads: ['merge'], writes: ['merge'], expectsCommit: true },
  { id: 'merge.undo', kind: 'command', reads: ['merge', 'mergeMeta'], writes: ['merge', 'mergeMeta'], expectsCommit: true },
  { id: 'pending', kind: 'command', reads: ['state'], writes: [], expectsCommit: false },
  { id: 'approve', kind: 'command', reads: ['state'], writes: ['state'], expectsCommit: true },
  { id: 'reject', kind: 'command', reads: ['state'], writes: ['state'], expectsCommit: true },
  { id: 'release', kind: 'command', reads: ['state'], writes: ['state'], expectsCommit: true },
  { id: 'doctor', kind: 'command', reads: ['state', 'merge', 'runs', 'reports'], writes: [], expectsCommit: false },
  { id: 'curator', kind: 'command', reads: ['state'], writes: ['state'], expectsCommit: true },
  { id: 'migrate.state', kind: 'command', reads: ['state'], writes: ['state'], expectsCommit: false },
  { id: 'mutations', kind: 'command', reads: ['state'], writes: [], expectsCommit: false },
  { id: 'restore', kind: 'command', reads: ['state'], writes: ['state'], expectsCommit: true },
  { id: 'skill.restore', kind: 'command', reads: ['state'], writes: ['state'], expectsCommit: true },
  { id: 'skill.history', kind: 'command', reads: ['state'], writes: [], expectsCommit: false },
  { id: 'skill.undo', kind: 'command', reads: ['state'], writes: ['state'], expectsCommit: true },
  { id: 'skill.pin', kind: 'command', reads: ['state'], writes: ['state'], expectsCommit: true },
  { id: 'skill.unpin', kind: 'command', reads: ['state'], writes: ['state'], expectsCommit: true },
  { id: 'propose', kind: 'command', reads: ['state'], writes: ['state', 'reports'], expectsCommit: true },
  { id: 'skills.health', kind: 'command', reads: ['discovery'], writes: [], expectsCommit: false },
  { id: 'skills.refresh', kind: 'command', reads: ['discovery'], writes: ['domainMap'], expectsCommit: true },
  { id: 'learn', kind: 'command', reads: ['state'], writes: ['state', 'runs', 'reports'], expectsCommit: true },
  { id: 'review', kind: 'command', reads: ['state'], writes: ['state', 'runs', 'reports'], expectsCommit: true },
  { id: 'maintain', kind: 'command', reads: ['state'], writes: ['state', 'runs', 'reports'], expectsCommit: true },
  { id: 'maintain.status', kind: 'command', reads: ['runs', 'reports'], writes: [], expectsCommit: false },
  { id: 'maintain.report', kind: 'command', reads: ['runs', 'reports'], writes: [], expectsCommit: false },
  { id: 'maintain.handoff', kind: 'command', reads: ['runs'], writes: ['runs'], expectsCommit: true },
  { id: 'maintain.cancel', kind: 'command', reads: ['runs'], writes: ['runs'], expectsCommit: true },
  { id: 'params', kind: 'command', reads: ['state'], writes: [], expectsCommit: false },
  { id: 'offload', kind: 'command', reads: ['state'], writes: ['state'], expectsCommit: true },
  { id: 'condense', kind: 'command', reads: ['state'], writes: ['state'], expectsCommit: true },
  { id: 'replay', kind: 'command', reads: ['state', 'runs'], writes: [], expectsCommit: false },
  // 9.3 UI actions
  { id: 'settings.key.describe', kind: 'ui', reads: [], writes: [], expectsCommit: false },
  { id: 'settings.key.set', kind: 'ui', reads: [], writes: [], expectsCommit: false },
  { id: 'settings.key.unset', kind: 'ui', reads: [], writes: [], expectsCommit: false },
  { id: 'settings.params.save', kind: 'ui', reads: [], writes: [], expectsCommit: false },
  { id: 'pending.approve', kind: 'ui', reads: ['state'], writes: ['state'], expectsCommit: true },
  { id: 'pending.reject', kind: 'ui', reads: ['state'], writes: ['state'], expectsCommit: true },
  { id: 'pending.release', kind: 'ui', reads: ['state'], writes: ['state'], expectsCommit: true },
  { id: 'skill.history.undo', kind: 'ui', reads: ['state'], writes: ['state'], expectsCommit: true },
  { id: 'diagnostics.open', kind: 'ui', reads: ['state', 'merge', 'runs'], writes: [], expectsCommit: false },
  { id: 'skill.health.refresh', kind: 'ui', reads: ['discovery'], writes: ['domainMap'], expectsCommit: true },
] as const

const byId = new Map(STORE_SURFACE_COMMANDS.map(command => [command.id, command]))

/** Find one surface command by its stable id. */
export function storeSurfaceCommand(id: string): StoreSurfaceCommand | undefined {
  return byId.get(id)
}

/** Fail closed when a new surface has no command id; used by composition tests. */
export function requireStoreSurfaceCommand(id: string): StoreSurfaceCommand {
  const command = byId.get(id)
  if (command === undefined) throw new Error('unregistered store surface command: ' + id)
  return command
}
