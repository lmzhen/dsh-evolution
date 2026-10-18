// The restricted-preset lifecycle: one registration per kind, keyed by (parentPresetId, allow).
// Registration is LAZY (first run) and single-flight; the release lives on the calling fiber's
// effect so an HMR reload cannot leave a stale preset registered.
import type { Context } from '@deepseek-ai/cordis'
import { normalizeAllow } from './preset-ids.ts'
import {
  composeRestrictedPresetDefinition,
  type PresetRegistryLike,
  type RestrictedPresetRequest,
  type RestrictedPresetState,
} from './restricted-preset.ts'

interface RestrictedSlot {
  readyKey?: string | undefined
  state?: RestrictedPresetState | undefined
  release?: (() => Promise<void>) | undefined
  inflight?: Promise<RestrictedPresetState> | undefined
  effectInstalled?: boolean | undefined
}

const SLOTS = new WeakMap<Context, Map<string, RestrictedSlot>>()

function slotFor(ctx: Context, kind: RestrictedPresetRequest['kind']): RestrictedSlot {
  let byKind = SLOTS.get(ctx)
  if (byKind === undefined) { byKind = new Map(); SLOTS.set(ctx, byKind) }
  let slot = byKind.get(kind)
  if (slot === undefined) { slot = {}; byKind.set(kind, slot) }
  return slot
}

function registryOf(ctx: Context): PresetRegistryLike | undefined {
  const candidate = (ctx as unknown as { get(name: string): unknown }).get('agentPresets') as Partial<PresetRegistryLike> | undefined
  if (candidate === undefined) return undefined
  if (typeof candidate.readDocument !== 'function' || typeof candidate.register !== 'function') return undefined
  return candidate as PresetRegistryLike
}

function installReleaseEffect(ctx: Context, slot: RestrictedSlot): void {
  if (slot.effectInstalled === true) return
  const effect = (ctx as unknown as { effect?: (run: () => () => void, label?: string) => unknown }).effect
  if (effect === undefined) return
  slot.effectInstalled = true
  effect.call(ctx, () => () => { void releaseRestrictedPreset(ctx, undefined, slot) }, 'evolution-restricted-preset')
}

async function releaseRestrictedPreset(ctx: Context, kind: RestrictedPresetRequest['kind'] | undefined, explicitSlot?: RestrictedSlot): Promise<void> {
  const slot = explicitSlot ?? (kind === undefined ? undefined : slotFor(ctx, kind))
  if (slot === undefined) return
  const release = slot.release
  slot.release = undefined
  slot.readyKey = undefined
  slot.state = undefined
  if (release !== undefined) await release()
}

export interface EnsureRestrictedPresetArgs extends RestrictedPresetRequest {}

export async function ensureRestrictedPreset(ctx: Context, req: EnsureRestrictedPresetArgs): Promise<RestrictedPresetState> {
  const allow = normalizeAllow(req.allow)
  const key = req.parentPresetId + '\n' + allow.join('\n')
  const slot = slotFor(ctx, req.kind)
  if (slot.readyKey === key && slot.state !== undefined && slot.state.kind === 'ready') return slot.state
  if (slot.inflight !== undefined) return slot.inflight
  slot.inflight = (async (): Promise<RestrictedPresetState> => {
    await releaseRestrictedPreset(ctx, req.kind, slot)
    if (allow.length === 0) {
      slot.state = { kind: 'failed', code: 'E-324', reason: 'allow set is empty' }
      return slot.state
    }
    const registry = registryOf(ctx)
    if (registry === undefined) {
      slot.state = { kind: 'failed', code: 'E-324', reason: 'agentPresets service unavailable or incomplete' }
      return slot.state
    }
    try {
      const document = await registry.readDocument(req.parentPresetId)
      const definition = composeRestrictedPresetDefinition(document, { kind: req.kind, parentPresetId: req.parentPresetId, allow })
      const release = await registry.register(definition)
      slot.release = release
      slot.readyKey = key
      slot.state = { kind: 'ready', presetId: definition.id, parentPresetId: req.parentPresetId, allow }
      installReleaseEffect(ctx, slot)
      return slot.state
    } catch (error) {
      slot.readyKey = undefined
      slot.state = { kind: 'failed', code: 'E-324', reason: error instanceof Error ? error.message : String(error) }
      return slot.state
    }
  })()
  try {
    return await slot.inflight
  } finally {
    slot.inflight = undefined
  }
}

/** Read-only view of the current registration (doctor runtime row). */
export function restrictedPresetState(ctx: Context, kind: RestrictedPresetRequest['kind']): RestrictedPresetState | undefined {
  return SLOTS.get(ctx)?.get(kind)?.state
}

/** Release the registration for one kind (HMR/tests); the fiber effect also calls this. */
export async function disposeRestrictedPreset(ctx: Context, kind: RestrictedPresetRequest['kind']): Promise<void> {
  await releaseRestrictedPreset(ctx, kind)
}
