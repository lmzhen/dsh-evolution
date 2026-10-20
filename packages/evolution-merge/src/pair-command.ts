/**
 * pair command: one explicit candidate through the same scan shell.
 */
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { runScanCommand, type RunScanCommandOptions } from './scan-command.ts'
import type { ScanPorts } from './scan-run.ts'
import type { MergeRegistryPort, WithMergeRunResult } from './run-shell.ts'

export interface RunPairCommandOptions {
  readonly io: EvolutionIoLike
  readonly home: string
  readonly registry: MergeRegistryPort
  readonly ports: ScanPorts
  readonly a: string
  readonly b: string
  readonly approval: boolean
  readonly platformWrite: boolean
  readonly timeoutMinutes?: number
  readonly now: () => number
}

export async function runPairCommand(options: RunPairCommandOptions): Promise<WithMergeRunResult> {
  const scanOptions: RunScanCommandOptions = {
    io: options.io,
    home: options.home,
    registry: options.registry,
    approval: options.approval,
    platformWrite: options.platformWrite,
    now: options.now,
    ports: {
      ...options.ports,
      screening: async () => [{ a: options.a, b: options.b }],
    },
    ...(options.timeoutMinutes === undefined ? {} : { timeoutMinutes: options.timeoutMinutes }),
  }
  return await runScanCommand(scanOptions)
}
