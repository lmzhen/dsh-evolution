#!/usr/bin/env node
/**
 * W10 S1 — child tool-set evidence (A level): on a real 0.2.1 host, create a LOCAL child with
 * `subagents.startActivation({ provider: 'spawn', request: { agentPreset: <restricted> } })`,
 * read the child scope's visible tools while the child is alive, then abort. The judgment is the
 * PLATFORM contract, not a wish: `tools.restrict()` masks INHERITED global tool names; the
 * preset's own scope-local tool rows stay visible (platform tools.restrict() docs: "scoped
 * registrations remain visible"). So the pass condition is
 *   composedPreset === restricted id AND every visible INHERITED global name ∈ allow
 *   AND a non-allowed global name is absent;
 * scope-local preset tools are reported separately, never counted as a leak.
 *
 * This is a HOST probe, not a vitest spec: it is mounted into a disposable isolated host profile:
 *   node packages/scripts/spikes/s1-child-toolset.mjs   (only for the header/env contract)
 *   DSH_HOME=<isolated home> dsh --profile <profile> --patch <patch yml pointing at this file> \
 *     --port <free> --host 127.0.0.1 --no-open
 * The patch yml is a one-liner:
 *   - insert:
 *       - id: s1-child-toolset
 *         name: 'file:///<abs path to this file>'
 *
 * Env (each falls back to the build line used for the v0.27.0 evidence):
 *   S1_CORE_LIB        built evolution-core index (…/evolution-core/lib/index.js)
 *   S1_COMPOSITION_LIB built composition index (…/evolution-core/lib/composition/index.js)
 *   S1_SCOPE_LIB       platform dsh-scope lib (inside the global dsh install's node_modules)
 *   S1_LOG             evidence log path
 * Readings (2026-10-19, real 0.2.1-rc.2 host, isolated DSH_HOME m6): composedPreset=
 * evolution-reviewer-readonly, preset broken=null, restrictor module active, inherited globals
 * visible=[memory] (allow=[memory]), non-allowed globals absent, scope-local preset tools=[subagent].
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const CORE_LIB = process.env.S1_CORE_LIB ?? 'file:///D:/dsh/harness-0.2.1/packages/evolution/evolution-core/lib/index.js'
const COMPOSITION_LIB = process.env.S1_COMPOSITION_LIB ?? 'file:///D:/dsh/harness-0.2.1/packages/evolution/evolution-core/lib/composition/index.js'
const SCOPE_LIB = process.env.S1_SCOPE_LIB ?? 'file:///C:/Users/limengzhen/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-scope/lib/index.js'
const LOG = process.env.S1_LOG ?? 'D:/dsh/tmp/s1-child-toolset.log'
const log = (...parts) => appendFileSync(LOG, parts.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + String.fromCharCode(10))
export const name = 's1-child-toolset'
export function apply(ctx) {
  log('--- S1 child toolset probe boot ' + new Date().toISOString())
  ctx.inject(['agentPresets', 'agents', 'subagents', 'tools', 'appReady'], (child) => {
    child.appReady.onReady(() => setTimeout(() => {
      void (async () => {
        try {
          const core = await import(CORE_LIB)
          const composition = await import(COMPOSITION_LIB)
          const scope = await import(SCOPE_LIB)
          const tools = child.tools
          const globalNames = tools.schemas().map(schema => schema.name).filter(n => n !== 'run_code').sort()
          log('global tool names:', globalNames.join(','))
          const allowName = ['memory', 'skill', 'read', 'write', 'bash', 'pwsh'].find(n => globalNames.includes(n)) ?? globalNames[0]
          log('allow:', allowName)
          const state = await composition.ensureRestrictedPreset(ctx, { kind: 'reviewer', parentPresetId: 'standard', allow: [allowName] })
          log('ensure:', JSON.stringify(state))
          if (state.kind !== 'ready') { log('S1 CHILD TOOLSET RESULT: blocked (ensure ' + state.kind + ')'); return }
          const resolved = await child.agentPresets.resolve(core.REVIEWER_PRESET_ID).catch(error => ({ broken: String(error && error.message) }))
          log('resolve broken:', resolved && resolved.broken === undefined ? 'undefined' : String(resolved && resolved.broken))
          mkdirSync('D:/dsh/tmp/s1-child-cwd', { recursive: true })
          const parentHandle = await child.agents.create({ sessionId: 'session-' + randomUUID(), meta: { cwd: 'D:/dsh/tmp/s1-child-cwd' }, agentOptions: {} })
          const parent = parentHandle.agent
          log('parent agent:', String(parent.id))
          const controller = new AbortController()
          const activation = await child.subagents.startActivation({
            provider: 'spawn',
            label: 's1-child-toolset',
            request: { parent, prompt: [{ type: 'text', text: 'S1 probe: do not run tools' }], agentPreset: core.REVIEWER_PRESET_ID, maxDepth: 1 },
            signal: controller.signal,
            delivery: 'caller',
          })
          log('activation childId:', String(activation.childId))
          let childAgent
          for (let attempt = 0; attempt < 60; attempt += 1) {
            childAgent = child.agents.get(activation.childId)
            if (childAgent !== undefined && child.agentPresets.composedPreset(childAgent.ctx) === core.REVIEWER_PRESET_ID) break
            await new Promise(resolve => setTimeout(resolve, 100))
          }
          let visible = []
          let composed
          let restrictorPresent = false
          if (childAgent !== undefined) {
            composed = child.agentPresets.composedPreset(childAgent.ctx)
            try { visible = tools.schemas(scope.scopeOf(childAgent.ctx)).map(schema => schema.name).filter(n => n !== 'run_code').sort() } catch (error) { log('schemas(scope) failed:', String(error && error.message)) }
            try { restrictorPresent = JSON.stringify(child.agentPresets.inspectCompositions(childAgent.ctx)).includes('restrictor') } catch (error) { log('inspect failed:', String(error && error.message)) }
          }
          const inheritedGlobals = visible.filter(n => globalNames.includes(n))
          const scopeLocal = visible.filter(n => !globalNames.includes(n))
          log('composedPreset:', String(composed))
          log('restrictor module present:', String(restrictorPresent))
          log('visible tools:', visible.join(','))
          log('inherited global tools (must be within allow):', inheritedGlobals.join(','))
          log('scope-local preset tools (exempt by platform contract):', scopeLocal.join(','))
          const inheritedOk = inheritedGlobals.length > 0 && inheritedGlobals.every(n => n === allowName)
          const nonAllowedGlobalHidden = !visible.includes('skill_manage') && !visible.includes('session_search')
          log('S1 CHILD TOOLSET RESULT:', composed === core.REVIEWER_PRESET_ID && inheritedOk && nonAllowedGlobalHidden ? 'pass (A)' : 'fail (A)',
            '| composed=' + String(composed) + ' | allow=' + allowName + ' | inherited=' + inheritedGlobals.join(',') + ' | scopeLocal=' + scopeLocal.join(','))
          controller.abort(new Error('S1 probe aborts after publish'))
          await new Promise(resolve => setTimeout(resolve, 500))
          try { await activation.dispose() } catch (error) { log('activation dispose warn:', String(error && error.message)) }
          try { await parentHandle.dispose() } catch (error) { log('parent dispose warn:', String(error && error.message)) }
        } catch (error) { log('S1 ERROR:', error && error.stack ? String(error.stack).slice(0, 1400) : String(error)) }
      })()
    }, 3500))
  })
}
