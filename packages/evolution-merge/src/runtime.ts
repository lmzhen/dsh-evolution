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
import type { MergeCommandContext, MergeCommandService } from './merge-command.ts'
import { createReadOnlyMergeService } from './merge-command.ts'
import { handleReadOnlyMergeCommand } from './read-commands.ts'
import { runScanCommand } from './scan-command.ts'
import { runApproveCommand } from './approve-command.ts'
import { runResumeCommand } from './resume-command.ts'
import { loadMergeState } from './state.ts'
import { readCommitReceipt } from './commit-receipt.ts'
import { undoMergeReceipt } from './undo-merge.ts'
import { skillLibraryUndoPort } from './adapters/undo.ts'
import { createChannelScanPorts } from './scan-ports.ts'
import { createNewChildRound2 } from './new-child-authoring.ts'
import { skillLibraryPort } from './adapters/library.ts'
import type { ConversationChannelLike } from './channel-port.ts'
import type { StageToolContext } from './stage-tool.ts'

export interface MergeStageBindingPort {
  bind(context: StageToolContext): void
  unbind(childId: string): void
}

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
  readonly stage?: MergeStageBindingPort
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
    async execute(command, context?: MergeCommandContext) {
      const parent = context?.parent ?? deps.parent
      if (command.verb === 'scan') {
        const signal = new AbortController().signal
        const cards = await deps.cards(signal)
        const result = await runScanCommand({
          ...common,
          approval: deps.params.mergeApproval,
          makePorts: runId => createChannelScanPorts({
            io: deps.io, home: deps.home, runId, cards,
            screening: turnSignal => deps.screening(cards, turnSignal),
            channel: deps.channel, parent, allow: deps.allow,
            ...(deps.cwd === undefined ? {} : { cwd: deps.cwd }),
            timeoutMs: deps.params.mergePairTimeoutMinutes * 60_000,
            approval: deps.params.mergeApproval,
            commitPort: skillLibraryPort(deps.skills), now: deps.now,
            ...(deps.stage === undefined ? {} : { onChild: context => deps.stage!.bind(context), onChildClosed: childId => deps.stage!.unbind(childId) }),
          }),
        })
        return result.ok
          ? { ok: true, text: 'merge scan 完成：merged ' + String(result.report.totals.merged) + ' / pending ' + String(result.report.totals.pending) + ' / failed ' + String(result.report.totals.failed) }
          : { ok: false, text: result.message }
      }
      if (command.verb === 'undo') {
        const receipt = await readCommitReceipt(deps.io, deps.home, command.run)
        if (receipt === null) return { ok: false, text: 'merge run has no commit receipt: ' + command.run }
        const result = await undoMergeReceipt(receipt, skillLibraryUndoPort(deps.skills))
        return { ok: result.ok, text: result.message }
      }
      if (command.verb === 'resume') {
        const loaded = await loadMergeState(deps.io, deps.home)
        const row = command.id === undefined
          ? loaded.state.rows.find(item => item.state === 'fuse' || item.state === 'verify')
          : loaded.state.rows.find(item => item.id === command.id)
        if (row === undefined) return { ok: false, text: 'merge row not found: ' + (command.id ?? '(auto)') }
        const signal = new AbortController().signal
        const cards = await deps.cards(signal)
        const pair = async () => [{ a: row.a, b: row.b }]
        const basePorts = {
          screening: pair,
          round1: async () => ({ kind: 'failed' as const, failure: { stage: 'decide' as const, code: 'resume-needs-ports', message: 'verify resume needs makePorts', retryable: false, retryFrom: 'none' as const } }),
          round2: async () => ({ kind: 'failed' as const, failure: { stage: 'author' as const, code: 'resume-needs-child', message: 'fuse resume needs a new child', retryable: false, retryFrom: 'none' as const } }),
        }
        const result = await runResumeCommand({
          ...common, rowId: row.id, ports: basePorts,
          makePorts: runId => createChannelScanPorts({
            io: deps.io, home: deps.home, runId, cards, screening: pair,
            channel: deps.channel, parent, allow: deps.allow,
            ...(deps.cwd === undefined ? {} : { cwd: deps.cwd }),
            timeoutMs: deps.params.mergePairTimeoutMinutes * 60_000,
            approval: deps.params.mergeApproval, commitPort: skillLibraryPort(deps.skills), now: deps.now,
          }),
          round2WithRun: createNewChildRound2({
            io: deps.io, home: deps.home, cards, channel: deps.channel, parent,
            allow: deps.allow, ...(deps.cwd === undefined ? {} : { cwd: deps.cwd }),
            timeoutMs: deps.params.mergePairTimeoutMinutes * 60_000,
            commitPort: skillLibraryPort(deps.skills), now: deps.now,
            ...(deps.stage === undefined ? {} : { onChild: context => deps.stage!.bind(context), onChildClosed: childId => deps.stage!.unbind(childId) }),
          }),
        })
        return result.ok
          ? { ok: true, text: 'merge resume 完成：merged ' + String(result.report.totals.merged) }
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
              io: deps.io, home: deps.home, cards, channel: deps.channel, parent,
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
