/**
 * Every platform service the family reaches for with `ctx.get`, and what degrades without it.
 *
 * O-2 (v46 audit): the family probes 26 platform services optionally — the platform has no
 * formalized "optional dependency", so an ABSENT service is a silent downgrade and the diagnostic
 * surface is the only place a reader can learn about it. `/evolution doctor` used to judge six of
 * them; this table is the single source it judges the rest from, and the arch guard cross-checks it
 * against the actual probe sites so a new `ctx.get` cannot stay undeclared.
 *
 * `side` decides who can judge it: `host` probes run in the plugin process (doctor judges those),
 * `client` probes run in the browser half, where the host has no view of the seats.
 * @module @deepseek-ai/dsh-evolution-core
 */

/** One platform service the family probes, with the feature that goes quiet without it. */
export interface PlatformServiceProbe {
  /** The service key as `ctx.get` spells it. */
  readonly service: string
  /** The family feature that silently degrades when the service is absent. */
  readonly feature: string
  /** Where the probe runs. */
  readonly side: 'host' | 'client'
}

/** The 26 probes, in service-name order (the guard checks this list against the tree). */
export const PLATFORM_SERVICE_PROBES: readonly PlatformServiceProbe[] = Object.freeze([
  { service: 'agents', feature: 'review and curator subagent wake-ups', side: 'host' },
  { service: 'approval', feature: 'the platform approval policy the approval row shadows', side: 'host' },
  { service: 'configEditor', feature: 'the params view inherited-vs-override column', side: 'host' },
  { service: 'configForms', feature: 'the settings card seat (its section renders read-only without it)', side: 'client' },
  { service: 'evolutionApproval', feature: 'pending writes: list, approve and reject from the command surface', side: 'host' },
  { service: 'evolutionCurator', feature: '/evolution curator subcommands, skill undo and history', side: 'host' },
  { service: 'evolutionIo', feature: 'every durable read and write (the IO seam)', side: 'host' },
  { service: 'evolutionMemoryBudget', feature: 'the memory-budget divergence section of this report', side: 'host' },
  { service: 'evolutionPolicy', feature: 'the policy snapshot that shadows row knobs', side: 'host' },
  { service: 'evolutionReplay', feature: '/evolution replay', side: 'host' },
  { service: 'evolutionState', feature: 'the state facade behind activity and replay', side: 'host' },
  { service: 'llm', feature: 'the curator one-shot review model call', side: 'host' },
  { service: 'memory', feature: 'the cross-session memory store (review and learning-graph reads)', side: 'host' },
  { service: 'pluginInventory', feature: 'the plugin inventory view', side: 'host' },
  { service: 'pluginManager', feature: 'the platform plugin and preset surfaces this report reads', side: 'host' },
  { service: 'profileContext', feature: 'writing the agent-preset row into a profile patch', side: 'host' },
  { service: 'sessionProjections', feature: 'the domain-owned session units', side: 'host' },
  { service: 'sessionQuery', feature: 'the session corpus behind /evolution sessions', side: 'host' },
  { service: 'settings', feature: 'the settings user layer and the params view', side: 'host' },
  { service: 'skillUsage', feature: 'usage counters feeding the curator and the review planner', side: 'host' },
  { service: 'skills', feature: 'the platform skill catalog the skill tool writes through', side: 'host' },
  { service: 'storageDomain', feature: 'the storage-domain state provider', side: 'host' },
  { service: 'subagents', feature: 'spawning review and maintenance subagents', side: 'host' },
  { service: 'systemPrompt', feature: 'the protected-skills prompt variable', side: 'host' },
  { service: 'tools', feature: 'tool registration and the guard seam', side: 'host' },
  { service: 'webServer', feature: 'the skill-history panel routes', side: 'host' },
])

/**
 * The HOST-side probes that do not resolve in this runtime — what `/evolution doctor` prints as
 * "capability absence". Empty is the normal, healthy answer: every capability the family can use
 * is mounted, and the section stays away.
 * @param has - a `ctx.get(name) !== undefined` probe of the running context.
 * @returns the absent host-side probes, in declaration order.
 */
export function absentHostServices(has: (name: string) => boolean): PlatformServiceProbe[] {
  return PLATFORM_SERVICE_PROBES.filter(entry => entry.side === 'host' && !has(entry.service))
}
