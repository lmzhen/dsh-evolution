# @deepseek-ai/dsh-evolution-agent-preset

Agent preset exposing memory and skill evolution tools to a session


## Model Experience

### Indirect model surface

#### What the model sees

`@deepseek-ai/dsh-evolution-agent-preset` registers no direct prompt or tool schema itself. Model-visible effects are owned by the packages that consume this service.

#### Token effect

Zero direct token effect from this package; consumers add any model-visible tokens.

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the assembled prompt or tool list.

## Preset variants

`agent.cordis.yml` here is a DELTA: the four evolution model-tool rows and nothing else.
The installed preset is GENERATED at install time by `packages/scripts/install-layered.mjs`
(agent / layered modes), which prepends the RUNTIME platform composition the `--base` names
and writes the result to `$DSH_HOME/.agent-presets/<id>/agent.cordis.yml`. No platform row is
vendored — the preset follows whichever platform the user actually has.

| `--base` | Platform composition (read verbatim) | Installed preset id | Metadata file |
|---|---|---|---|
| `standard` (default) | `<platform>/standard/agent.cordis.yml` | `evolution` | `preset.yml` |
| `ptc` | `<platform>/ptc/agent.cordis.yml` | `evolution-ptc` | `preset.ptc.yml` |

`bases.json` in this package is the single table behind all four columns — the installer
(`AGENT_PRESET_BASES`) and the host command (`/evolution preset install --base <name>`) both
read THIS file, so a base cannot be half-added (a directory one consumer knows about and
another does not) and the two install paths cannot disagree. It also carries `default`. A base whose
runtime composition is absent — an older platform with no `ptc` preset, a preset root that does
not carry it — is REFUSED with a named error; it is never composed from another base. The V10-14
`tool-skill` catalog-cap injection (`injectToolSkillCap`) runs on the composed output
for every base, and the row-collision guard still fails loud when a delta row id appears in the
platform composition.

### PTC base (`--base ptc`)

Composes the platform's `ptc` preset — the standard coding agent with `run_code` as the model's
composition surface — plus this delta, so the family's `memory`, `skill_manage` and
`session_search` entry points reach a PTC session.

Known limitations of this base:

- **Tools are SDK members, not schemas.** PTC presents only `run_code` plus a generated SDK, and
  the model may call `run_code` alone; every family tool is reached as a member inside a code
  program. Prompt text that names a family tool as directly callable is a model-facing wording
  question owned by the persona / tool-description packages, not by this container.
- **A deployment without a code runtime refuses the preset at mount**, naming
  `tool-presentation`; that row and its requirement come from the platform `ptc` preset and are
  not something this variant can soften.
- **Both install paths produce this variant** (0.3.75): `/evolution preset install --base ptc`
  (npm, `evolution-commands`) and `install-layered.mjs --base ptc` (source checkout) read the same
  `bases.json` and write `.agent-presets/evolution-ptc/`. It still only composes a platform that
  actually ships the `ptc` preset; a `standard`-only runtime is refused by name.
- **Tool-use observation under PTC** depends on the family reading dispatches through
  `evolution-core`'s dispatch normalizer rather than matching a platform event vocabulary; a
  consumer that matches `tool/call` directly goes blind in this mode (the arch guard rejects that
  form).

## Known Limitations and Deferred Work


- No known durable consumer gaps at this time. Runtime contracts are covered by package and boundary tests.

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).

