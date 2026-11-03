# @lmzhen/dsh-evolution-agent-preset

Composition package for the layered Evolution agent preset. Its substance is `agent.cordis.yml` and `bases.json`; the JavaScript entry has no runtime API.

Install `evolution-host` first, then generate the preset with `/evolution preset install`. Only sessions that select an Evolution preset receive the memory/skill model tools. Original platform presets receive no evolution behavior, although the host-level `/evolution` management commands remain visible.

The layered preset is mutually exclusive with `all`, `preset`, and another host bundle. This package is not a standalone `dsh plugin add` install target.

## Preset bases

| `--base` | Platform base patch (read verbatim) | Preset id | Row id | Display copy |
|---|---|---|---|---|
| `standard` | `presets/standard.patch.yml` | `evolution` | `preset-evolution` | Evolution |
| `ptc` | `presets/ptc.patch.yml` | `evolution-ptc` | `preset-evolution-ptc` | Evolution PTC |
| `cordis` | `presets/cordis.patch.yml` | `evolution-cordis` | `preset-evolution-cordis` | Evolution Cordis |
| `minimal` | `presets/minimal.patch.yml` | `evolution-minimal` | `preset-evolution-minimal` | Evolution Minimal (unsupported) |

`cordis` requires `dynamicCordisRunner`; `minimal` is unsupported.
