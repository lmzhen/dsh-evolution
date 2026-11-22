/**
 * Pure family-facing platform contract.
 *
 * This package owns the vocabulary shared by every feature package and the
 * single host adapter. It carries no runtime host import: the adapter is the
 * only package allowed to import `@deepseek-ai/dsh-*` values.
 *
 * The contract number changes only when the family-facing port surface changes
 * in a way the adapter cannot hide; host releases do not change it by
 * themselves.
 *
 * @module @deepseek-ai/dsh-evolution-adapter/contract
 */

export * from './platform-types.ts'
export * from './result.ts'
export * from './agents.ts'
export * from './commands.ts'
export * from './connection.ts'
export * from './llm.ts'
export * from './platformView.ts'
export * from './presets.ts'
export * from './profileContext.ts'
export * from './projections.ts'
export * from './service.ts'
export * from './settings.ts'
export * from './skills.ts'
export * from './storageDomain.ts'
export * from './subagents.ts'
export * from './systemPrompt.ts'
export * from './tools.ts'
export * from './userQuestions.ts'
export * from './workingDirectory.ts'

/** Family-facing platform contract generation. */
export const CONTRACT = 1 as const

/**
 * Semantic platform capability names. They describe what the host can do, not
 * which DSH version is running; the adapter populates the live set.
 */
export type PlatformCapability =
  | 'agents'
  | 'commands'
  | 'connection'
  | 'settings'
  | 'storage-domain'
  | 'session-projections'
  | 'skills'
  | 'system-prompt'
  | 'subagents'
  | 'user-questions'
  | 'working-directory'
  | 'tools'
  | 'presets'
  | 'projections'
  | 'llm'
  | 'plugin-manager'
  | 'plugin-inventory'
  | 'config-editor'
  | 'profile-context'

/** The capabilities the adapter resolved in this runtime. */
export interface PlatformCapabilities {
  readonly contract: typeof CONTRACT
  readonly present: ReadonlySet<PlatformCapability>
  readonly missing: ReadonlySet<PlatformCapability>
}
