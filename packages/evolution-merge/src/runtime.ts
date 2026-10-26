/**
 * The merge command runtime: cards -> screening -> channel ports -> scan/approve.
 * Plugin wiring supplies the channel, model and library; this module keeps the orchestration
 * out of apply() and makes the mutating verbs testable with fakes.
 */
import { createHash } from 'node:crypto'
import { errorText, isProcessAlive, probeText, SkillLibrary, UnitTransactions, skillLibraryUnitBackend, type EvolutionIoLike, type RunRegistry, type UnitTransaction } from '@deepseek-ai/dsh-evolution-core'
import { targetClaimUnitPort } from './unit-claim.ts'
import { canRetry, pairKey, type MergeCandidate, type MergeDecision, type MergeRow } from './contracts.ts'
import { skippedPairKeys } from './skipped.ts'
import type { MergeParams } from './params.ts'
import type { SkillCard } from './skill-card.ts'
import type { MergeRegistryPort } from './run-shell.ts'
import type { MergeCommandContext, MergeCommandResult, MergeCommandService } from './merge-command.ts'
import { createReadOnlyMergeService } from './merge-command.ts'
import { formatRunDetail, formatRunsView } from './status.ts'
import { readMergeSnapshot } from './domain/merge-snapshot.ts'
import { buildRunDetail, buildRunsView } from './surface/merge-view.ts'
import { handleReadOnlyMergeCommand } from './read-commands.ts'
import { runScanCommand } from './scan-command.ts'
import { runApproveCommand } from './approve-command.ts'
import { runResumeCommand } from './resume-command.ts'
import { loadMergeState } from './state.ts'
import { pairLedger } from './domain/pair-ledger.ts'
import { readCommitReceipts } from './commit-receipt.ts'
import { runUndoOperation } from './undo-operation.ts'
import { readStageIndex } from './domain/stage-aggregate.ts'
import { skillLibraryUndoPort } from './adapters/undo.ts'
import { mergeDoctor } from './doctor.ts'
import { formatReconcileReport, reconcileMergeState } from './domain/reconcile.ts'
import { commandError, formatMergeError, type MergeError } from './domain/errors.ts'
import type { StageToolContext } from './stage-tool.ts'
import { createChannelScanPorts, createStageForCards } from './scan-ports.ts'
import { createNewChildRound2 } from './new-child-authoring.ts'
import { skillLibraryPort } from './adapters/library.ts'
import type { ConversationChannelLike } from './channel-port.ts'
import { fitToolText } from './presentation-budget.ts'
import { sourceRevisionOf, targetRevisionOf, sourceRevisionRefOf, targetRevisionRefOf, supportDigestOf, revisionMismatch } from './revision.ts'
import { inFlightPairRun, readRunMetas } from './domain/run-coordinator.ts'
import { liveRowFactsOf } from './domain/live-facts.ts'

function fail(stage: string, code: string, hint: string, next: string, runId?: string): MergeCommandResult {
  return { ok: false, text: formatMergeError(commandError(stage, code, hint, next, runId)) }
}
function failRun(stage: string, hint: string, next: string, result: { readonly message: string; readonly error?: MergeError; readonly runId?: string }): MergeCommandResult {
  return result.error === undefined ? fail(stage, 'run-failed', hint, next, result.runId) : { ok: false, text: formatMergeError(result.error) }
}

async function hostOnlyFailure(verb: 'scan' | 'pair', probe: (() => Promise<{ readonly code: 'E-323'; readonly detail?: string } | undefined>) | undefined): Promise<MergeCommandResult | undefined> {
  if (probe === undefined) return undefined
  const state = await probe().catch(() => ({ code: 'E-323' as const, detail: 'host probe failed' }))
  return state === undefined ? undefined : fail(verb, 'e-323', 'host data plane unavailable: ' + state.code + (state.detail === undefined ? '' : ' (' + state.detail + ')'), 'run /evolution merge doctor')
}
interface BusyTarget { readonly id: string; readonly runId?: string }
/**
 * The approved/fuse row that already holds a target. Pair/approve move a row to
 * approved/fuse BEFORE their run starts, so this row IS the in-flight claim a second
 * same-target run would collide with (the pair itself is guarded by run-meta).
 */
function busyTarget(rows: readonly MergeRow[], target: string, excludeRowId: string): BusyTarget | undefined {
  const row = rows.find(item => item.id !== excludeRowId && (item.state === 'approved' || item.state === 'fuse') && item.decision?.target === target)
  return row === undefined ? undefined : { id: row.id, ...(row.runId === undefined ? {} : { runId: row.runId }) }
}
export function forcedDecisionFor(a: string, b: string): MergeDecision {
  const sorted = [a, b].sort()
  const raw = ('merge-' + sorted.join('-')).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  const target = raw.length <= 64 ? raw : raw.slice(0, 55) + '-' + createHash('sha256').update(raw).digest('hex').slice(0, 8)
  return { shouldMerge: true, mode: 'create-umbrella', target, sources: [a, b], rationale: 'forced pair merge of ' + sorted.join(' and '), confidence: 0.5, aSummary: 'A: ' + sorted[0] + ' 的现有技能面。', bSummary: 'B: ' + sorted[1] + ' 的现有技能面。' }
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
  readonly hostOnly?: () => Promise<{ readonly code: 'E-323'; readonly detail?: string } | undefined>
  readonly parent: unknown
  readonly allow: readonly string[]
  readonly cwd?: string
  readonly timeoutMinutes: number
  /** Start scan/pair in the background and return the run id immediately. */
  readonly detached?: boolean
  readonly cards: (signal: AbortSignal) => Promise<readonly SkillCard[]>
  /** Curator gate set: excluded/referenced/suppressed/protected builtins. */
  readonly isBlocked?: (name: string) => boolean | Promise<boolean>
  readonly isOwnerActive?: (runId: string) => boolean | Promise<boolean>
  /** The host's current model identity, recorded on pending decisions. */
  readonly model?: string
  /** Run-scoped engine screening. */
  readonly screeningForRun: (cards: readonly SkillCard[], runId: string, signal: AbortSignal) => Promise<readonly MergeCandidate[]>
  readonly stage?: MergeStageBindingPort
  /** G2 transitional: when set, authoring commits through core UnitTransaction. */
  readonly unit?: UnitTransaction
}

