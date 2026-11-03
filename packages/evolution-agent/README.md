# @lmzhen/dsh-evolution-agent

> 分层安装用的 Evolution 预设。

## 你会看到

新建会话时选择 Evolution；只有该会话有记忆/技能工具。

## 什么时候会用到

你只想在部分会话给工具时。

## 默认 / 前提

需要先装 host；与 all/preset 互斥。

## 边界

不是 `dsh plugin add` 的安装目标。

## 维护者参考（用户可跳过）

| `--base` | Platform base patch (read verbatim) | Preset id | Row id | Display copy |
|---|---|---|---|---|
| `standard` | `presets/standard.patch.yml` | `evolution` | `preset-evolution` | Evolution |
| `ptc` | `presets/ptc.patch.yml` | `evolution-ptc` | `preset-evolution-ptc` | Evolution PTC |
| `cordis` | `presets/cordis.patch.yml` | `evolution-cordis` | `preset-evolution-cordis` | Evolution Cordis |
| `minimal` | `presets/minimal.patch.yml` | `evolution-minimal` | `preset-evolution-minimal` | Evolution Minimal（unsupported） |

`cordis` 需要 `dynamicCordisRunner`；`minimal` 不支持。
