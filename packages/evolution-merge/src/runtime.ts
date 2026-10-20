/**
 * The merge command runtime: cards -> screening -> channel ports -> scan/approve.
 * Plugin wiring supplies the channel, model and library; this module keeps the orchestration
 * out of apply() and makes the mutating verbs testable with fakes.
 */
import type { EvolutionIoLike, SkillLibrary } from '@deepseek-ai/dsh-evolution-core'
import type { MergeCandidate } from './contracts.ts'
import type { MergeParams } from './params.ts'
import type { SkillCard } from './screening.ts'
import type { MergeRegistryPort } from './run-shell.ts'
import type { MergeCommandService } from './merge-command.ts'
import { createReadOnlyMergeService } from './merge-command.ts'
import { handleReadOnlyMergeCommand } from './read-commands.ts'
import { runScanCommand } from './scan-command.ts'
import { runApproveCommand } from './approve-command.ts'
import { createChannelScanPorts } from './scan-ports.ts'
import { createNewChildRound2 } from './new-child-authoring.ts'
import { skillLibraryPort } from './adapters/library.ts'
import type { ConversationChannelLike } from './channel-port.ts'

export interface MergeRuntimeDeps {
  readonly io: EvolutionIoLike
  readonly home: string
  readonly registry: MergeRegistryPort
  readonly skills: SkillLibrary
  readonly now: () => number
  readonly params: MergeParams
  readonly platformWrite: boolean
  readonly channel: ConversationChannelLike
  readonly parent: unknown
  readonly allow: readonly string[]
  readonly cwd?: string
  readonly timeoutMinutes: number
  readonly cards: (signal: AbortSignal) => Promise<readonly SkillCard[]>
  readonly screening: (cards: readonly SkillCard[], signal: AbortSignal) => Promise<readonly MergeCandidate[]>
}

export function createMergeRuntime(deps: MergeRuntimeDeps): MergeCommandService {
  const readOnly = createReadOnlyMergeService(deps.io, deps.home)
  const timeout = deps.timeoutMinutes > 0 ? deps.timeoutMinutes : undefined
  const common = {
    io: deps.io, home: deps.home, registry: deps.registry,
    platformWrite: deps.platformWrite, now: deps.now,
    ...(timeout === undefined ? {} : { timeoutMinutes: timeout }),
  }
  return {
    async execute(command) {
      if (command.verb === 'scan') {
        const signal = new AbortController().signal
        const cards = await deps.cards(signal)
        const result = await runScanCommand({
          ...common,
          approval: deps.params.mergeApproval,
          makePorts: runId => createChannelScanPorts({
            io: deps.io, home: deps.home, runId, cards,
            screening: turnSignal => deps.screening(cards, turnSignal),
            channel: deps.channel, parent: deps.parent, allow: deps.allow,
            ...(deps.cwd === undefined ? {} : { cwd: deps.cwd }),
            timeoutMs: deps.params.mergePairTimeoutMinutes * 60_000,
            approval: deps.params.mergeApproval,
            commitPort: skillLibraryPort(deps.skills), now: deps.now,
          }),
        })
        return result.ok
          ? { ok: true, text: 'merge scan 完成：merged ' + String(result.report.totals.merged) + ' / pending ' + String(result.report.totals.pending) + ' / failed ' + String(result.report.totals.failed) }
          : { ok: false, text: result.message }
      }
      if (command.verb === 'approve') {
        const signal = new AbortController().signal
        const cards = await deps.cards(signal)
        const result = await runApproveCommand({
          ...common,
          rowId: command.id,
          ports: {
            round2: createNewChildRound2({
              io: deps.io, home: deps.home, cards, channel: deps.channel, parent: deps.parent,
              allow: deps.allow, ...(deps.cwd === undefined ? {} : { cwd: deps.cwd }),
              timeoutMs: deps.params.mergePairTimeoutMinutes * 60_000,
              commitPort: skillLibraryPort(deps.skills), now: deps.now,
            }),
          },
        })
        return result.ok
          ? { ok: true, text: 'merge approve 完成：merged ' + String(result.report.totals.merged) }
          : { ok: false, text: result.message }
      }
      const text = await handleReadOnlyMergeCommand(command, deps.io, deps.home)
      if (text !== null) return { ok: true, text }
      return readOnly.execute(command)
    },
  }
}
