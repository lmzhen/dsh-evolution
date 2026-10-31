import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { parseFrontmatter } from '@deepseek-ai/dsh-evolution-core'
import type { DomainAssignmentService } from './assignment.ts'
import { skillKeyOf } from './identity.ts'
import { threeFieldHashOf } from './identity.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'evolution/approval-decided'(payload: { readonly record: { readonly kind: string; readonly args: unknown }; readonly action: 'approve' | 'reject'; readonly ok: boolean }): void
  }
}

/** Options for the create sidecar; it never writes skill content. */
export interface AssignmentSidecarOptions {
  readonly provider?: string | undefined
  readonly source?: string | undefined
  readonly onSubmitted?: (() => void) | undefined
}

function submitCreate(service: DomainAssignmentService, args: Record<string, unknown>, options: AssignmentSidecarOptions): Promise<void> | undefined {
  if (typeof args.name !== 'string' || args.name.length === 0) return undefined
  const content = typeof args.content === 'string' ? args.content : ''
  const parsed = parseFrontmatter(content)
  const description = parsed?.frontmatter.description ?? ''
  const rawWhenToUse = parsed?.frontmatter.whenToUse
  const whenToUse = typeof rawWhenToUse === 'string' ? rawWhenToUse : undefined
  const domain = args.domain
  const proposal = typeof domain === 'object' && domain !== null ? domain as never : undefined
  return service.submit({
    skillKey: skillKeyOf({ provider: options.provider ?? 'dsh-evolution', source: options.source ?? 'user-dsh', name: args.name }),
    threeFieldHash: threeFieldHashOf({ name: args.name, description, ...whenToUse === undefined ? {} : { whenToUse } }),
    modelInvocable: parsed?.frontmatter['disable-model-invocation'] !== true,
    ...whenToUse === undefined ? {} : { whenToUse },
    ...proposal === undefined ? {} : { proposal },
  }).then(() => options.onSubmitted?.())
}

/**
 * Observe successful create calls and submit their optional domain proposal.
 * Direct creates submit immediately; staged creates submit only after approval.
 * @param ctx - plugin context with tools and approval events.
 * @param service - the one assignment service.
 * @param options - provider/source identity for skillKey.
 * @returns disposer for both listeners.
 */
export function installAssignmentSidecar(ctx: Context, service: DomainAssignmentService, options: AssignmentSidecarOptions = {}): () => void {
  const stopResult = ctx.on('tools/result', (exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>) => {
    if (result.isError || exec.name !== 'skill_manage' || exec.agent === undefined) return
    const structured = result.value as { readonly pending_id?: unknown } | undefined
    if (structured?.pending_id !== undefined) return
    const args = exec.arguments
    if (typeof args !== 'object' || args === null) return
    const record = args as Record<string, unknown>
    if (record.action !== 'create') return
    void submitCreate(service, record, options)?.catch(() => {})
  })
  const stopApproval = ctx.on('evolution/approval-decided', ({ record, action, ok }: { record: { readonly kind: string; readonly args: unknown }; action: 'approve' | 'reject'; ok: boolean }) => {
    if (!ok || action !== 'approve' || record.kind !== 'skill' || typeof record.args !== 'object' || record.args === null) return
    const raw = record.args as Record<string, unknown>
    const operation = typeof raw.operation === 'object' && raw.operation !== null ? raw.operation as Record<string, unknown> : raw
    if (operation.action !== 'create') return
    void submitCreate(service, operation, options)?.catch(() => {})
  })
  return () => { stopResult(); stopApproval() }
}