async function removeRuntimeRow(io: EvolutionIoLike, home: string, id: string, event: 'superseded' | 'restored' | 'committed', unitId?: string): Promise<boolean> {
  return await pairLedger(io, home).transact(tx => {
    const current = tx.rows().find(item => item.id === id)
    if (current === undefined) return false
    const unit = event === 'committed' ? { unitId: unitId ?? 'unknown', evidenceSha256: 'legacy' } : undefined
    return tx.remove(id, event, unit, current.version).ok
  })
}

export function unitFor(deps: MergeRuntimeDeps): UnitTransaction | undefined {
  if (deps.unit !== undefined) return deps.unit
  if (!(deps.skills instanceof SkillLibrary)) return undefined
  return new UnitTransactions({ io: deps.io, home: deps.home, backend: skillLibraryUnitBackend(deps.skills), claim: targetClaimUnitPort(deps.io, deps.home, deps.now), now: deps.now })
}

export function createMergeRuntime(deps: MergeRuntimeDeps): MergeCommandService {
  const readOnly = createReadOnlyMergeService(deps.io, deps.home)
  const timeout = deps.timeoutMinutes > 0 ? deps.timeoutMinutes : undefined
  const common = {
    io: deps.io, home: deps.home, registry: deps.registry,
    platformWrite: deps.platformWrite, now: deps.now,
    ...(deps.model === undefined ? {} : { model: deps.model }),
    ...(deps.isOwnerActive === undefined ? {} : { isOwnerActive: deps.isOwnerActive }),
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
      const agentless = context?.agentless === true
      const detached = deps.detached !== false
      if (command.verb === 'pair') {
        const signal = new AbortController().signal
        if (command.a === command.b) return fail('pair', 'pair-same-source', 'merge pair 需要两个不同技能源：' + command.a, '重新指定两个不同的 family-managed 技能')
        if ([command.a, command.b].some(name => name.includes('/') || name.includes(':'))) {
          return { ok: false, text: 'merge: 技能名不能包含 provider/name 或 provider:name 语法：' + command.a + ' / ' + command.b + ' (provider-conflict)\nusage: /evolution merge pair <a> <b>' }
        }
        // FR-RUN-03: a session-less invocation cannot host a merge child. Answer E-305 in
        // the three-line shape instead of opening a run that is guaranteed to fail.
        if (agentless) return fail('pair', 'e-305', errorText('e-305-this-invocation-carries-no', { a1: 'pair' }), '在 GUI 或 CLI 的会话里运行 /evolution merge pair ' + command.a + ' ' + command.b)
        const pairHost = await hostOnlyFailure('pair', deps.hostOnly)
        if (pairHost !== undefined) return pairHost
        // FR-EXEC-17/NFR-04: two pair runs for one pair must not race for the same row.
        const pairKeyValue = pairKey(command.a, command.b)
        const inFlight = inFlightPairRun(await readRunMetas(deps.io, deps.home), pairKeyValue)
        let ownerActive = false
        if (inFlight !== undefined) {
          if (deps.isOwnerActive !== undefined) ownerActive = await deps.isOwnerActive(inFlight.runId)
          else ownerActive = inFlight.pid === undefined ? true : isProcessAlive(inFlight.pid)
        }
        if (inFlight !== undefined && ownerActive) {
          // NFR-04: the same pair is idempotent, not an error — answer the run that already owns it.
          return { ok: true, text: 'merge pair 已在运行：' + inFlight.runId + '；作用域：family-managed 技能对，1 对，无 per-run 上限' }
        }
        const cards = await deps.cards(signal)
        const cardA = cards.find(card => card.name === command.a)
        const cardB = cards.find(card => card.name === command.b)
        if (cardA === undefined || cardB === undefined || cardA.managed !== true || cardB.managed !== true) {
          return fail('pair', 'pair-not-managed', 'merge pair 仅支持 family-managed 技能：' + command.a + ' / ' + command.b, '运行 /evolution doctor 查看 family-managed 技能范围')
        }
        if (cardA.protectedBy != null || cardB.protectedBy != null
          || cardA.protectionUnknown === true || cardB.protectionUnknown === true) {
          return fail('pair', 'pair-protected', 'merge pair 不接受受保护/保护状态未知技能：' + command.a + ' / ' + command.b, '解除保护或换一对技能后重试')
        }
        if ((await deps.isBlocked?.(command.a)) === true || (await deps.isBlocked?.(command.b)) === true) {
          return fail('pair', 'pair-blocked', 'merge pair 不接受被范围门拦下的技能：' + command.a + ' / ' + command.b, '运行 /evolution scope 查看范围门，或换一对技能')
        }
        const pair = [{ a: command.a, b: command.b }]
        const existing = (await loadMergeState(deps.io, deps.home)).state.rows.find(row => row.pairKey === pairKey(command.a, command.b))
        let cleared = false
        if (existing?.state === 'skipped' || (existing?.state === 'fuse' && existing.failure?.retryable === false)) {
          const dropped = await removeRuntimeRow(deps.io, deps.home, existing.id, 'superseded')
          if (!dropped) return fail('pair', 'row-changed', '清理可替换行时发现并发修改：' + existing.id, '运行 /evolution merge status 后重试')
          cleared = true
        }
        if (existing?.state === 'verify' && existing.runId !== undefined && (await deps.isOwnerActive?.(existing.runId)) === true) {
          return fail('pair', 'merge-pair-in-flight', '同一 pair 已在运行 ' + existing.runId, '等待该 run 结束，或运行 /evolution merge status ' + existing.runId, existing.runId)
        }
        if (existing?.state === 'pending') {
          return fail('pair', 'pair-pending', '该 pair 已在待批准队列：' + existing.id, '先运行 /evolution merge approve/reject/discard ' + existing.id, existing.runId)
        }
        if (!cleared && (existing?.state === 'approved' || existing?.state === 'fuse')) {
          return fail('pair', 'pair-fuse', '该 pair 已在待合并队列，可复用决策重跑', '运行 /evolution merge resume --retry ' + (existing.runId ?? existing.id), existing.runId)
        }
        const forced = command.force === true ? forcedDecisionFor(command.a, command.b) : undefined
        const approval = deps.params.mergeApproval
        const result = await runScanCommand({
          ...common,
          approval,
          cards,
          ...(detached ? { detached: true } : {}),
          makePorts: (runId) => {
            const ports = createChannelScanPorts({
              io: deps.io, home: deps.home, runId, cards,
              screening: () => Promise.resolve(pair),
              channel: deps.channel, parent, allow: deps.allow,
              ...(deps.cwd === undefined ? {} : { cwd: deps.cwd }),
              timeoutMs: deps.params.mergePairTimeoutMinutes * 60_000,
              approval,
              commitPort: skillLibraryPort(deps.skills), now: deps.now, ...(unitFor(deps) === undefined ? {} : { unit: unitFor(deps) }),
            ...(deps.params.limitsSnapshot === undefined ? {} : { limits: deps.params.limitsSnapshot.skillLimits }),
              ...(deps.isBlocked === undefined ? {} : { isBlocked: deps.isBlocked }),
              ...stageHooks,
            })
            return forced === undefined ? ports : { ...ports, round1: () => Promise.resolve({ kind: 'merge' as const, decision: forced }) }
          },
        })
        if (!result.ok) return failRun('pair', result.message, '修复后重新发起 pair；run 报告见 /evolution merge report', result)
        if ('accepted' in result) return { ok: true, text: 'merge pair 已启动：' + result.runId + '；作用域：family-managed 技能对，1 对，无 per-run 上限' }
        if (!('report' in result)) return fail('pair', 'report-missing', 'merge pair 已结束但没有写报告', '重新运行 pair，或运行 /evolution merge runs 查看运行')
        return { ok: true, text: 'merge pair 完成：merged ' + String(result.report.totals.merged) + ' / pending ' + String(result.report.totals.pending) + ' / failed ' + String(result.report.totals.failed) }
      }
      if (command.verb === 'scan') {
        if (agentless) return fail('scan', 'e-305', errorText('e-305-this-invocation-carries-no', { a1: 'scan' }), '在 GUI 或 CLI 的会话里运行 /evolution merge scan')
        const scanHost = await hostOnlyFailure('scan', deps.hostOnly)
        if (scanHost !== undefined) return scanHost
        const signal = new AbortController().signal
        const cards = await deps.cards(signal)
        const blocked = new Set<string>()
        for (const card of cards) if ((await deps.isBlocked?.(card.name)) === true) blocked.add(card.name)
        const managed = new Set(cards
          .filter(card => card.managed === true && card.protectedBy == null && !blocked.has(card.name))
          .map(card => card.name))
        const loadedState = await loadMergeState(deps.io, deps.home)
        const skipped = skippedPairKeys(loadedState.state.rows, deps.params.mergeSkippedTtlDays, deps.now())
        const held = new Set(loadedState.state.rows.filter(row => row.queue === 'pending' || row.queue === 'fuse'
          || (row.queue === 'verify' && (row.runId !== undefined && deps.now() - Date.parse(row.updatedAt) < 10 * 60_000 || !canRetry(row))))
          .map(row => row.pairKey))
        const notes = loadedState.state.rows
          .filter(row => row.state === 'pending' || row.state === 'approved' || row.state === 'fuse' || row.state === 'skipped')
          .map(row => 'conflict:' + row.state + ':' + row.pairKey + ':' + row.id)
        const result = await runScanCommand({
          ...common,
          approval: deps.params.mergeApproval,
          notes,
          cards,
          ...(detached ? { detached: true } : {}),
          makePorts: runId => createChannelScanPorts({
            io: deps.io, home: deps.home, runId, cards,
            resolve: async candidate => {
              const live = await deps.cards(signal)
              return live.some(card => card.name === candidate.a) && live.some(card => card.name === candidate.b)
            },
            screening: async (turnSignal) => {
              const raw = await deps.screeningForRun(cards, runId, turnSignal)
              const degraded = (raw as readonly MergeCandidate[] & { readonly degraded?: readonly string[] }).degraded
              if (degraded !== undefined) notes.push(...degraded)
              const filtered = raw.filter((candidate) => {
                const key = pairKey(candidate.a, candidate.b)
                return managed.has(candidate.a) && managed.has(candidate.b) && !skipped.has(key) && !held.has(key)
              })
              const candidatePairs = (raw as readonly MergeCandidate[] & { readonly candidatePairs?: number }).candidatePairs
              const reportOnly = (raw as readonly MergeCandidate[] & { readonly reportOnly?: readonly unknown[] }).reportOnly
              return Object.assign(filtered, {
                ...(candidatePairs === undefined ? {} : { candidatePairs }),
                ...(reportOnly === undefined ? {} : { reportOnly }),
              })
            },
            channel: deps.channel, parent, allow: deps.allow,
            ...(deps.cwd === undefined ? {} : { cwd: deps.cwd }),
            timeoutMs: deps.params.mergePairTimeoutMinutes * 60_000,
            approval: deps.params.mergeApproval,
            commitPort: skillLibraryPort(deps.skills), now: deps.now, ...(unitFor(deps) === undefined ? {} : { unit: unitFor(deps) }),
            ...(deps.params.limitsSnapshot === undefined ? {} : { limits: deps.params.limitsSnapshot.skillLimits }),
            ...(deps.isBlocked === undefined ? {} : { isBlocked: deps.isBlocked }),
            ...stageHooks,
          }),
        })
        if (!result.ok) return failRun('scan', result.message, '修复后重新 scan；run 报告见 /evolution merge report', result)
        if ('accepted' in result) return { ok: true, text: 'merge scan 已启动：' + result.runId + '；作用域：family-managed 技能库，候选来源 engine screening，无 per-run 上限' }
        if (!('report' in result)) return fail('scan', 'report-missing', 'merge scan 已结束但没有写报告', '重新运行 scan，或运行 /evolution merge runs 查看运行')
        return { ok: true, text: 'merge scan 完成：merged ' + String(result.report.totals.merged) + ' / pending ' + String(result.report.totals.pending) + ' / failed ' + String(result.report.totals.failed) }
      }
      if (command.verb === 'candidates' && command.retry === true) {
        if (command.id === undefined || command.id === '') return fail('candidates', 'candidates-id-required', 'candidates --retry 需要行 id', '运行 /evolution merge candidates 查看可重试行')
        const loaded = await loadMergeState(deps.io, deps.home)
        const row = loaded.state.rows.find(item => item.id === command.id)
        if (row === undefined) return fail('candidates', 'row-not-found', '找不到候选行：' + command.id, '运行 /evolution merge candidates 查看候选')
        if (row.state !== 'verify') return fail('candidates', 'candidates-retry-unavailable', '只有待判断行可重跑第 1 轮：' + row.state, '改用 resume --retry 或重新 pair')
        const signal = new AbortController().signal
        const cards = await deps.cards(signal)
        const pairCandidate: MergeCandidate = { a: row.a, b: row.b }
        const result = await runScanCommand({
          ...common,
          approval: deps.params.mergeApproval,
          notes: ['candidates --retry ' + row.id],
          cards,
          makePorts: runId => createChannelScanPorts({
            io: deps.io, home: deps.home, runId, cards,
            screening: async () => [pairCandidate],
            resolve: async candidate => {
              const live = await deps.cards(signal)
              return live.some(card => card.name === candidate.a) && live.some(card => card.name === candidate.b)
            },
            channel: deps.channel, parent, allow: deps.allow,
            ...(deps.cwd === undefined ? {} : { cwd: deps.cwd }),
            timeoutMs: deps.params.mergePairTimeoutMinutes * 60_000,
            approval: deps.params.mergeApproval,
            commitPort: skillLibraryPort(deps.skills), now: deps.now, ...(unitFor(deps) === undefined ? {} : { unit: unitFor(deps) }),
            ...(deps.params.limitsSnapshot === undefined ? {} : { limits: deps.params.limitsSnapshot.skillLimits }),
            ...(deps.isBlocked === undefined ? {} : { isBlocked: deps.isBlocked }),
            ...stageHooks,
          }),
        })
        if (!result.ok) return failRun('candidates', result.message, '修复后重试 candidates --retry', result)
        if ('accepted' in result) return { ok: true, text: 'candidates --retry 已启动：' + result.runId + '；作用域：单条 verify 行重跑，无 per-run 上限' }
        if (!('report' in result)) return fail('candidates', 'report-missing', 'candidates --retry 已结束但没有写报告', '运行 /evolution merge runs 查看运行')
        return { ok: true, text: 'candidates --retry 完成：merged ' + String(result.report.totals.merged) + ' / pending ' + String(result.report.totals.pending) + ' / failed ' + String(result.report.totals.failed) }
      }
      if (command.verb === 'reject') {
        const loaded = await loadMergeState(deps.io, deps.home)
        const row = loaded.state.rows.find(item => item.id === command.id)
        if (row === undefined) return fail('reject', 'row-not-found', '找不到合并行 ' + command.id, '运行 /evolution merge pending 查看待处理行', command.id)
        const changed = await pairLedger(deps.io, deps.home).transact(tx => {
          const current = tx.rows().find(item => item.id === row.id)
          if (current === undefined || current.state !== 'pending') return false
          return tx.transition(row.id, { type: 'skipped', reason: 'rejected', origin: 'human' }, current.version).ok
        })
        if (!changed) return fail('reject', 'row-not-pending', '该行不是 pending，或已被并发修改：' + command.id, '运行 /evolution merge status ' + command.id + ' 后重试', row.runId)
        return { ok: true, text: '已拒绝合并：' + command.id }
      }
      if (command.verb === 'reconcile') {
        const cards = await deps.cards(new AbortController().signal).catch(() => undefined)
        // An empty/unreadable library is NOT "every source is gone": only a non-empty live
        // list may authorize source-gone convergence.
        const managed = cards === undefined || cards.length === 0 ? undefined : new Set(cards.map(card => card.name))
        const live = cards === undefined || cards.length === 0 ? undefined : liveRowFactsOf(cards)
        try {
          const report = await reconcileMergeState({ io: deps.io, home: deps.home, now: deps.now, ttlDays: deps.params.mergeSkippedTtlDays, ...(managed === undefined ? {} : { managed }), ...(live === undefined ? {} : { live }) })
          if (report.state === 'blocked') return fail('reconcile', report.code ?? 'merge-state-blocked', report.message ?? '合并状态不可读', '先修复合并状态，再运行 /evolution merge doctor')
          return { ok: true, text: formatReconcileReport(report) }
        } catch (error) {
          return fail('reconcile', 'reconcile-failed', error instanceof Error ? error.message : String(error), '运行 /evolution merge doctor 查看状态后重试')
        }
      }
      if (command.verb === 'doctor') {
        const rows = await mergeDoctor(deps.io, deps.home, deps.params.mergeModelsRoot)
        return { ok: true, text: rows.map(row => row.key + ' [' + row.status + '] ' + row.label + '：' + row.detail).join('\n') }
      }
      if (command.verb === 'report' || command.verb === 'runs' || command.verb === 'cancel') {
        const registry = deps.registry as unknown as RunRegistry
        if (command.verb === 'runs') {
          const mergeRuns = registry.runs('merge')
          const snapshot = await readMergeSnapshot({ io: deps.io, home: deps.home, runs: mergeRuns, approval: deps.params.mergeApproval, now: deps.now })
          return { ok: true, text: formatRunsView(buildRunsView(snapshot)) }
        }
        if (command.verb === 'cancel') {
          if (command.id !== undefined) {
            const cancelled = registry.cancel(command.id)
            return cancelled ? { ok: true, text: '已请求取消 ' + command.id } : fail('cancel', 'run-not-found', '没有可取消的 run：' + command.id, '运行 /evolution merge runs 查看可取消的运行')
          }
          const runs = registry.runs('merge')
          let count = 0
          for (const run of runs) if (registry.cancel(run.id)) count += 1
          return { ok: true, text: '已请求取消 ' + String(count) + ' 个 merge 运行' }
        }
        const run = command.id === undefined ? registry.runs('merge')[0] : registry.find(command.id)
        if (run === undefined) return fail('report', 'run-not-found', '找不到 merge run：' + (command.id ?? '(latest)'), '运行 /evolution merge runs 查看运行列表')
        if (run.resultRef === undefined) return fail('report', 'report-missing', '该 run 还没有报告：' + run.id, '等待 run 结束，或运行 /evolution merge status ' + run.id, run.id)
        const report = await probeText(deps.io, run.resultRef)
        if (report.kind === 'unknown') return fail('report', 'report-unreadable', '报告不可读：' + run.resultRef + '（' + report.reason + '）', '检查结果文件权限，或重新运行该命令', run.id)
        return report.kind === 'absent'
          ? fail('report', 'report-missing', '报告不存在：' + run.resultRef, '重新运行该命令生成报告', run.id)
          : { ok: true, text: 'report: ' + run.resultRef + '\n' + fitToolText(report.value, 7600) }
      }
      if (command.verb === 'discard') {
        const loaded = await loadMergeState(deps.io, deps.home)
        const row = loaded.state.rows.find(item => item.id === command.id)
        if (row === undefined) return fail('discard', 'row-not-found', '找不到合并行 ' + command.id, '运行 /evolution merge status 查看当前队列', command.id)
        if (row.state !== 'pending' && row.state !== 'approved' && row.state !== 'fuse') return fail('discard', 'row-not-discardable', '该行状态是 ' + row.state + '，不可丢弃：' + command.id, '只有 pending/approved/fuse 行可丢弃', row.runId)
        const dropped = await removeRuntimeRow(deps.io, deps.home, row.id, 'superseded')
        if (!dropped) return fail('discard', 'row-changed', '丢弃时发现并发修改：' + command.id, '运行 /evolution merge status ' + command.id + ' 后重试')
        return { ok: true, text: '已丢弃合并行：' + command.id }
      }
      if (command.verb === 'undo') {
        const receipts = (await readCommitReceipts(deps.io, deps.home)).filter(receipt => (receipt.parentRunId ?? receipt.runId) === command.run && receipt.target === command.target)
        if (receipts.length === 0) return fail('undo', 'receipt-not-found', '该 run 没有目标回执：' + command.run + ' / ' + command.target, '只有已提交的 run 可 undo；运行 /evolution merge runs 查看')
        const undoRunId = receipts[0]!.parentRunId ?? receipts[0]!.runId
        const undoRegistry = deps.registry as unknown as RunRegistry
        if (undoRegistry.runs('merge').some(run => run.id === undoRunId && run.supersededAt !== undefined)) return fail('undo', 'run-superseded', '该 run 已因技能树 restore 失效，不能再 undo：' + undoRunId, '运行 /evolution merge runs 查看失效标记')
        const unit = unitFor(deps)
        const result = await runUndoOperation({ io: deps.io, home: deps.home, runId: undoRunId, port: skillLibraryUndoPort(deps.skills), now: deps.now, target: command.target, ...(unit === undefined ? {} : { finalizeUnit: id => unit.finalize.call(unit, id) }) })
        return result.ok ? { ok: true, text: result.message } : fail('undo', 'undo-failed', result.message, '检查回执与暂存后重试')
      }
      if (command.verb === 'skipped' && command.restore !== undefined) {
        const loaded = await loadMergeState(deps.io, deps.home)
        const row = loaded.state.rows.find(item => item.id === command.restore)
        if (row === undefined || row.state !== 'skipped') return fail('skipped', 'row-not-found', '找不到可恢复的 skipped 行：' + command.restore, '运行 /evolution merge skipped 查看跳过队列', command.restore)
        const dropped = await removeRuntimeRow(deps.io, deps.home, row.id, 'restored')
        if (!dropped) return fail('skipped', 'row-changed', '恢复时发现并发修改：' + row.id, '运行 /evolution merge status 后重试')
        return { ok: true, text: '已恢复参与筛选：' + row.id }
      }
      if (command.verb === 'resume') {
        if (command.clear !== undefined) {
          const cleared = (await loadMergeState(deps.io, deps.home)).state.rows.find(item => item.id === command.clear)
          if (cleared === undefined) return fail('resume', 'row-not-found', '找不到要清除的行：' + command.clear, '运行 /evolution merge status 查看当前队列')
          const dropped = await removeRuntimeRow(deps.io, deps.home, cleared.id, 'superseded')
          if (!dropped) return fail('resume', 'row-changed', '清除时发现并发修改：' + cleared.id, '运行 /evolution merge status 后重试')
          return { ok: true, text: '已清除合并行：' + cleared.id }
        }
        const loaded = await loadMergeState(deps.io, deps.home)
        if (command.id === undefined) {
          const resumable = loaded.state.rows.filter(item => item.state === 'fuse' || item.state === 'verify' || (command.retry === true && item.state === 'approved'))
          return fail('resume', 'resume-id-required', 'merge resume 需要 <id>；可恢复行：' + (resumable.length === 0 ? '(none)' : resumable.map(item => item.id).join(', ')), '运行 /evolution merge resume --retry <id> 复用某一行的决策')
        }
        const row = loaded.state.rows.find(item => item.id === command.id)
        if (row === undefined) return fail('resume', 'row-not-found', '找不到可恢复行 ' + command.id, '运行 /evolution merge candidates 查看可恢复行')
        const signal = new AbortController().signal
        const cards = await deps.cards(signal)
        if ((row.state === 'fuse' || row.state === 'approved') && row.decision !== undefined && row.decision.mode !== 'create-umbrella') {
          const targetCard = cards.find(card => card.name === row.decision?.target)
          if (targetCard !== undefined && targetCard.managed !== true) return fail('resume', 'target-not-managed', 'target 不是 family-managed：' + row.decision.target, '重新 pair 并选一个 managed 目标', row.runId)
          if (targetCard !== undefined && (targetCard.protectionUnknown === true || targetCard.protectedBy != null)) return fail('resume', 'target-protected', 'target 受保护：' + row.decision.target, '解除保护或改选其它目标', row.runId)
          if (await deps.isBlocked?.(row.decision.target) === true) return fail('resume', 'target-blocked', 'target 被范围门拦下：' + row.decision.target, '运行 /evolution scope 查看范围门', row.runId)
        }
        // NFR-04: a resume commits into the same target a running approve/pair may hold;
        // the target is serialised here too, not only at the commit claim.
        if ((row.state === 'fuse' || row.state === 'approved') && row.decision !== undefined) {
          const busy = busyTarget(loaded.state.rows, row.decision.target, row.id)
          if (busy !== undefined) return fail('resume', 'merge-target-busy', '目标 ' + row.decision.target + ' 正被 ' + busy.id + ' 占用，串行等待', '等待占用行结算，或 /evolution merge discard ' + busy.id, busy.runId)
        }
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
          ...common, rowId: row.id, ports: basePorts, approval: deps.params.mergeApproval,
          ...(agentless ? { agentless: true } : {}),
          ...(detached ? { detached: true } : {}),
          pairTimeoutMinutes: deps.params.mergePairTimeoutMinutes,
          ...(deps.isOwnerActive === undefined ? {} : { isOwnerActive: deps.isOwnerActive }),
          makePorts: runId => createChannelScanPorts({
            io: deps.io, home: deps.home, runId, cards, screening: pair,
            channel: deps.channel, parent, allow: deps.allow,
            ...(deps.cwd === undefined ? {} : { cwd: deps.cwd }),
            timeoutMs: deps.params.mergePairTimeoutMinutes * 60_000,
            approval: deps.params.mergeApproval, commitPort: skillLibraryPort(deps.skills), now: deps.now, ...(unitFor(deps) === undefined ? {} : { unit: unitFor(deps) }),
            ...(deps.params.limitsSnapshot === undefined ? {} : { limits: deps.params.limitsSnapshot.skillLimits }),
            ...(deps.isBlocked === undefined ? {} : { isBlocked: deps.isBlocked }),
          }),
          round2WithRun: createNewChildRound2({
            io: deps.io, home: deps.home, cards, channel: deps.channel, parent,
            parentRunId: (runId: string) => runId,
            allow: deps.allow, ...(deps.cwd === undefined ? {} : { cwd: deps.cwd }),
            timeoutMs: deps.params.mergePairTimeoutMinutes * 60_000,
            commitPort: skillLibraryPort(deps.skills), now: deps.now, ...(unitFor(deps) === undefined ? {} : { unit: unitFor(deps) }),
            ...(deps.params.limitsSnapshot === undefined ? {} : { limits: deps.params.limitsSnapshot.skillLimits }),
            ...(deps.isBlocked === undefined ? {} : { isBlocked: deps.isBlocked }),
            ...stageHooks,
          }),
        })
        if (!result.ok) return failRun('resume', result.message, '修复后重新 resume；run 报告见 /evolution merge report', result)
        if ('accepted' in result) return { ok: true, text: 'merge resume 已启动：' + result.runId + '；作用域：单条待合并行重跑 agent2，无 per-run 上限' }
        if (!('report' in result)) return fail('resume', 'report-missing', 'merge resume 已结束但没有写报告', '重新运行 resume，或运行 /evolution merge runs 查看运行')
        return { ok: true, text: 'merge resume 完成：merged ' + String(result.report.totals.merged) }
      }
      if (command.verb === 'approve') {
        const signal = new AbortController().signal
        const cards = await deps.cards(signal)
        let candidate = (await loadMergeState(deps.io, deps.home)).state.rows.find(row => row.id === command.id)
        if (candidate !== undefined && candidate.stagingRef === undefined) {
          const entry = await readStageIndex(deps.io, deps.home, candidate.id, deps.now())
          if (entry !== null) candidate = { ...candidate, stagingRef: entry.ref, stagingExpiresAt: entry.expiresAt }
        }
        if (candidate !== undefined && candidate.state === 'pending' && candidate.decision !== undefined) {
          const target = candidate.decision.target
          const rowsNow = (await loadMergeState(deps.io, deps.home)).state.rows
          // NFR-04: a second approve for the same target waits for the holder.
          const busy = busyTarget(rowsNow, target, candidate.id)
          if (busy !== undefined) {
            return fail('approve', 'merge-target-busy', '目标 ' + target + ' 正被 ' + busy.id + ' 占用，串行等待', '等待占用行结算，或 /evolution merge discard ' + busy.id, busy.runId)
          }
          const targetCardNow = cards.find(card => card.name === target)
          if (targetCardNow !== undefined && (targetCardNow.protectionUnknown === true || targetCardNow.protectedBy != null)) {
            return fail('approve', 'target-protected', '目标技能「' + target + '」在决策后变为受保护，拒绝提交', '解除保护或改选其它目标', candidate.runId)
          }
          const missingSource = [candidate.a, candidate.b].find(name => !cards.some(card => card.name === name && card.managed === true))
          if (missingSource !== undefined) {
            const dropped = await removeRuntimeRow(deps.io, deps.home, candidate.id, 'superseded')
            if (!dropped) return fail('approve', 'row-changed', 'source-gone，但行已被并发修改，未清理：' + candidate.id, '运行 /evolution merge status ' + candidate.id + ' 后重试')
            return fail('approve', 'source-gone', missingSource + ' 已不在 family-managed 技能库，已从 active 队列清除', '重新 pair 该技能对；剩余行用 /evolution merge discard ' + candidate.id, candidate.runId)
          }
          const sourceExpected = candidate.decision?.sourceRevisionRef ?? candidate.sourceRevisionRef
          const targetExpected = candidate.decision?.targetRevisionRef ?? candidate.targetRevisionRef
          const targetMismatch = revisionMismatch(targetExpected, targetRevisionRefOf(cards, candidate.decision.target))
          if (targetMismatch !== null) {
            await pairLedger(deps.io, deps.home).transact(tx => { const current = tx.rows().find(item => item.id === candidate.id); return current === undefined ? false : tx.transition(candidate.id, { type: 'expired', kind: 'target-taken' }, current.version).ok })
            return fail('approve', 'target-taken', '目标 ' + candidate.decision.target + ' 在决策后已被占用', '重新 pair，或 /evolution merge discard ' + candidate.id, candidate.runId)
          }
          if (candidate.decision.supportDigest !== undefined && candidate.decision.supportDigest !== supportDigestOf(cards, [candidate.decision.target, candidate.a, candidate.b])) {
            await pairLedger(deps.io, deps.home).transact(tx => { const current = tx.rows().find(item => item.id === candidate.id); return current === undefined ? false : tx.transition(candidate.id, { type: 'expired', kind: 'source-changed' }, current.version).ok })
            return fail('approve', 'source-changed', '源技能内容在决策后变化，拒绝照跑', '重新 pair，或 /evolution merge discard ' + candidate.id, candidate.runId)
          }
          if (revisionMismatch(sourceExpected, sourceRevisionRefOf(cards, candidate.a, candidate.b)) !== null) {
            await pairLedger(deps.io, deps.home).transact(tx => { const current = tx.rows().find(item => item.id === candidate.id); return current === undefined ? false : tx.transition(candidate.id, { type: 'expired', kind: 'source-changed' }, current.version).ok })
            return fail('approve', 'source-changed', '源技能参考在决策后变化，拒绝照跑', '重新 pair，或 /evolution merge discard ' + candidate.id, candidate.runId)
          }
          const currentRevision = sourceRevisionOf(cards, candidate.a, candidate.b)
          if (candidate.sourceRevision !== undefined && currentRevision !== undefined && currentRevision !== candidate.sourceRevision) {
            const recorded = await pairLedger(deps.io, deps.home).transact(tx => {
              const current = tx.rows().find(item => item.id === candidate.id)
              return current === undefined ? false : tx.transition(candidate.id, { type: 'expired', kind: 'source-changed' }, current.version).ok
            })
            if (!recorded) return fail('approve', 'row-changed', '记录 source-changed 时发现并发修改：' + candidate.id, '运行 /evolution merge status ' + candidate.id + ' 后重试')
            return fail('approve', 'source-changed', '源技能内容在决策后变化，拒绝照跑', '重新 pair，或 /evolution merge discard ' + candidate.id, candidate.runId)
          }
          const currentTargetRevision = targetRevisionOf(cards, candidate.decision.target)
          if (candidate.targetRevision !== undefined && currentTargetRevision !== undefined
            && currentTargetRevision !== candidate.targetRevision) {
            const recorded = await pairLedger(deps.io, deps.home).transact(tx => {
              const current = tx.rows().find(item => item.id === candidate.id)
              return current === undefined ? false : tx.transition(candidate.id, { type: 'expired', kind: 'target-taken' }, current.version).ok
            })
            if (!recorded) return fail('approve', 'row-changed', '记录 target-taken 时发现并发修改：' + candidate.id, '运行 /evolution merge status ' + candidate.id + ' 后重试')
            return fail('approve', 'target-taken', '目标 ' + candidate.decision.target + ' 在决策后变化，拒绝照跑', '重新 pair，或 /evolution merge discard ' + candidate.id, candidate.runId)
          }
          if (candidate.decision.mode !== 'create-umbrella') {
            const targetCard = cards.find(card => card.name === candidate.decision?.target)
            if (targetCard !== undefined && targetCard.managed !== true) {
              return fail('approve', 'target-not-managed', 'target 不是 family-managed：' + candidate.decision.target, '重新 pair 并选一个 managed 目标', candidate.runId)
            }
            if (targetCard !== undefined && (targetCard.protectionUnknown === true || targetCard.protectedBy != null)) {
              return fail('approve', 'target-protected', 'target 受保护：' + candidate.decision.target, '解除保护或改选其它目标', candidate.runId)
            }
            if (await deps.isBlocked?.(candidate.decision.target) === true) {
              return fail('approve', 'target-blocked', 'target 被范围门拦下：' + candidate.decision.target, '运行 /evolution scope 查看范围门', candidate.runId)
            }
          }
          if (candidate.decision.mode === 'merge-into-existing' && !cards.some(card => card.name === candidate.decision?.target)) {
            const recorded = await pairLedger(deps.io, deps.home).transact(tx => {
              const current = tx.rows().find(item => item.id === candidate.id)
              return current === undefined ? false : tx.transition(candidate.id, { type: 'expired', kind: 'target-taken' }, current.version).ok
            })
            if (!recorded) return fail('approve', 'row-changed', '记录 target-taken 时发现并发修改：' + candidate.id, '运行 /evolution merge status ' + candidate.id + ' 后重试')
            return fail('approve', 'target-taken', '目标 ' + candidate.decision.target + ' 已不存在，行保留 pending --expired', '重新 pair，或 /evolution merge discard ' + candidate.id, candidate.runId)
          }
        }
        const result = await runApproveCommand({
          ...common,
          rowId: command.id,
          ...(agentless ? { agentless: true } : {}),
          ...(detached ? { detached: true } : {}),
          pairTimeoutMinutes: deps.params.mergePairTimeoutMinutes,
          ports: {
            stage: createStageForCards({ io: deps.io, home: deps.home, runId: command.id, cards, now: deps.now }),
            round2: createNewChildRound2({
              io: deps.io, home: deps.home, cards, channel: deps.channel, parent,
              parentRunId: (runId: string) => runId,
              allow: deps.allow, ...(deps.cwd === undefined ? {} : { cwd: deps.cwd }),
              timeoutMs: deps.params.mergePairTimeoutMinutes * 60_000,
              commitPort: skillLibraryPort(deps.skills), now: deps.now, ...(unitFor(deps) === undefined ? {} : { unit: unitFor(deps) }),
            ...(deps.params.limitsSnapshot === undefined ? {} : { limits: deps.params.limitsSnapshot.skillLimits }),
              ...(deps.isBlocked === undefined ? {} : { isBlocked: deps.isBlocked }),
              ...stageHooks,
            }),
          },
        })
        if (!result.ok) return failRun('approve', result.message, '修复后重新 approve；run 报告见 /evolution merge report', result)
        if ('accepted' in result) return { ok: true, text: 'merge approve 已启动：' + result.runId + '；作用域：单条 pending 行批准后重跑 agent2，无 per-run 上限' }
        if (!('report' in result)) return fail('approve', 'report-missing', 'merge approve 已结束但没有写报告', '重新运行 approve，或运行 /evolution merge runs 查看运行')
        return { ok: true, text: 'merge approve 完成：merged ' + String(result.report.totals.merged) }
      }
      const cards = command.verb === 'pending' ? await deps.cards(new AbortController().signal) : undefined
      const registry = deps.registry as unknown as RunRegistry
      const runs = command.verb === 'status' ? registry.runs('merge') : undefined
      if (command.verb === 'status' && command.id !== undefined) {
        const found = runs?.find(item => item.id === command.id) ?? registry.find(command.id)
        if (found !== undefined && found.kind === 'merge') {
          // CLI consumer of the RunDetail envelope: current pair, per-pair outcome, stop reason.
          const snapshot = await readMergeSnapshot({ io: deps.io, home: deps.home, runs: runs !== undefined && runs.some(item => item.id === found.id) ? runs : [...(runs ?? []), found], approval: deps.params.mergeApproval, now: deps.now })
          if (snapshot.blocked !== undefined) return fail('status', snapshot.blocked.code, snapshot.blocked.message, '先修复合并状态（/evolution merge doctor），再查看运行')
          const detail = buildRunDetail(snapshot, found.id)
          if (detail === null) return fail('status', 'run-not-found', '找不到 merge run ' + found.id, '运行 /evolution merge runs 查看运行列表')
          return { ok: true, text: formatRunDetail(detail) }
        }
        const row = (await loadMergeState(deps.io, deps.home)).state.rows.find(item => item.id === command.id)
        if (row === undefined) return fail('status', 'row-not-found', '找不到合并行或 run：' + command.id, '运行 /evolution merge status 查看队列，或 /evolution merge runs 查看运行')
      }
      // FR-LIFE-14: CLI reads derive the same pending expiry the snapshot route does;
      // the library read stays lazy (only invoked when a pending row needs derivation).
      const liveForRead = async (): Promise<ReturnType<typeof liveRowFactsOf> | undefined> => {
        const list = cards ?? await deps.cards(new AbortController().signal).catch(() => [])
        return list.length === 0 ? undefined : liveRowFactsOf(list)
      }
      const text = await handleReadOnlyMergeCommand(command, deps.io, deps.home, cards, runs, deps.params.mergeApproval, liveForRead)
      if (text !== null) return { ok: true, text }
      return readOnly.execute(command)
    },
  }
}
