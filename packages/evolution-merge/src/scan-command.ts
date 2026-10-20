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
  readonly ports: ScanPorts
  readonly approval: boolean
  readonly platformWrite: boolean
  readonly timeoutMinutes?: number
  readonly now: () => number
}

export async function runScanCommand(options: RunScanCommandOptions): Promise<WithMergeRunResult> {
  return await withMergeRun({
    io: options.io,
    home: options.home,
    registry: options.registry,
    command: 'scan',
    approval: { platformWrite: options.platformWrite, mergeApproval: options.approval },
    now: options.now,
    async body(ctx) {
      return await runScan({
        io: options.io,
        home: options.home,
        now: options.now,
        signal: ctx.signal,
        approval: options.approval,
        ports: options.ports,
        stage: ctx.stage,
        startedAt: ctx.startedAt,
        ...(options.timeoutMinutes === undefined ? {} : { timeoutMinutes: options.timeoutMinutes }),
      })
    },
  })
}
