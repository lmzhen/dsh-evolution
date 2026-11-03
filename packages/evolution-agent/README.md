# @lmzhen/dsh-evolution-agent

分层安装用的 Evolution 预设：新建会话时选 Evolution，只有这个会话带记忆/技能工具。要先装 host；它和 all、preset 互斥，也不是 `dsh plugin add` 直接安装的目标。

## 维护者参考（用户可跳过）

| `--base` | Platform base patch (read verbatim) | Preset id | Row id | Display copy |
|---|---|---|---|---|
| `standard` | `presets/standard.patch.yml` | `evolution` | `preset-evolution` | Evolution |
| `ptc` | `presets/ptc.patch.yml` | `evolution-ptc` | `preset-evolution-ptc` | Evolution PTC |
| `cordis` | `presets/cordis.patch.yml` | `evolution-cordis` | `preset-evolution-cordis` | Evolution Cordis |
| `minimal` | `presets/minimal.patch.yml` | `evolution-minimal` | `preset-evolution-minimal` | Evolution Minimal（unsupported） |

`cordis` 需要 `dynamicCordisRunner`；`minimal` 不支持。
