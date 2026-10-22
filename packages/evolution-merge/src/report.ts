/**
 * Merge run report: JSON is the machine source, Markdown is the human digest.
 *
 * Reports are written before registry.settle, so a settled run's resultRef is readable.
 * readMergeReport uses the three-state probe: absent is not "no pairs", unknown is not empty.
 */
import { join } from 'node:path'
import {
  isPresent,
  probePresent,
  probeText,
  probeUnknown,
  type EvolutionIoLike,
  type Probe,
} from '@deepseek-ai/dsh-evolution-core'
import type { MergeReport, MergeReportPair } from './contracts.ts'

export function mergeReportPath(home: string, runId: string): string {
  return join(home, 'reports', 'merge-' + runId + '.json')
}

export function mergeReportDigestPath(home: string, runId: string): string {
  return join(home, 'reports', 'merge-' + runId + '.md')
}

function isReport(value: unknown): value is MergeReport {
  if (typeof value !== 'object' || value === null) return false
  const report = value as Partial<MergeReport>
  return report.schemaVersion === 2
    && report.kind === 'merge'
    && typeof report.runId === 'string'
    && typeof report.command === 'string'
    && typeof report.startedAt === 'number'
    && typeof report.endedAt === 'number'
    && Array.isArray(report.pairs)
    && typeof report.totals === 'object'
    && Array.isArray(report.notes)
}

function digest(report: MergeReport): string {
  const lines: string[] = []
  lines.push('# merge ' + report.runId)
  lines.push('')
  lines.push('- command: ' + report.command)
  lines.push('- stop: ' + report.stopReason)
  lines.push('- pairs: ' + String(report.pairs.length))
  lines.push('- totals: merged ' + String(report.totals.merged) + ', kept ' + String(report.totals.kept) + ', pending ' + String(report.totals.pending) + ', failed ' + String(report.totals.failed))
  for (const pair of report.pairs) {
    lines.push('- ' + pair.a + ' + ' + pair.b + ' -> ' + pair.outcome + (pair.target === undefined ? '' : ' (' + pair.target.actual + ')'))
  }
  if (report.remaining !== undefined && report.remaining.length > 0) {
    lines.push('')
    lines.push('- remaining: ' + report.remaining.map(item => item.pairKey).join(', '))
  }
  return lines.join('\n') + '\n'
}

/** Write JSON first, then the digest; returns the JSON path (the registry resultRef). */
export async function writeMergeReport(io: EvolutionIoLike, home: string, report: MergeReport): Promise<string> {
  const path = mergeReportPath(home, report.runId)
  await io.writeText(path, JSON.stringify(report, null, 2) + '\n')
  await io.writeText(mergeReportDigestPath(home, report.runId), digest(report))
  return path
}

export async function readMergeReport(io: EvolutionIoLike, home: string, runId: string): Promise<Probe<MergeReport>> {
  const probe = await probeText(io, mergeReportPath(home, runId))
  if (!isPresent(probe)) return probe
  try {
    const parsed: unknown = JSON.parse(probe.value)
    return isReport(parsed) ? probePresent(parsed) : probeUnknown('merge report has an unexpected shape')
  } catch (error) {
    return probeUnknown('merge report is not JSON: ' + (error instanceof Error ? error.message : String(error)))
  }
}

/** Pairs this run actually merged (for merge undo / reports). */
export async function committedPairs(io: EvolutionIoLike, home: string, runId: string): Promise<readonly MergeReportPair[]> {
  const probe = await readMergeReport(io, home, runId)
  return isPresent(probe) ? probe.value.pairs.filter(pair => pair.outcome === 'merged') : []
}
