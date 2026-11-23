# 0.60.0 发布阻断：CI Linux 单测集合 SyntaxError

## 事实

- tag `v0.60.0` 已推送后 CI 失败，**npm publish 未执行**；tag 已删除（本地与远端），没有产生任何发布产物。
- 失败 job：`validate (released upstream)`、`validate (released upstream, node 22)`、`cohort validate (0.2.2-rc.5)`。
- 失败形态：`run-gates ci --lane ci-unit` 中 346 个 suite 以 `SyntaxError: Invalid or unexpected token` 失败，另有 1 个 guard-scripts 子测试失败；本地 Linux 不可用，Windows Node 22 `FAMILY_TIER=full CI=1` 跑 519 files / 3111 tests 只有 2 个 Windows 环境相关失败，无 SyntaxError。
- 已用隔离提交排除：removed generated ports、removed working-directory port、restored old line registry；三次 main CI 仍失败。当前 main 已恢复 0.60.0 候选（commit `3c363c70`）。

## 判断

这是 CI 环境特有的模块加载/解析问题，不是本地全量套件失败；在找到并修复前不能发布。

## 下一步

1. 从 CI 原始日志/复现环境拿到 SyntaxError 的加载文件（当前 `gh --log` 只给无栈错误）；
2. 在 Linux Node 22 复现（Docker）后修根因；
3. 修复后重跑 CI static/unit、全量测试、重打 dist、重新确认 tag；
4. 不把本次失败 tag 当作发布；npm 未发布。

## 当前状态

- 本地最终候选：HEAD `3c363c70`（0.60.0，20 包，rehearsal 绑定 `c11f59df`/dist hash `200514...7cf7`）；
- 本地 gates：local 61/0/3、ci-static 60/0/1、全量 448/2457（版本 bump 前的最终代码）；
- tag：无；npm：无。
