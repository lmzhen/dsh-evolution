/**
 * The merge command runtime: cards -> screening -> channel ports -> scan/approve.
 * Plugin wiring supplies the channel, model and library; this module keeps the orchestration
 * out of apply() and makes the mutating verbs testable with fakes.
 */
import { probeText, type EvolutionIoLike, type RunRegistry, type SkillLibrary } from '@deepseek-ai/dsh-evolution-core'
import { canRetry, pairKey, type MergeCandidate, type MergeDecision } from './contracts.ts'
import { skippedPairKeys } from './skipped.ts'
import type { MergeParams } from './params.ts'
import type { SkillCard } from './skill-card.ts'
import type { MergeRegistryPort } from './run-shell.ts'
import type { MergeCommandContext, MergeCommandService } from './merge-command.ts'
import { createReadOnlyMergeService } from './merge-command.ts'
import { handleReadOnlyMergeCommand } from './read-commands.ts'
import { runScanCommand } from './scan-command.ts'
import { runApproveCommand } from './approve-command.ts'
import { runResumeCommand } from './resume-command.ts'
import { dropRow, loadMergeState, upsertRow } from './state.ts'
import { transition } from './coordinator.ts'
import { readCommitReceipt } from './commit-receipt.ts'
import { undoMergeReceipt } from './undo-merge.ts'
import { recordPair } from './domain/pair-index-store.ts'
import { skillLibraryUndoPort } from './adapters/undo.ts'
import { mergeDoctor } from './doctor.ts'
import type { StageToolContext } from './stage-tool.ts'
import { createChannelScanPorts } from './scan-ports.ts'
import { createNewChildRound2 } from './new-child-authoring.ts'
import { skillLibraryPort } from './adapters/library.ts'
import type { ConversationChannelLike } from './channel-port.ts'
import { fitToolText } from './presentation-budget.ts'
import { sourceRevisionOf, targetRevisionOf } from './revision.ts'

