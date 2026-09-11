# @deepseek-ai/dsh-evolution-skill-catalog

Native ctx.skills provider for the evolution-managed skill tree


## Model Experience

### Indirect model surface

#### What the model sees

`@deepseek-ai/dsh-evolution-skill-catalog` registers no direct prompt or tool schema itself. Model-visible effects are owned by the packages that consume this service.

#### Token effect

Zero direct token effect from this package; consumers add any model-visible tokens.

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the assembled prompt or tool list.

## Known Limitations and Deferred Work


- Read-only native `ctx.skills` catalog. Skill mutations still happen through `tool-skill-manage`.
- **Out-of-band edits need a refresh (0.3.18, E-71).** The catalog invalidates on the in-band `evolution/skill-mutated` event (all writes through SkillLibrary). Edits made outside the family — manual file edit, a git pull, another process — bypass that event and cannot be auto-detected (decision C: no filesystem watcher). A root-mtime probe re-stamps the summaries cache when the provider is re-queried after a structural change (directory add/remove/rename), but the probe only runs when the upstream skill registry actually consults this provider — between refreshes the registry's collect cache answers `list`/`snapshot` without calling providers (the real reason E-71's out-of-band skill stays invisible), while `get` of an already-indexed name still reaches the provider, so an out-of-band CONTENT edit of an existing skill shows fresh content there (description stays stale until refresh). Any out-of-band change is only guaranteed to be visible after `/evolution skills refresh` runs (or the process restarts).
- **Upstream-invalid entries are filtered, not published (P1-1, v18).** `SkillLibrary.list()` reports an empty description for a 0-byte/malformed SKILL.md (C-14 keeps it visible to the curator), and a tree entry created before the 0.3.64 name tightening can still carry a trailing/consecutive hyphen. Upstream `validateCandidate` throws on either shape, and that throw aborts the whole `ctx.skills` collection (breaking `agent/pre-step` and the `skill` tool for the session). This provider therefore skips (and warns once about) any candidate whose name is not upstream `SKILL_NAME` or whose description is empty. The entry stays visible to the curator/lifecycle; fix the SKILL.md frontmatter (or the directory name) to publish it.
- **`whenToUse` is published, `metadata` is not (E-11, v18).** A non-empty single-line `whenToUse` from the frontmatter is forwarded to the platform catalog (the upstream filesystem provider does the same, and the host/UI read it for routing hints). `metadata` needs a real YAML parse and stays unpublished by this provider.
- **`content` is the BODY, not the file (V27 G5.3).** The published `SkillDefinition.content` is the SKILL.md text AFTER the frontmatter block, matching the upstream filesystem provider (`skill-filesystem`: `content: parsed.body.trim()`). This provider shadows that provider for the same skills, so publishing the whole file made the model load a different skill depending on which provider served it. A file whose frontmatter block cannot be read keeps its raw text (the entry stays visible; the audit reports the file through `frontmatterCatalogInvalid`).
- **Protection markers are best-effort per entry (A1-17, v18).** When the directory listing AND the per-marker probes fail, `SkillSummary.protectionUnknown` is true and consumers (curator, maintenance) treat the entry as protected rather than unprotected.

