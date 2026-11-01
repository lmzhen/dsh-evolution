import { mergeDomainPolicy, type DomainPolicyLayer, type EffectiveDomainPolicy } from './domain-policy.ts'
import { policyDigestOf } from './identity.ts'

/** Inputs for one policy resolution. */
export interface PolicyStoreInput {
  readonly global: DomainPolicyLayer
  readonly workspace?: DomainPolicyLayer | undefined
  readonly scope?: DomainPolicyLayer | undefined
  readonly knownDomainIds?: ReadonlySet<string> | undefined
}

/** Resolves global/workspace/scope policy without touching DomainMap or mapVersion. */
export class DomainPolicyStore {
  private readonly input: PolicyStoreInput

  constructor(input: PolicyStoreInput) { this.input = input }

  /**
   * @param knownDomainIds - optional live id set; overrides the construction-time set.
   * @returns effective policy with unknown ids reported as degraded.
   */
  resolve(knownDomainIds: ReadonlySet<string> | undefined = this.input.knownDomainIds): EffectiveDomainPolicy {
    return mergeDomainPolicy(this.input.global, this.input.workspace, this.input.scope, knownDomainIds)
  }

  /**
   * @param knownDomainIds - optional live id set used for the effective policy.
   * @returns stable digest of effective policy and all layer revisions.
   */
  digest(knownDomainIds: ReadonlySet<string> | undefined = this.input.knownDomainIds): string {
    const policy = this.resolve(knownDomainIds)
    return policyDigestOf({
      globalPolicyRevision: policy.globalRevision ?? '0',
      ...policy.workspaceRevision === undefined ? {} : { workspaceOverlayRevision: policy.workspaceRevision },
      ...policy.scopeRevision === undefined ? {} : { scopeOverlayRevision: policy.scopeRevision },
      effectivePolicy: policy,
    })
  }
}
