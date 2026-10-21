{
  "level": "L1",
  "skill_a": {
    "id": "capability-claim-audit",
    "description": "Check a tool's capability claims against its source.",
    "head": "Check a tool's capability claims against its source.\n\n# Capability Claim Audit\n\nJudge whether an open-source project really implements a claimed behaviour — from its source and its **defaults**, not from its README — and then classify every candidate by how it would actually be used. It does NOT run the candidates, and it does not measure their quality; it decides *presence, wiring, and default state*. A verdict is only as good as the code actually read, so this is a reading discipline first, a ranking exercise second.\n\n**参数被接受 ≠ 被使用（2026-10-16，同一会话内四次自我推翻）**：审『平台是否支持 X』时，最硬的证据不是文档、也不是读码，而是**受控实验**——顺序是「先读消费点 → 再设计判定实验 → 最后用文档解释为什么」。本例三次翻车都出在跳步：\n1. 把『传了 tools 后命中变多』当成『平台转发 tools』——**其实是同一前缀的第二次调用命中了第一次写下的条目**（顺序混淆）；\n2. 把该结果写进方案前提，靠**算术**才发现错（两臂 `input+cacheRead` 完全相等 ⇒ 两臂 prompt 规模相同 ⇒ 47 个工具定义根本没进请求），再读码确认 `tools` 在实现文件里出现 **0 次**（参数被两个**对象字面量白名单**重建，无 spread）；\n3. 把『空文本 + usage 全 0』归因为『平台抑制计费』——实际是**适配层把传输错误 resolve 成空消息**，且**根本没有发出 provider 请求**。\n\n**可迁移的判定协议**：①**先验伪**：写下一个能一次否证的观测（本例：同前缀两臂的 `promptSize` 是否相等）；②**消混淆**：每个对照臂必须用**独立的新前缀**（或只跑单臂），否则先跑的那臂会污染后跑的那臂；③**分层读数**：区分『请求有没有发出』（provider 侧日志）／『回执返回了什么』（字段白名单）／『内容对不对』（文本与 usage）；④结论标**证据等级**（实测/读码/推断），推断不得升级为定案。\n\n机读细节与完整案例（前缀缓存 64 块粒度、消息历史必须压平、`toolResult` 第三角色）：`references/parameter-accepted-vs-used.md`。\n\n- \"这些项目里哪些真的能满足 <条件>\" — especially when the condition has a \"during real use\" or \"no dataset\" clause.\n- \"复检仍然符合标准后下载\" — re-verify a shortlist before cloning it.\n- A shortlist has to be cut down before spending disk/time on downloads.\n- A candidate was recommended earlier from README claims and now needs proof.\n- **对自己的工具集也同样审**：被要求\"记住一条依赖某工具的偏好/规程\"、或要按某个\"我能调用的能力\"行动时，先**枚举本会话声明的工具**（再必要时搜实现树）确认它存在；不存在就**不要落记忆**，并给出**不依赖该工具的替代表述**（例：没有压缩工具 ⇒ 写成\"接近上限就精简＋落续接卡\"）。\n\n> 判定法同源：**先证明能力存在，再谈怎么用**。把\"某能力不存在\"写成独立结论要谨慎——它是**条件从句**（\"有X就用X，没有就Y\"），不是一条会被将来推翻的负断言。\n\n**引用即断言：注释里的 `file:line` 必须打开看**（同日第二次教训）—— 家族代码注释称 20k 软线\"borrowed UPSTREAM\"并给了 `cli-config.yaml.example:538`／`skill_manager_tool.py:455`；读到上游 tip 才发现前者是 **sudo 提示**、后者是**函数调用行** ⇒ 引用**指错**；而上游真实纪律是\"**100k 硬门 + ~100 行简单／~200 行复杂**\"。沿\"软线告警\"这个**主题**再搜，才在另一文件找到真身：上游 `tools/skill_linter.py:56` `_BODY_SOFT_BUDGET_CHARS = 24_000` ⇒ `oversized-body` **WARNING**（两级 severity，`ERROR|WARNING`）⇒ 结论从\"三档全是自造\"更正为\"**软线继承、2× 升级与 20 000 数字是自造**\"。规矩：\n1. 任何\"来自上游/平台\"的引用，**先打开那一行**再复述；行号随版本漂移，指不到就写\"当前 tip 指不到\"（别替引用背书）。\n2. 追数字要**按主题扩展搜索**：一处引用失败 ≠ 上游没有该机制（本例真身在另一个文件）。\n3. 顺手做\"**上游有、我"
  },
  "skill_b": {
    "id": "capability-replication-audit",
    "description": "Judge whether a port matches its upstream point by point.",
    "head": "Judge whether a port matches its upstream point by point.\n\n# Capability Replication Audit\n\nAudit, from implementation evidence, whether a port (plugin, mirror, fork) covers a bounded capability set that an upstream reference defines — then write one status document per side. It does NOT run either system, does not change code, and does not judge quality; it judges *presence and equivalence of mechanism*. A verdict is only as good as the code actually read, so this skill is a reading discipline first.\n\n- \"检查 X 在 A 和 B 中是否都已经复刻了\" / \"对齐情况如何\"\n- \"分别写入两个情况说明文档\"（one doc per side）\n- Deciding whether a gap is a platform-contract limit or an unfinished port\n- Reviewing a port before release, or after the upstream gained a capability\n\nAudit, from implementation evidence, whether a port (plugin, mirror, fork) covers a bounded capability set that an upstream reference defines — then write one status document per side. It does NOT run either system, does not change code, and does not judge quality; it judges *presence and equivalence of mechanism*. A verdict is only as good as the code actually read, so this skill is a reading discipline first.\n- **平台契约边界造成** — the host platform cannot express the mechanism; state the prerequisite part the port would have to build itself.\n- 推荐段必须同时给出：**未做**（没跑运行时/没做端到端）、**回退路径**（卸载命令 + 要撤销的 patch 行）、**可证伪点**（≥3 条\"出现什么现象就下调哪一维\"）、**移植版的已知边界**（缺失能力/命名陷阱/内核跟随策略）。\n- 写进独立评测文档（\"评分对比报告.md\"式），含 rubric、逐维证据表、总分表、机制差异、推荐与原因、边界、可证伪点——不要塞进本技能正文。"
  },
  "scores": {
    "jaccard_summary": 0.2105,
    "jaccard_body": 0.1604,
    "body_cosine": 0.9582,
    "summary_cosine": 0.679
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