# Evolution plugin family

Hermes-style self-evolution for DeepSeek Harness, implemented as composable
Cordis plugins. The model may only propose and write **memory** and **skills**;
policy, prompts, routing, state, and audit history are control-plane data.

## Package map

| Package | Role |
|---|---|
| `dsh-evolution` | Legacy one-row facade + shared stores/prompts/signals (compatibility) |
| `evolution-io` / `evolution-io-node` | File-tree IO seam registry + atomic node:fs provider |
| `memory` / `memory-files` / `tool-memory` | Memory seam: registry, provider, model tool |
| `skill-usage` / `tool-skill-manage` / `evolution-skill-catalog` | Usage telemetry + `skill_manage` + native `ctx.skills` provider |
| `evolution-policy` | Immutable policy snapshot + native `tools.guard` denials |
| `evolution-plan-validator` | Deterministic validation for model-produced plans |
| `evolution-state-storage` / `-domain` / `-json` / `evolution-state` | State seam: provider registry, storage-domain KV, JSON fallback, consumer |
| `evolution-approval` | Hermes-style staged/pending writes over `evolutionState` |
| `evolution-threat` | `tools/pre-execute` content threat guard |
| `evolution-review` | Signal gate → one-shot subagent → validated plan execution |
| `evolution-curator` | Deterministic lifecycle + LLM nomination + run reports + min-idle gate |
| `evolution-activity` | Session projection over `evolution/plan-applied` |
| `evolution-feedback` | Durable feedback → `quality_score`/`quality_warn` → curator |
| `evolution-learning-graph` | Graph command over skills + memory |
| `evolution-replay` | A/B replay scoring + session-event driver |
| `evolution-commands` | `/evolution pending|approve|reject|curator run|curator report|restore` |
| `evolution-host` | Host-plane infrastructure bundle (no model tools) |
| `evolution-agent` | Agent preset: standard tools + `memory`/`skill_manage` model entry |
| `evolution-preset` | Compatibility one-click bundle (`cordis.yml` standalone, `cordis.patch.yml` overlay) |

## Installation

See [INSTALL.md](./INSTALL.md) for the layered host/agent flow, the one-click
compatibility flow, and profile override examples.

## Composition

### Layered install (recommended)

Install the host bundle into the profile:

```yaml
- id: dsh-evolution-host
  name: '@deepseek-ai/dsh-evolution-host'
```

Then select the `Evolution` agent preset for sessions that should expose the
`memory` / `skill_manage` tools. Sessions on other presets keep the shared
automation (review, curator, approval, observability) without model-facing
evolution tools.

### One-click compatibility install

Use the legacy preset overlay on a standard DSH host:

```yaml
- id: dsh-evolution
  name: '@deepseek-ai/dsh-evolution-preset'
```

Or compose manually — order matters because provider rows declare `inject`:

```yaml
- id: evolution-policy
  name: '@deepseek-ai/dsh-evolution-policy'
- id: evolution-io
  name: '@deepseek-ai/dsh-evolution-io'
- id: evolution-io-node
  name: '@deepseek-ai/dsh-evolution-io-node'
- id: evolution-state-storage
  name: '@deepseek-ai/dsh-evolution-state-storage'
- id: evolution-state-domain
  name: '@deepseek-ai/dsh-evolution-state-domain'
- id: evolution-state-json
  name: '@deepseek-ai/dsh-evolution-state-json'
- id: evolution-state
  name: '@deepseek-ai/dsh-evolution-state'
- id: memory
  name: '@deepseek-ai/dsh-memory'
- id: memory-files
  name: '@deepseek-ai/dsh-memory-files'
- id: tool-memory
  name: '@deepseek-ai/dsh-tool-memory'
- id: skill-usage
  name: '@deepseek-ai/dsh-skill-usage'
- id: tool-skill-manage
  name: '@deepseek-ai/dsh-tool-skill-manage'
- id: evolution-approval
  name: '@deepseek-ai/dsh-evolution-approval'
  config:
    enabled: false
    stageForeground: true
- id: evolution-threat
  name: '@deepseek-ai/dsh-evolution-threat'
- id: evolution-review
  name: '@deepseek-ai/dsh-evolution-review'
- id: evolution-curator
  name: '@deepseek-ai/dsh-evolution-curator'
- id: evolution-commands
  name: '@deepseek-ai/dsh-evolution-commands'
- id: evolution-activity
  name: '@deepseek-ai/dsh-evolution-activity'
- id: evolution-feedback
  name: '@deepseek-ai/dsh-evolution-feedback'
- id: evolution-learning-graph
  name: '@deepseek-ai/dsh-evolution-learning-graph'
- id: evolution-replay
  name: '@deepseek-ai/dsh-evolution-replay'
```

## Control-plane invariants

1. Model writes only `memory` and `skills`; policy/prompts/routing/state are
   never model-writable. `evolution-policy` installs a monotonic
   `ctx.tools.guard` and `evolution-plan-validator` rejects forbidden fields.
2. Every mutation is gated by `tools/pre-execute` threat scan and, when
   enabled, the staged approval service. Approved writes replay through the
   exact runner they were registered with.
3. Skill destruction is never a hard delete: archival moves to `.archive/`,
   and every curator run snapshots the full skill tree first.
4. Review plans require event-sequence evidence bounded by the session seq;
   invalid ops are dropped while valid ops still apply.
5. Provider seams (`ctx.evolutionIo`, `ctx.evolutionStateStorage`) keep media
   decisions out of policy code; native packages perform no node:fs IO of
   their own.
