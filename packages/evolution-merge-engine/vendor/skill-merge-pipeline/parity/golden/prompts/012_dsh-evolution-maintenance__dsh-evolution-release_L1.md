{
  "level": "L1",
  "skill_a": {
    "id": "dsh-evolution-maintenance",
    "description": "维护家族插件：发布/CI、客户端、门禁、审计与复核报告、参数、宿主重启。",
    "head": "维护家族插件：发布/CI、客户端、门禁、审计与复核报告、参数、宿主重启。\n\n# dsh-evolution 项目维护\n\n`@lmzhen/dsh-evolution-*`：把 Hermes 自进化核心（记忆/技能/审查/策展）移植到 DeepSeek Harness 的插件家族。**单线开发在镜像**（改码/提交/打 tag 全在镜像；扁平布局）。`D:\\dsh\\deepseek-harness\\packages\\evolution\\` 是**更早的上游线**（不含家族代码，同路径文件与镜像不同）——不在其中改码，也不让 `publish-chain` 跑 step 1（它会 robocopy 该树覆盖镜像）。**新版本用 `--no-sync`**（跳过 step 1，仍做 normalize＋版本守卫＋commit/tag/push）；**`--resume` 只用于\"远端 tag 已存在\"的续跑**——它会先校验 tag→commit 等于本机 HEAD，新版本用它会直接以 `tag v<ver> not found remotely — nothing to resume` 退出。判断口径：tag 已推过 ⇒ `--resume`；还没推 ⇒ `--no-sync`。发布仓库是 `github.com/lmzhen/dsh-evolution`（扁平布局，本地克隆 `D:\\dsh\\dsh-evolution-mirror`）。原版 Hermes 参考在 `D:\\claw\\hermes-agent`。\n\n> 详见 references/governance-discipline.md\n> P1 的三张成本账（E4/E16/E12/E15）与家族测试床唯一入口：references/p1-ledgers-and-testbed-entry.md\n> 功能域地图（对外解释／专利取点／域内论文筛选先读）：references/functional-domain-map.md\n> 评审通道的平台事实（llm.complete 参数面/消息形状/前缀缓存实测/钩子取参）：references/review-channel-platform-facts.md\n> 本节引用：references/client-plugin-ui-seams.md · references/dispatch-vocabulary-and-cadence.md · references/docs-refresh.md · references/gate-rules-and-client-test-lane.md · references/growth-invariance-and-read-counts.md · references/hermes-upstream-comparison.md · references/live-acceptance-playbook.md · references/live-host-health-check.md · references/new-package-and-row-registration.md · references/platform-report-v44.md · references/plugin-extension-seams.md · references/rc4-release-runbook.md …\n\n## 计数器清零的边界：把\"进入下游\"与\"完成\"分开（2026-10-16）\n**机制**：一次运行其实有两个可判定的阶段——『**这次运行本身成功了没有**』与『**这次运行占用的周期用掉了没有**』。绑成同一个边界，两者就只能同生共死。\n**修法（两级边界，各自可观测）**：\n**验证**：断言里为**每个边界各写一条**（推进 / 不推进 / 第三种状态），并额外断言\"失败不改游标\"——只测成功路径等于没测这套设计。\n2. **删除会暴露「存在理由已消失」的代码**：判断某函数是否该迁走，先问**它为什么存在**。本轮两个大函数（37 行的『替无工具 worker 采集事实』、以及派发失败兜底）都是**旧通道特有**的——换通道后它们的**存在前提消失**，正确处置是删除，**不是搬过去再为新通道造等价兜底**（那就是补丁嵌套）。\n4. **删掉的边界断言要「重述」而不是「删除」**：一条断言往往同时编码了（可能已废弃的）设计与（仍然成立的）不变量。旧设计死了，就把断言**移到不变量现在所在的那一侧**——本轮 3 条断言因此变成『校验迁移本身』的断言。删掉它们等于静默失去那条不变量。"
  },
  "skill_b": {
    "id": "dsh-evolution-release",
    "description": "Cut a family release and triage its CI failures.",
    "head": "Cut a family release and triage its CI failures.\n\n# Family Release and CI Triage\n\nHow the evolution family gets from a mirror commit to three (or more) npm packages, and how to read a red\nrelease run without guessing. It does not cover authoring gates (`dsh-evolution-gates`) or proving them\n(`gate-mutation-probing`).\n\n- 要切发布（打 tag）、要定下一个版本号、或 CI 在某个 tag 上红了。\n- 想知道「这次失败是我的代码、还是环境的、还是工具自己的」。\n\n- `RELEASE_VERSION` 的来源是 **tag 名本身**（工作流用 `github.ref_name`）；非 tag 推送用不可发布的占位版本。⇒ **抬版本＝打什么 tag**，本地不用改版本号。\n- publish 作业挂在 `environment: npm-publish` 上 ⇒ 打 tag **不会**自动发布，需要环境审批 ⇒ **打 tag 是安全动作**。\n- Windows 下 npm 要用 **`npm.cmd`**（`npm.ps1` 被执行策略拒载）——**只对 PS 5.1 成立**；DSH 的 `pwsh` 工具自 2026-10-15 起是 7.6.7／RemoteSigned，实测裸 `npm --version` 可用。\n\n| 事项 | 事实（读码确认） |\n| --- | --- |\n| 版本来源 | tag 名；本地版本号不参与 |\n| dist-tag | 版本含 `-` ⇒ `next`；稳定版 ⇒ `latest`；裸 `--tag` 会报错而非静默回退 |\n| 发布集 | **当次暂存清单里的包**，不是固定的三个名字 ⇒ 第⑤步按清单逐个比对，不要假定名字 |\n| 幂等 | 逐包比对远端同版本的 `dist.integrity`：一致则跳过，不一致则拒绝覆盖 |\n| 发布前审计 | 每个 tarball 必须是家族作用域名、版本等于 `--version`、内部依赖写成 `^版本`、平台依赖等于 `--platform-range`、不含旧私有作用域字样、不夹带 `.tarball`、且至少一个声明浏览器半边 |\n| CI 结构 | 两个作业（`validate (released upstream)` 与装机作业）**都是 publish 的硬前置**；装机验在 CI 里对**打包产物**做一次，发布之后再对 registry 上的包复核一次 |\n\n1. **切 tag 前**：工作树干净、HEAD 是预期的收口提交、本地四件判据全绿、`v<x.y.z>` 之前没有同名 tag、版本 **大于** registry 上已有的最高版（铁律：已发布只能抬版本）。\n2. **打 tag 并推**：`git tag vX.Y.Z` ＋ `git push origin vX.Y.Z`。\n3. **盯运行**：`gh run watch <id> --interval 20` 阻塞到结束（比逐轮轮询省事）；`gh run view <id> --json status,conclusion,jobs` 做轻量检查。\n4. **红了先定位到「动作」而不是「作业」**：`gh run view --job <id> --json jobs` 拿失败步骤，再在日志里 grep `outcome=failure` 找到形如 `__self.__run_N` 的**动作 id**，最后 grep 该 id 的 `start-action` 行拿到它的**显示名**（例如「Build, test and lint」）⇒ 才知道该往哪看。\n5. **读日志读该动作窗口的结尾**，不要读整个 job 的尾部（尾部是 Post/清理记账行，会把你带偏）。\n6. **CI 绿过两个作业后**：批准 publish（环境审批）⇒ 按暂存清单逐个比对 `npm view <name> version` 与本次版本一致 ⇒ 装机复核（`channel=installed` 加指纹探针）。\n7. **一次改完再切下一个 tag**：一次 CI 周期约七分钟，分批切 tag 试错是最贵的做法。\n\nrelease run without guessing. It does not cover authoring gates (`dsh-evolution-gates`) or proving them\n本文件旁的 `references/ci-instrument-boundaries.md` 记着四条仪器边界（lint 噪声／家族 spec／构建／\"产物在不在那棵树\"）、三种站点类别的读法、`gh` 取证据的姿势，以及几条被实测推翻的结论。\n**修法**：不要用本机输出去证明或推翻它；把修法做成**构造性正确**（例如\"这个字符串不再是那个启发式会匹配的形状\"），理由写进提交信息与文档，让 CI 做复核。\n**边界**：只对**从未发布过**的版本这么做。**已经出现在 npm 上的版本只能抬**（发布字节不可追认）；`dist-tags latest` 指向过的版本同样按\"已发布\"处理。\n**修法**：以 **CI 的站点清单**为权威逐处读声明类型再改；本地`no-unsafe-*` 只用来找\"我这台机器解"
  },
  "scores": {
    "jaccard_summary": 0.0968,
    "jaccard_body": 0.1197,
    "body_cosine": 0.9585,
    "summary_cosine": 0.5014
  },
  "note": "这是两份技能的能力宣言段与触发条件；仍不足请回 0。",
  "schema": {
    "verdict": "1 | 0 | -1",
    "reason": "<one sentence, in Chinese>",
    "evidence": [
      {
        "path": "<file>",
        "line": "<n or -1>",
        "quote": "<short quote>"
      }
    ]
  }
}