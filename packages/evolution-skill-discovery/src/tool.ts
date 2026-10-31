import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SkillSearch, SkillSearchQuery, SkillSearchResponse } from './search.ts'

/** Search dependency supplied by the composition; absent search degrades. */
export interface SkillSearchProvider {
  search(query: SkillSearchQuery, options?: { readonly allowedSkillKeys?: ReadonlySet<string> | undefined }, agent?: Agent | undefined): Promise<SkillSearchResponse>
  /** Optional current-view policy filter; called per tool call. */
  allowedSkillKeys?(agent: Agent | undefined): ReadonlySet<string> | Promise<ReadonlySet<string>> | undefined
}

/** Static model-facing description; no dynamic domain list/tree. */
export const SKILL_SEARCH_DESCRIPTION = 'Search skill summaries by name, description, or whenToUse when coverage is uncertain. Results are summaries, not bodies; a matching name can be loaded directly. Empty results are inconclusive; the full catalog remains available.'

/** @returns response or a degraded hint; never silent empty on failure. */
export async function searchWithDegraded(provider: SkillSearchProvider | undefined, query: SkillSearchQuery, allowedSkillKeys?: ReadonlySet<string> | undefined, agent?: Agent | undefined): Promise<SkillSearchResponse> {
  if (provider === undefined) return { results: [], truncated: false, degraded: true, hint: 'Skill search is unavailable. Use the full catalog or load an exact skill by name with skill(name).' }
  try { return await provider.search(query, allowedSkillKeys === undefined ? undefined : { allowedSkillKeys }, agent) } catch { return { results: [], truncated: false, degraded: true, hint: 'Skill search failed. Use the full catalog or load an exact skill by name with skill(name).' } }
}

function toToolResponse(response: SkillSearchResponse): { results: Array<{ name: string; description: string; whenToUse?: string; matchedBy?: string }>; truncated: boolean; fallback?: boolean; degraded?: boolean; hint?: string } {
  return {
    results: response.results.map(hit => ({
      name: hit.name,
      description: hit.description,
      ...hit.whenToUse === undefined ? {} : { whenToUse: hit.whenToUse },
      ...hit.matchedBy === undefined ? {} : { matchedBy: hit.matchedBy },
    })),
    truncated: response.truncated,
    ...response.fallback === undefined ? {} : { fallback: response.fallback },
    ...response.stale === undefined ? {} : { stale: response.stale },
    ...response.degraded === undefined ? {} : { degraded: response.degraded },
    ...response.hint === undefined ? {} : { hint: response.hint },
  }
}

/**
 * Register skill_search on ctx.tools. The description/schema are static; the
 * provider is the only dynamic dependency.
 * @param ctx - plugin context.
 * @param provider - search service or undefined when unavailable.
 * @returns tool disposer.
 */
export function registerSkillSearchTool(ctx: Context, provider: SkillSearchProvider | undefined): () => void {
  return ctx.tools.register(defineTool({
    name: 'skill_search',
    description: SKILL_SEARCH_DESCRIPTION,
    parameters: {
      query: { type: 'string', required: true, description: 'Search terms; CJK and ASCII are supported.' },
      limit: { type: 'integer', description: 'Maximum results; defaults to 3, capped at 20.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          results: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                description: { type: 'string', required: true },
                whenToUse: { type: 'string' },
                matchedBy: { type: 'string' },
              },
            },
          },
          truncated: { type: 'boolean', required: true },
          fallback: { type: 'boolean' },
          stale: { type: 'boolean' },
          degraded: { type: 'boolean' },
          hint: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.degraded === true
          ? 'Skill search is degraded: ' + (value.hint ?? 'use the full catalog or skill(name).')
          : 'Found ' + value.results.length + ' skill result(s)' + (value.fallback === true ? ' (OR fallback).' : '.') + (value.stale === true ? ' (stale index).' : '') + '\n'
            + value.results.map(result => '- ' + result.name + ': ' + result.description + (result.whenToUse === undefined ? '' : ' | when: ' + result.whenToUse)).join('\n'),
      }],
    },
    async execute(args, exec) {
      const allowed = await provider?.allowedSkillKeys?.(exec.agent)
      return toToolResponse(await searchWithDegraded(provider, { query: args.query, limit: args.limit }, allowed, exec.agent))
    },
  }))
}

/** @returns true only for a search implementation; used by composition wiring. */
export function isSkillSearch(value: unknown): value is SkillSearch {
  return typeof value === 'object' && value !== null && typeof (value as { search?: unknown }).search === 'function'
}
