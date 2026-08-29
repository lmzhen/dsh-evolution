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
  'evolution-policy',
  'evolution-io',
  'evolution-io-node',
  'evolution-state-storage',
  'evolution-state-domain',
  'evolution-state-json',
  'evolution-state',
  'memory',
  'memory-files',
  'skill-usage',
  'evolution-approval',
  'evolution-threat',
  'evolution-review',
  'evolution-curator',
  'evolution-commands',
  'evolution-activity',
  'evolution-feedback',
  'evolution-learning-graph',
  'evolution-replay',
] as const

export const HOST_ROW_NAMES = {
  'evolution-policy': scoped('@deepseek-ai/dsh-evolution-policy'),
  'evolution-io': scoped('@deepseek-ai/dsh-evolution-io'),
  'evolution-io-node': scoped('@deepseek-ai/dsh-evolution-io-node'),
  'evolution-state-storage': scoped('@deepseek-ai/dsh-evolution-state-storage'),
  'evolution-state-domain': scoped('@deepseek-ai/dsh-evolution-state-domain'),
  'evolution-state-json': scoped('@deepseek-ai/dsh-evolution-state-json'),
  'evolution-state': scoped('@deepseek-ai/dsh-evolution-state'),
  memory: scoped('@deepseek-ai/dsh-memory'),
  'memory-files': scoped('@deepseek-ai/dsh-memory-files'),
  'skill-usage': scoped('@deepseek-ai/dsh-skill-usage'),
  'evolution-approval': scoped('@deepseek-ai/dsh-evolution-approval'),
  'evolution-threat': scoped('@deepseek-ai/dsh-evolution-threat'),
  'evolution-review': scoped('@deepseek-ai/dsh-evolution-review'),
  'evolution-curator': scoped('@deepseek-ai/dsh-evolution-curator'),
  'evolution-commands': scoped('@deepseek-ai/dsh-evolution-commands'),
  'evolution-activity': scoped('@deepseek-ai/dsh-evolution-activity'),
  'evolution-feedback': scoped('@deepseek-ai/dsh-evolution-feedback'),
  'evolution-learning-graph': scoped('@deepseek-ai/dsh-evolution-learning-graph'),
  'evolution-replay': scoped('@deepseek-ai/dsh-evolution-replay'),
} as const

export const AGENT_EVOLUTION_ROW_IDS = [
  'tool-memory',
  'tool-skill-manage',
  'tool-session-query',
  'evolution-skill-catalog',
] as const

export const AGENT_EVOLUTION_ROW_NAMES = {
  'tool-memory': scoped('@deepseek-ai/dsh-tool-memory'),
  'tool-skill-manage': scoped('@deepseek-ai/dsh-tool-skill-manage'),
  'tool-session-query': scoped('@deepseek-ai/dsh-tool-session-query'),
  'evolution-skill-catalog': scoped('@deepseek-ai/dsh-evolution-skill-catalog'),
} as const

/** Model-facing tools that the host bundle must never register. */
export const MODEL_TOOL_NAMES = Object.values(AGENT_EVOLUTION_ROW_NAMES) as readonly string[]

/** Rows the compatibility preset must contain, regardless of ordering. */
export const COMPAT_CONTAINS_ROW_IDS = [
  ...HOST_ROW_IDS,
  ...AGENT_EVOLUTION_ROW_IDS,
] as const
