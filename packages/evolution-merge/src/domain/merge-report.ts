/** 1b-1 additive report schema; values are filled by later batches. */
export interface MergeReportLimits {
  readonly maxSkillFileBytes?: number
  readonly maxTokenBytes?: number
  readonly pairTimeoutMinutes?: number
}
export interface MergeReportValidation {
  readonly ok: boolean
  readonly errors: readonly string[]
}
export interface MergeReport {
  readonly schemaVersion: 2
  readonly reportId: string
  readonly runId: string
  readonly pairKey: string
  readonly target: string
  readonly sourceRevisions?: Readonly<Record<string, string>>
  readonly targetRevision?: string
  readonly validation: MergeReportValidation
  readonly limits: MergeReportLimits
  readonly q09?: { readonly forwardRefs: readonly string[]; readonly reverseRefs: readonly string[]; readonly orphanFiles: readonly string[] }
  readonly threat?: { readonly body: string; readonly source: string }
  readonly createdAt: string
}
export interface MergeReportRef {
  readonly path: string
  readonly digest: string
  readonly writtenAt: string
}
export interface MergeReportWriter {
  write(report: MergeReport): Promise<MergeReportRef>
  read(runId: string): Promise<MergeReport | null>
}
