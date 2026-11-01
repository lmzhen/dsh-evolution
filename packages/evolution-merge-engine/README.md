# @deepseek-ai/dsh-evolution-merge-engine

Vendored skill-merge Node pipeline engine used by `@deepseek-ai/dsh-evolution-merge`.
The package is a pinned, byte-identical copy of the upstream engine; it is not a
public product surface.

- Version: 0.30.15
- Upstream: `skill-merge` pipeline engine
- License: MIT (see LICENSE/NOTICE when present)

**Screening pipeline freeze:** stages ①–⑤ are specially tuned. Their substantive flow — stage order, inputs/outputs, models, weights, thresholds, filters, scoring and decisions, including any selection policy that changes candidate sets or ordering — must not be modified. Packaging, loading, adapters, error boundaries, diagnostics, IO and tests may change only with parity evidence proving identical candidate sets, order, scores and decisions.

Do not fork the screening pipeline in place. If the pinned upstream must be replaced, re-run the merge parity checks and prove identical screening output before release. Non-screening packaging may be restructured without changing the pipeline.
