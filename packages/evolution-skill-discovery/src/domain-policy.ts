/** One policy layer; only these fields are user-editable. */
export type DomainPolicyMode = 'off' | 'auto' | 'on'

export interface DomainPolicyLayer {
  readonly mode?: DomainPolicyMode | undefined
  readonly pinDomains?: readonly string[] | undefined
  readonly disableDomains?: readonly string[] | undefined
  readonly revision?: string | undefined
}

/** Effective policy consumed by projection; never written back to DomainMap. */
export interface EffectiveDomainPolicy {
  readonly mode: DomainPolicyMode
  readonly pinned: ReadonlySet<string>
  readonly disabled: ReadonlySet<string>
  readonly degraded: readonly string[]
  readonly globalRevision?: string | undefined
  readonly workspaceRevision?: string | undefined
  readonly scopeRevision?: string | undefined
}

/** Invalid policy layer (e.g. attempts to edit taxonomy). */
export class DomainPolicyValidationError extends Error {
  readonly code = 'domain-policy-invalid'
  constructor(message: string) { super(message); this.name = 'DomainPolicyValidationError' }
}

const ALLOWED = new Set(['mode', 'pinDomains', 'disableDomains', 'revision'])
const MODES = new Set<DomainPolicyMode>(['off', 'auto', 'on'])

function checkLayer(layer: DomainPolicyLayer): void {
  for (const key of Object.keys(layer)) if (!ALLOWED.has(key)) throw new DomainPolicyValidationError('unsupported policy field ' + key)
  if (layer.mode !== undefined && !MODES.has(layer.mode)) throw new DomainPolicyValidationError('unsupported policy mode')
}

function knownOnly(values: readonly string[] | undefined, known: ReadonlySet<string> | undefined, degraded: Set<string>): Set<string> {
  const result = new Set<string>()
  for (const value of values ?? []) {
    if (known !== undefined && !known.has(value)) { degraded.add(value); continue }
    result.add(value)
  }
  return result
}

/**
 * Merge global -> workspace -> scope policy. Disable wins over pin; unknown
 * domains are ignored and reported as degraded.
 * @param global - mandatory global layer.
 * @param workspace - optional workspace overlay.
 * @param scope - optional scope overlay.
 * @param knownDomainIds - optional known ids for validation.
 * @returns immutable effective policy.
 */
export function mergeDomainPolicy(
  global: DomainPolicyLayer,
  workspace?: DomainPolicyLayer,
  scope?: DomainPolicyLayer,
  knownDomainIds?: ReadonlySet<string>,
): EffectiveDomainPolicy {
  checkLayer(global); if (workspace) checkLayer(workspace); if (scope) checkLayer(scope)
  const degraded = new Set<string>()
  const blocked = new Set([...knownOnly(global.disableDomains, knownDomainIds, degraded), ...knownOnly(workspace?.disableDomains, knownDomainIds, degraded), ...knownOnly(scope?.disableDomains, knownDomainIds, degraded)])
  const pinned = new Set([...knownOnly(global.pinDomains, knownDomainIds, degraded), ...knownOnly(workspace?.pinDomains, knownDomainIds, degraded), ...knownOnly(scope?.pinDomains, knownDomainIds, degraded)])
  for (const id of blocked) pinned.delete(id)
  return {
    mode: scope?.mode ?? workspace?.mode ?? global.mode ?? 'off',
    pinned,
    disabled: blocked,
    degraded: [...degraded].sort(),
    globalRevision: global.revision,
    workspaceRevision: workspace?.revision,
    scopeRevision: scope?.revision,
  }
}
