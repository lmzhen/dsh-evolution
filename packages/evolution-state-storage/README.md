# @lmzhen/dsh-evolution-state-storage

Provider registry and shared contract for durable evolution state. It does not choose a storage medium or write the state itself.

## What it owns

- Registration and lookup of the shipped `json` and `domain` providers.
- Review, curator, and pending-record contracts, including claim/resolve/release transitions.
- Retention rules and a published provider-conformance suite for alternative implementations.

The resolved pending-record cap is 200. Pending and executing records are not trimmed by that cap, and capability approvals are exempt from resolved-record eviction. Review cadence state is capped at 500 sessions. The JSON provider archives evicted resolved records; the domain provider has no equivalent JSON archive sidecar.

## Deployment boundary

Storage location depends on the selected provider. JSON state normally lives below the evolution home; a domain deployment can use another configured medium, including a remote backend. Do not assume every provider stores data in `$DSH_HOME`.

Consumers normally mount [evolution-state](../evolution-state/README.md), which delegates to this registry. There is no direct command, panel, or model tool here.
