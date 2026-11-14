# @lmzhen/dsh-evolution-agent-preset

Composition package for legacy Evolution agent preset rows. Its substance is `agent.cordis.yml` and `bases.json`; the JavaScript entry has no runtime API.

0.48 removed the layered/one-click install and preset-generation entry points. This package remains only so an existing 0.47 profile's preset row can still be read and uninstalled for one version; it is not an install target. Only sessions that still select such a legacy preset receive the memory/skill model tools; original platform presets receive no evolution behavior, although the host-level `/evolution` management commands remain visible.

The legacy preset row is mutually exclusive with `all` and another host bundle. This package is not a standalone `dsh plugin add` install target.

## Preset bases

| `--base` | Platform base patch (read verbatim) | Preset id | Row id | Display copy |
|---|---|---|---|---|
| `standard` | `presets/standard.patch.yml` | `evolution` | `preset-evolution` | Evolution |
| `ptc` | `presets/ptc.patch.yml` | `evolution-ptc` | `preset-evolution-ptc` | Evolution PTC |
| `cordis` | `presets/cordis.patch.yml` | `evolution-cordis` | `preset-evolution-cordis` | Evolution Cordis |
| `minimal` | `presets/minimal.patch.yml` | `evolution-minimal` | `preset-evolution-minimal` | Evolution Minimal (unsupported) |

`cordis` requires `dynamicCordisRunner`; `minimal` is unsupported.
