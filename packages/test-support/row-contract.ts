/**
 * Stable public row-id contract for the layered installation.
 *
 * These ids are the compatibility surface profile authors patch by id.
 * Changing one requires a deliberate contract update and a preset release,
 * never an incidental row rename.
 */
function scoped(name: string): string {
  const scope = process.env.EVOLUTION_SCOPE?.trim()
  if (!scope) return name
  return `${scope}/${name.slice('@deepseek-ai/'.length)}`
}

export const HOST_ROW_IDS = [
  'evolution-platform',
  'evolution-core-runtime',
  'evolution-policy',
  'evolution-io',
  'evolution-io-platform',
  'evolution-authority',
  'evolution-state-storage',
  'evolution-state-domain',
  'evolution-state-store',
  'evolution-state',
  'memory',
  'memory-files',
  'skill-usage',
  'evolution-approval',
  'evolution-threat',
  'evolution-review',
  'evolution-curator',
  'evolution-commands',
  'evolution-maintenance-tools',
  'evolution-activity',
  'evolution-feedback',
  'evolution-learning-graph',
  'evolution-replay',
  'evolution-merge',
] as const

export const HOST_ROW_NAMES = {
  'evolution-platform': scoped('@deepseek-ai/dsh-evolution-platform'),
  'evolution-core-runtime': scoped('@deepseek-ai/dsh-evolution-core/runtime'),
  'evolution-policy': scoped('@deepseek-ai/dsh-evolution-core/policy'),
  'evolution-io': scoped('@deepseek-ai/dsh-evolution-core/io-registry'),
  'evolution-io-platform': scoped('@deepseek-ai/dsh-evolution-core/io-platform'),
  'evolution-authority': scoped('@deepseek-ai/dsh-evolution-core/authority-plugin'),
  'evolution-state-storage': scoped('@deepseek-ai/dsh-evolution-core/state/storage'),
  'evolution-state-domain': scoped('@deepseek-ai/dsh-evolution-core/state/domain'),
  'evolution-state-store': scoped('@deepseek-ai/dsh-evolution-core/state/store-plugin'),
  'evolution-state': scoped('@deepseek-ai/dsh-evolution-core/state'),
  memory: scoped('@deepseek-ai/dsh-memory'),
  'memory-files': scoped('@deepseek-ai/dsh-memory/files'),
  'skill-usage': scoped('@deepseek-ai/dsh-evolution-skill-discovery/usage'),
  'evolution-approval': scoped('@deepseek-ai/dsh-evolution-approval'),
  'evolution-threat': scoped('@deepseek-ai/dsh-evolution-activity/threat'),
  'evolution-review': scoped('@deepseek-ai/dsh-evolution-review'),
  'evolution-curator': scoped('@deepseek-ai/dsh-evolution-curator'),
  'evolution-commands': scoped('@deepseek-ai/dsh-evolution-commands'),
  'evolution-maintenance-tools': scoped('@deepseek-ai/dsh-evolution-maintenance/tools'),
  'evolution-activity': scoped('@deepseek-ai/dsh-evolution-activity'),
  'evolution-feedback': scoped('@deepseek-ai/dsh-evolution-activity/feedback'),
  'evolution-learning-graph': scoped('@deepseek-ai/dsh-evolution-activity/learning-graph'),
  'evolution-replay': scoped('@deepseek-ai/dsh-evolution-activity/replay'),
  'evolution-merge': scoped('@deepseek-ai/dsh-evolution-merge'),
} as const

export const AGENT_EVOLUTION_ROW_IDS = [
  'tool-memory',
  'tool-skill-manage',
  'evolution-skill-catalog',
  'evolution-skill-discovery',
] as const

export const AGENT_EVOLUTION_ROW_NAMES = {
  'tool-memory': scoped('@deepseek-ai/dsh-memory/tools'),
  'tool-skill-manage': scoped('@deepseek-ai/dsh-tool-skill-manage'),
  'evolution-skill-catalog': scoped('@deepseek-ai/dsh-evolution-skill-discovery/catalog'),
  'evolution-skill-discovery': scoped('@deepseek-ai/dsh-evolution-skill-discovery'),
} as const

/** Model-facing tools that the host bundle must never register. */
export const MODEL_TOOL_NAMES = Object.values(AGENT_EVOLUTION_ROW_NAMES) as readonly string[]

/** Rows the compatibility preset must contain, regardless of ordering. */
export const COMPAT_CONTAINS_ROW_IDS = [
  ...HOST_ROW_IDS,
  ...AGENT_EVOLUTION_ROW_IDS,
] as const
