/**
 * V41 scope alignment: the ONE place that answers "in whose scope do we ask?".
 *
 * The platform's registry reads are scope-sensitive: `skills.list(options)`
 * documents its `scope` as "the calling agent; OMITTED READS THE GLOBAL LAYER
 * ALONE", and `tools.get(name, scope?)` resolves visibility the same way
 * (packages/skill/skill/src/index.ts:113-120, packages/core/tools/src/index.ts:1194).
 * A preset-mounted family row therefore lives in its PRESET'S STANDING SCOPE,
 * so a scope-less read cannot see it — the asymmetry between "evolution mounted
 * onto the original preset" and "the evolution variant preset".
 *
 * Resolution order (the single verdict; do not re-derive at call sites):
 *   1. the scope the caller already holds (a tool invocation carrying one);
 *   2. this plugin context's own scope — for a preset-mounted row that IS the
 *      preset's standing scope, i.e. exactly where the family's provider lives;
 *   3. undefined, which callers must treat as an EXPLICIT global-layer read
 *      (registered per the arch guard's scope rule), never as a silent default.
 */
import type { Context } from '@deepseek-ai/cordis'
import { scopeOf } from '@deepseek-ai/dsh-scope'

/** The platform's scope identity, kept structural so callers do not need the
 * platform type (`ScopeKey` is `object`). */
export type OpaqueScopeKey = object

export function callingScope(ctx: Context, held?: OpaqueScopeKey): OpaqueScopeKey | undefined {
  if (held !== undefined) return held
  return scopeOf(ctx)
}
