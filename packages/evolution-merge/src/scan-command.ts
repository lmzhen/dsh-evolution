/**
 * scan command wiring: the registry/report shell around runScan.
 * Pair/approve/resume commands get their own thin wrappers on the same shell.
 */
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { runScan, type ScanPorts } from './scan-run.ts'
import { withMergeRun, type MergeRegistryPort, type WithMergeRunResult } from './run-shell.ts'

export interface RunScanCommandOptions {
  readonly io: EvolutionIoLike
  readonly home: string
  readonly registry: MergeRegistryPort
  readonly ports?: ScanPorts
  /** Build per-run ports when staging needs the runId (channel authoring). */
  readonly makePorts?: (runId: string) => ScanPorts
  readonly approval: boolean
  readonly platformWrite: boolean
  readonly timeoutMinutes?: number
  readonly now: () => number
  readonly detached?: boolean
  readonly notes?: readonly string[]
  readonly isOwnerActive?: (runId: string) => boolean | Promise<boolean>
  readonly cards?: readonly import('./skill-card.ts').SkillCard[]
}

export async function runScanCommand(options: RunScanCommandOptions): Promise<WithMergeRunResult> {
  return await withMergeRun({
    io: options.io,
    home: options.home,
    registry: options.registry,
    command: 'scan',
    approval: { platformWrite: options.platformWrite, mergeApproval: options.approval },
    now: options.now,
    ...(options.detached === undefined ? {} : { detached: options.detached }),
    ...(options.timeoutMinutes === undefined ? {} : { timeoutMinutes: options.timeoutMinutes }),
    async body(ctx) {
      const ports = options.makePorts === undefined ? options.ports : options.makePorts(ctx.runId)
      if (ports === undefined) throw new Error('scan requires ports or makePorts')
      return await runScan({
        io: options.io,
        home: options.home,
        now: options.now,
        signal: ctx.signal,
        approval: options.approval,
        ports,
        stage: ctx.stage,
        startedAt: ctx.startedAt,
        runId: ctx.runId,
        ...(options.timeoutMinutes === undefined ? {} : { timeoutMinutes: options.timeoutMinutes }),
        ...(options.notes === undefined ? {} : { notes: options.notes }),
        ...(options.isOwnerActive === undefined ? {} : { isOwnerActive: options.isOwnerActive }),
        ...(options.cards === undefined ? {} : { cards: options.cards }),
      })
    },
  })
}
