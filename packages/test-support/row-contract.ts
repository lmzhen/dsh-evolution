/**
 * Stable public row-id contract for the layered installation.
 *
 * These ids are the compatibility surface profile authors patch by id.
 * Changing one requires a deliberate contract update and a preset release,
 * never an incidental row rename.
 */

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
  'evolution-capability',
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
  'evolution-policy': '@deepseek-ai/dsh-evolution-policy',
  'evolution-io': '@deepseek-ai/dsh-evolution-io',
  'evolution-io-node': '@deepseek-ai/dsh-evolution-io-node',
  'evolution-state-storage': '@deepseek-ai/dsh-evolution-state-storage',
  'evolution-state-domain': '@deepseek-ai/dsh-evolution-state-domain',
  'evolution-state-json': '@deepseek-ai/dsh-evolution-state-json',
  'evolution-state': '@deepseek-ai/dsh-evolution-state',
  memory: '@deepseek-ai/dsh-memory',
  'memory-files': '@deepseek-ai/dsh-memory-files',
  'skill-usage': '@deepseek-ai/dsh-skill-usage',
  'evolution-approval': '@deepseek-ai/dsh-evolution-approval',
  'evolution-capability': '@deepseek-ai/dsh-evolution-capability',
  'evolution-threat': '@deepseek-ai/dsh-evolution-threat',
  'evolution-review': '@deepseek-ai/dsh-evolution-review',
  'evolution-curator': '@deepseek-ai/dsh-evolution-curator',
  'evolution-commands': '@deepseek-ai/dsh-evolution-commands',
  'evolution-activity': '@deepseek-ai/dsh-evolution-activity',
  'evolution-feedback': '@deepseek-ai/dsh-evolution-feedback',
  'evolution-learning-graph': '@deepseek-ai/dsh-evolution-learning-graph',
  'evolution-replay': '@deepseek-ai/dsh-evolution-replay',
} as const

export const AGENT_EVOLUTION_ROW_IDS = [
  'tool-memory',
  'tool-skill-manage',
  'evolution-skill-catalog',
] as const

export const AGENT_EVOLUTION_ROW_NAMES = {
  'tool-memory': '@deepseek-ai/dsh-tool-memory',
  'tool-skill-manage': '@deepseek-ai/dsh-tool-skill-manage',
  'evolution-skill-catalog': '@deepseek-ai/dsh-evolution-skill-catalog',
} as const

/** Model-facing tools that the host bundle must never register. */
export const MODEL_TOOL_NAMES = Object.values(AGENT_EVOLUTION_ROW_NAMES) as readonly string[]

/** Rows the compatibility preset must contain, regardless of ordering. */
export const COMPAT_CONTAINS_ROW_IDS = [
  ...HOST_ROW_IDS,
  ...AGENT_EVOLUTION_ROW_IDS,
] as const
