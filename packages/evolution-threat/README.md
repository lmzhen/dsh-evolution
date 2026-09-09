# @deepseek-ai/dsh-evolution-threat

Write-time threat guard for evolution tools

## Model Experience

### Indirect model surface

#### What the model sees

`@deepseek-ai/dsh-evolution-threat` registers no direct prompt or tool schema itself. Model-visible effects are owned by the packages that consume this service.

#### Token effect

Zero direct token effect from this package; consumers add any model-visible tokens.

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the assembled prompt or tool list.

## Config

- `maxScanChars` (default 65536): the scan window size in normalized characters.
  Legal range is `>= 4097` — a smaller window cannot guarantee full-coverage
  scanning (the overlap floor is `PATTERN_OVERLAP + 1` in evolution-core), so
  the schema rejects it at load and the assembly clamp falls back to the
  default. The whole text is always scanned in overlapping windows; this value
  is not a total cap.

- `threatExemptLabels` (default `[]`): pattern labels the deployment knows to
  be benign. P2-4 (v14) closed the store-vs-guard asymmetry for the STORE
  gates (`SkillLibrary`/`MemoryStore` options) — but the exemption surface is
  per config site: this guard row, the tool-skill-manage row, the
  evolution-commands row (its own SkillLibrary for the command write paths),
  and the memory store options each carry their OWN list and must be set
  separately. A label exempted only on the store side still blocks here.
  (v17 audit: the evolution-commands site was missing from this enumeration.)

## Known Limitations and Deferred Work


- No known durable consumer gaps at this time. Runtime contracts are covered by package and boundary tests.
