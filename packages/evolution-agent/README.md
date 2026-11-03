# @lmzhen/dsh-evolution-agent

> Evolution agent 预设的内容包（不是 bundle）。

## 它做什么

提供 5 行预设 delta 和 4 个基底表（standard/ptc/cordis/minimal）；由 /evolution preset install 或 install-layered 写入 profile patch。

## 入口

/evolution preset install [--base …]；install-layered --mode layered/agent。

## 依赖与默认

需要 host 或 agent-preset 包提供模型行；不是 dsh.bundle，plugin add 不会挂它。

## 边界

cordis 需要 dynamicCordisRunner；minimal unsupported（平台 minimal 没有 tool-skill 行）；与 all/preset 互斥。

## 代码位置

`agent.cordis.yml, bases.json`

## Preset variants

| `--base` | Platform base patch (read verbatim) | Preset id | Row id | Display copy |
|---|---|---|---|---|
| `standard` | `presets/standard.patch.yml` | `evolution` | `preset-evolution` | Evolution |
| `ptc` | `presets/ptc.patch.yml` | `evolution-ptc` | `preset-evolution-ptc` | Evolution PTC |
| `cordis` | `presets/cordis.patch.yml` | `evolution-cordis` | `preset-evolution-cordis` | Evolution Cordis |
| `minimal` | `presets/minimal.patch.yml` | `evolution-minimal` | `preset-evolution-minimal` | Evolution Minimal（unsupported） |

`cordis` 需要 `dynamicCordisRunner`；`minimal` 没有平台 tool-skill 行，不支持。