function forcedDecisionFor(a: string, b: string): MergeDecision {
  const sorted = [a, b].sort()
  const target = ('merge-' + sorted.join('-')).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
  return { shouldMerge: true, mode: 'create-umbrella', target, sources: [a, b], rationale: 'forced pair merge of ' + sorted.join(' and ') }
}

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
  /** Start scan/pair in the background and return the run id immediately. */
  readonly detached?: boolean
  readonly cards: (signal: AbortSignal) => Promise<readonly SkillCard[]>
  /** Run-scoped engine screening. */
  readonly screeningForRun: (cards: readonly SkillCard[], runId: string, signal: AbortSignal) => Promise<readonly MergeCandidate[]>
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
  const stage = deps.stage
  const stageHooks = stage === undefined ? {} : {
    onChild: (context: StageToolContext) => { stage.bind(context) },
    onChildClosed: (childId: string) => { stage.unbind(childId) },
  }
  return {
    async execute(command, context?: MergeCommandContext) {
      const parent = context?.parent ?? deps.parent
      const detached = deps.detached !== false
      if (command.verb === 'pair') {
        const signal = new AbortController().signal
        if (command.a === command.b) return { ok: false, text: 'merge pair 需要两个不同技能源: ' + command.a }
        const cards = await deps.cards(signal)
        const cardA = cards.find(card => card.name === command.a)
        const cardB = cards.find(card => card.name === command.b)
        if (cardA === undefined || cardB === undefined || cardA.managed !== true || cardB.managed !== true) {
          return { ok: false, text: 'merge pair 仅支持 family-managed 技能: ' + command.a + ' / ' + command.b }
        }
        if (cardA.protectedBy != null || cardB.protectedBy != null
          || cardA.protectionUnknown === true || cardB.protectionUnknown === true) {
          return { ok: false, text: 'merge pair 不接受受保护/保护状态未知技能: ' + command.a + ' / ' + command.b }
        }
        const pair = [{ a: command.a, b: command.b }]
        const existing = (await loadMergeState(deps.io, deps.home)).state.rows.find(row => row.pairKey === pairKey(command.a, command.b))
        if (existing?.state === 'skipped') {
          await dropRow(deps.io, deps.home, deps.now, existing.id)
        }
        if (existing?.state === 'pending') {
          return { ok: false, text: '该 pair 已在待批准队列，先 approve/reject/discard: ' + existing.id }
        }
        if (existing?.state === 'approved' || existing?.state === 'fuse') {
          return { ok: false, text: '该 pair 已在待合并队列，用 merge resume --retry 复用: ' + (existing.runId ?? existing.id) }
        }
        const forced = command.force === true ? forcedDecisionFor(command.a, command.b) : undefined
        const approval = deps.params.mergeApproval
        const result = await runScanCommand({
          ...common,
          approval,
          ...(detached ? { detached: true } : {}),
          makePorts: (runId) => {
            const ports = createChannelScanPorts({
              io: deps.io, home: deps.home, runId, cards,
              screening: () => Promise.resolve(pair),
              channel: deps.channel, parent, allow: deps.allow,
              ...(deps.cwd === undefined ? {} : { cwd: deps.cwd }),
              timeoutMs: deps.params.mergePairTimeoutMinutes * 60_000,
              approval,
              commitPort: skillLibraryPort(deps.skills), now: deps.now,
              ...stageHooks,
            })
            return forced === undefined ? ports : { ...ports, round1: () => Promise.resolve({ kind: 'merge' as const, decision: forced }) }
          },
        })
        if (!result.ok) return { ok: false, text: result.message }
        if ('accepted' in result) return { ok: true, text: 'merge pair 已启动：' + result.runId }
        if (!('report' in result)) return { ok: false, text: 'merge pair started without a report' }
        return { ok: true, text: 'merge pair 完成：merged ' + String(result.report.totals.merged) + ' / pending ' + String(result.report.totals.pending) + ' / failed ' + String(result.report.totals.failed) }
      }
      if (command.verb === 'scan') {
        const signal = new AbortController().signal
        const cards = await deps.cards(signal)
        const managed = new Set(cards.filter(card => card.managed === true && card.protectedBy == null).map(card => card.name))
        const loadedState = await loadMergeState(deps.io, deps.home)
        const skipped = skippedPairKeys(loadedState.state.rows, deps.params.mergeSkippedTtlDays, deps.now())
        const held = new Set(loadedState.state.rows.filter(row => row.queue === 'pending' || row.queue === 'fuse' || !canRetry(row)).map(row => row.pairKey))
        const conflictNotes = loadedState.state.rows
          .filter(row => row.state === 'pending' || row.state === 'approved' || row.state === 'fuse' || row.state === 'skipped')
          .map(row => 'conflict:' + row.state + ':' + row.pairKey + ':' + row.id)
        const result = await runScanCommand({
          ...common,
          approval: deps.params.mergeApproval,
          notes: conflictNotes,
          ...(detached ? { detached: true } : {}),
          makePorts: runId => createChannelScanPorts({
            io: deps.io, home: deps.home, runId, cards,
            screening: async (turnSignal) => {
              const raw = await deps.screeningForRun(cards, runId, turnSignal)
              const filtered = raw.filter((candidate) => {
                const key = pairKey(candidate.a, candidate.b)
                return managed.has(candidate.a) && managed.has(candidate.b) && !skipped.has(key) && !held.has(key)
              })
              const candidatePairs = (raw as readonly MergeCandidate[] & { readonly candidatePairs?: number }).candidatePairs
              return candidatePairs === undefined ? filtered : Object.assign(filtered, { candidatePairs })
            },
            channel: deps.channel, parent, allow: deps.allow,
            ...(deps.cwd === undefined ? {} : { cwd: deps.cwd }),
            timeoutMs: deps.params.mergePairTimeoutMinutes * 60_000,
            approval: deps.params.mergeApproval,
            commitPort: skillLibraryPort(deps.skills), now: deps.now,
            ...stageHooks,
          }),
        })
        if (!result.ok) return { ok: false, text: result.message }
        if ('accepted' in result) return { ok: true, text: 'merge scan 已启动：' + result.runId }
        if (!('report' in result)) return { ok: false, text: 'merge scan started without a report' }
        return { ok: true, text: 'merge scan 完成：merged ' + String(result.report.totals.merged) + ' / pending ' + String(result.report.totals.pending) + ' / failed ' + String(result.report.totals.failed) }
      }
      if (command.verb === 'reject') {
        const loaded = await loadMergeState(deps.io, deps.home)
        const row = loaded.state.rows.find(item => item.id === command.id)
        if (row === undefined) return { ok: false, text: 'merge row not found: ' + command.id }
        const next = transition(row, { type: 'reject', at: new Date(deps.now()).toISOString() })
        if (!next.ok || next.row === null) return { ok: false, text: 'merge row is not pending: ' + command.id }
        await upsertRow(deps.io, deps.home, deps.now, next.row)
        return { ok: true, text: '已拒绝合并：' + command.id }
      }
      if (command.verb === 'doctor') {
        const rows = await mergeDoctor(deps.io, deps.home, deps.params.mergeModelsRoot)
        return { ok: true, text: rows.map(row => row.key + ' [' + row.status + '] ' + row.label + '：' + row.detail).join('\n') }
      }
      if (command.verb === 'report' || command.verb === 'runs' || command.verb === 'cancel') {
        const registry = deps.registry as unknown as RunRegistry
        if (command.verb === 'runs') {
          const mergeRuns = registry.runs('merge')
          return { ok: true, text: mergeRuns.length === 0 ? 'merge runs: empty' : ['merge runs: ' + String(mergeRuns.length)].concat(mergeRuns.map(run => '- ' + run.id + ' [' + run.state + ']' + (run.resultRef === undefined ? '' : ' ' + run.resultRef))).join('\n') }
        }
        if (command.verb === 'cancel') {
          if (command.id !== undefined) {
            const cancelled = registry.cancel(command.id)
            return { ok: cancelled, text: cancelled ? '已请求取消 ' + command.id : '没有可取消的 run: ' + command.id }
          }
          const count = registry.cancelAll()
          return { ok: true, text: '已请求取消 ' + String(count) + ' 个运行' }
        }
        const run = command.id === undefined ? registry.runs('merge')[0] : registry.find(command.id)
        if (run === undefined) return { ok: false, text: 'merge run not found: ' + (command.id ?? '(latest)') }
        if (run.resultRef === undefined) return { ok: false, text: 'merge run has no report yet: ' + run.id }
        const report = await probeText(deps.io, run.resultRef)
        if (report.kind === 'unknown') return { ok: false, text: 'report is unreadable: ' + run.resultRef + '：' + report.reason }
        return report.kind === 'absent'
          ? { ok: false, text: 'report is missing: ' + run.resultRef }
          : { ok: true, text: 'report: ' + run.resultRef + '\n' + fitToolText(report.value, 7600) }
      }
      if (command.verb === 'discard') {
        const loaded = await loadMergeState(deps.io, deps.home)
        const row = loaded.state.rows.find(item => item.id === command.id)
        if (row === undefined) return { ok: false, text: 'merge row not found: ' + command.id }
        if (row.state !== 'pending' && row.state !== 'approved' && row.state !== 'fuse') return { ok: false, text: 'merge row is not discardable: ' + command.id }
        await dropRow(deps.io, deps.home, deps.now, row.id)
        return { ok: true, text: '已丢弃合并行：' + command.id }
      }
      if (command.verb === 'undo') {
        const receipt = await readCommitReceipt(deps.io, deps.home, command.run, command.target)
        if (receipt === null) return { ok: false, text: 'merge run has no commit receipt: ' + command.run }
        if (receipt.target !== command.target) return { ok: false, text: 'receipt target is ' + receipt.target + ', not ' + command.target }
        const result = await undoMergeReceipt(receipt, skillLibraryUndoPort(deps.skills))
        if (result.ok && receipt.pairKey !== undefined) {
          await recordPair(deps.io, deps.home, { pairKey: receipt.pairKey, runId: receipt.parentRunId ?? receipt.runId, result: 'undone', target: receipt.target })
        }
        return { ok: result.ok, text: result.message }
      }
      if (command.verb === 'skipped' && command.restore !== undefined) {
        const loaded = await loadMergeState(deps.io, deps.home)
        const row = loaded.state.rows.find(item => item.id === command.restore)
        if (row === undefined || row.state !== 'skipped') return { ok: false, text: 'skipped row not found: ' + command.restore }
        await dropRow(deps.io, deps.home, deps.now, row.id)
        return { ok: true, text: '已恢复参与筛选：' + row.id }
      }
      if (command.verb === 'resume') {
        if (command.clear !== undefined) {
          const cleared = (await loadMergeState(deps.io, deps.home)).state.rows.find(item => item.id === command.clear)
          if (cleared === undefined) return { ok: false, text: 'merge row not found: ' + command.clear }
          await dropRow(deps.io, deps.home, deps.now, cleared.id)
          return { ok: true, text: '已清除合并行：' + cleared.id }
        }
        const loaded = await loadMergeState(deps.io, deps.home)
        const row = command.id === undefined
          ? loaded.state.rows.find(item => item.state === 'fuse' || item.state === 'verify' || (command.retry === true && item.state === 'approved'))
          : loaded.state.rows.find(item => item.id === command.id)
        if (row === undefined) return { ok: false, text: 'merge row not found: ' + (command.id ?? '(auto)') }
        const signal = new AbortController().signal
        const cards = await deps.cards(signal)
        const pair = () => Promise.resolve([{ a: row.a, b: row.b }])
        const failed = (stage: 'decide' | 'author', code: string, message: string) => Promise.resolve({
          kind: 'failed' as const,
          failure: { stage, code, message, retryable: false, retryFrom: 'none' as const },
        })
        const basePorts = {
          screening: pair,
          round1: () => failed('decide', 'resume-needs-ports', 'verify resume needs makePorts'),
          round2: () => failed('author', 'resume-needs-child', 'fuse resume needs a new child'),
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
            ...stageHooks,
          }),
        })
        if (!result.ok) return { ok: false, text: result.message }
        if ('accepted' in result) return { ok: true, text: 'merge resume 已启动：' + result.runId }
        if (!('report' in result)) return { ok: false, text: 'merge resume started without a report' }
        return { ok: true, text: 'merge resume 完成：merged ' + String(result.report.totals.merged) }
      }
      if (command.verb === 'approve') {
        const signal = new AbortController().signal
        const cards = await deps.cards(signal)
        const candidate = (await loadMergeState(deps.io, deps.home)).state.rows.find(row => row.id === command.id)
        if (candidate !== undefined && candidate.state === 'pending' && candidate.decision !== undefined) {
          const missingSource = [candidate.a, candidate.b].find(name => !cards.some(card => card.name === name && card.managed === true))
          if (missingSource !== undefined) {
            await dropRow(deps.io, deps.home, deps.now, candidate.id)
            return { ok: false, text: 'source-gone：' + missingSource + ' 已不在 family-managed 技能库，已从 active 队列清除；可 merge skipped --discard 清理' }
          }
          const currentRevision = sourceRevisionOf(cards, candidate.a, candidate.b)
          if (candidate.sourceRevision !== undefined && currentRevision !== undefined && currentRevision !== candidate.sourceRevision) {
            const changed = transition(candidate, { type: 'source-changed', at: new Date().toISOString() })
            if (changed.ok && changed.row !== null) await upsertRow(deps.io, deps.home, deps.now, changed.row)
            return { ok: false, text: 'source-changed：源技能内容在决策后变化，拒绝照跑；出口：重新 merge pair，或 merge skipped --discard' }
          }
          const currentTargetRevision = targetRevisionOf(cards, candidate.decision.target)
          if (candidate.targetRevision !== undefined && currentTargetRevision !== undefined
            && currentTargetRevision !== candidate.targetRevision) {
            const taken = transition(candidate, { type: 'target-taken', at: new Date().toISOString() })
            if (taken.ok && taken.row !== null) await upsertRow(deps.io, deps.home, deps.now, taken.row)
            return { ok: false, text: 'target-taken：目标 ' + candidate.decision.target + ' 在决策后变化，拒绝照跑；可重新 merge pair 或 discard' }
          }
          if (candidate.decision.mode === 'merge-into-existing' && !cards.some(card => card.name === candidate.decision?.target)) {
            const expired = transition(candidate, { type: 'target-taken', at: new Date().toISOString() })
            if (expired.ok && expired.row !== null) await upsertRow(deps.io, deps.home, deps.now, expired.row)
            return { ok: false, text: 'target-taken：目标 ' + candidate.decision.target + ' 已不存在，行保留 pending --expired；出口：重新 merge pair，或 merge skipped --discard' }
          }
        }
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
        if (!result.ok) return { ok: false, text: result.message }
        if ('accepted' in result) return { ok: true, text: 'merge approve 已启动：' + result.runId }
        if (!('report' in result)) return { ok: false, text: 'merge approve started without a report' }
        return { ok: true, text: 'merge approve 完成：merged ' + String(result.report.totals.merged) }
      }
      const text = await handleReadOnlyMergeCommand(command, deps.io, deps.home)
      if (text !== null) return { ok: true, text }
      return readOnly.execute(command)
    },
  }
}
