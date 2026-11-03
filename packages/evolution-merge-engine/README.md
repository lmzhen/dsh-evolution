# @lmzhen/dsh-evolution-merge-engine

Pure merge-engine library used by `evolution-merge`. It has no Cordis plugin row, command, panel, or standalone model tool.

## Library surface

The entry exports the vendored `runPipeline`, `runScan`, stage composition and configuration helpers, plus local `screen`, `probe`, `ensureModels`, and report-mapping functions. `screen` can run with a platform model runner for judge stages or with the vendored fallback path. `probe` reports configured model/judge/ranker availability; it is not proof that a real provider completed a merge.

Model directories and registry files are resolved from the configured model root. Missing required models are reported by default; `ensureModels` is the explicit resolution/provisioning path and honors the engine auto-provision and offline settings.

## Screening pipeline freeze

Stages ①–⑤ are specially tuned and frozen. Do not fork their substantive behavior, prompts, scoring, thresholds, or stage semantics in this package. Update the vendored upstream as a unit and require parity; changes outside that frozen pipeline must remain wrapper-only and must not alter screening results.

Vendor documentation, fixtures, golden reports, and generated parity output are upstream/test material, not this package's user documentation.
