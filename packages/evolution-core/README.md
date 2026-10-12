# @lmzhen/dsh-evolution-core

自进化家族的核心座位：错误码表（THE error-code table）与各座位共同依赖的基础设施。

> 这份 README 的由来：CI 的门禁 verify-error-codes.mjs <root> 会到每个包目录找 README.md，
> 要求源码错误码与文档表同集、且文档写出区间。本仓此前没有包级 README，CI 那棵树里读到的是
> 上游 pin 的旧文件（码只到 E-304、无区间），门禁便把差异报成「我们漏文档」。

## 错误码

| `E-301` / `E-302` / `E-303` | approval / curator / replay service not mounted | mount the row (they ship with host/all), then run doctor |
| `E-306` | this deployment stages foreground writes, but the named command is not replayable through the skill runner | approve-and-execute it directly, or set `stageForeground: false` deliberately |
| `E-304` | the mounted approval service predates the release capability (a skewed/partial upgrade) | `reject` the pending record instead of `release` |
| `E-305` | the invocation carries no agent (a script/headless caller reached a session-backed branch) | run the command from a session in the GUI or the CLI |
| `E-307` / `E-311` | the settings service is missing or cannot report its sections (`/evolution params`, `/evolution policy set`) | mount the settings row (ships with host/all), then run doctor |
| `E-312` | a parameter id or value was rejected, with the reason included | run `/evolution params` to see the canonical ids |
| `E-308` / `E-313` | unknown parameter group or id | list them: `/evolution params` shows every registered id with its tier and owner |
| `E-314` / `E-315` / `E-316` | the id is a deployment parameter, has no user layer, or its owner is not mounted | write it in `cordis.yml`, or mount the owner row — the message names tier, owner and namespace |
| `E-309` / `E-310` | your write lost a revision race, or the settings service refused it (the reason is included) | re-read with `/evolution params` and retry |
| `E-317` | you declined the confirmation the tool asked before creating or deleting a skill (a foreground create or bare delete asks when `skillWriteConfirm` is `ask` or `timeout`; the default `auto` does not ask at all) | nothing was written; repeat the call if you do want it |
| `E-318` | a write without a read: the session never loaded that skill, so the write is refused (skills only; the foreground operator session is exempt) | load it with the `skill` tool, then repeat the write |
| `E-320` | the profile home is not reported by this host, so the legacy settings document cannot be located | run the command in a session whose profile home is set |
| `E-321` | no evolution-io provider is mounted, so the legacy settings document cannot be read | mount the `evolution-io-node` row |
| `E-322` | a cross-field parameter constraint would be broken (the field, its floor and the attempted value are included) | raise the value to the named floor, or lower the sibling first |
| `E-319` | the confirmation before a create or bare delete went unanswered for `skillWriteConfirmTimeoutSeconds` (`skillWriteConfirm: 'timeout'`), so the write was cancelled | set `skillWriteConfirm` to `auto` (write without asking), keep `ask` (wait until answered), or raise the timeout |
Symptom → next step; the exact text of every code (`E-301`–`E-322`) is stored once in

（本表与 src/errors.ts 的码表必须同集：新增码要同时进表与区间行；verify-error-codes.mjs 双向校验。）
