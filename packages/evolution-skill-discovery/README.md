# @lmzhen/dsh-evolution-skill-discovery

Optional skill search, domain projection, and catalog-trimming package. The main entry is `main-entry.ts`, not the package root helper modules.

## Default and independent search

`mode` defaults to `off`. Domain cards, domain-map projection, and catalog trimming do not run in this mode.

`skill_search` is independently registered unless `searchEnabled:false`. It searches name, description, and `whenToUse` summaries, not skill bodies. Results default to 3 and are capped at 20. Empty or degraded results include a hint to use the full catalog or load an exact skill by name.

`featureEpoch` is required even when discovery is off. The composition also requires the declared platform services, including `skills`, `workingDirectory`, `tools`, `evolutionIo`, and `systemPrompt`.

## Enabling domain mode

`mode:on` requires an LLM service. Generation defaults to provider `deepseek-official` and model `deepseek-flash`; `generationTimeoutMs`, `generationMaxTokens`, and `generationAttempts` tune that port.

Domain state defaults to these files below the evolution home:

- `evolution/domain-map.json` (`domainMapPath`)
- `evolution/projection-journal.json` (`projectionJournalPath`)
- `evolution/view-snapshots.json` (`viewSnapshotPath`)

`maxCards`, `tokenBudget`, `staleAfterHours`, and `descriptionStaleAfterHours` control projection and refresh budgets. Description refresh defaults to 168 hours. `pinDomains`, `disableDomains`, `workspacePolicy`, `scopePolicy`, and their path-based layers control the effective domain policy.

## Commands and failure boundaries

With domain mode on, `/skill-domain status` inspects the current view and `/skill-domain generate` builds a domain map. Generation also requires `mapReferenceCwd`; the command refuses to infer a global map from the caller view. `mapReferenceScope` optionally overrides the reference scope.

Projection failures fail open to the original decision so discovery does not hide the ordinary catalog. Search/index degradation is reported explicitly rather than returned as a silent empty result.
