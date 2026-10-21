{
  "level": "L1",
  "skill_a": {
    "id": "codebase-defect-audit",
    "description": "Audit a codebase read-only and grade findings P0-P2.",
    "head": "Audit a codebase read-only and grade findings P0-P2.\n\n# Codebase Defect Audit\n\nSweep a whole codebase read-only, grade what you find on a stated severity rubric,\nand deliver one report document that another engineer can act on without\nre-deriving anything. It does **not** fix anything: the deliverable is the report. When the ask continues\ninto remediation (\"design the landing plan\", \"fix them in batches\", \"check this plan\nagainst the real code\"), the second half applies — see\n`references/remediation-plan-design.md` for the design and\n`references/remediation-execution.md` for landing the batches (gate pair, plan/apply shape,\nindependent-review closure, long-run hygiene).\nRecurring defect classes and measured baselines live in\n`references/agent-plugin-defect-classes.md`; when ONE discovered defect raises the question \"does this class exist\nelsewhere?\", run the same-class sweep of `references/lifecycle-debt-sweep.md` — it also carries the four checks that\nanswer \"did the previous audit MISS this?\" without counting findings.\nWhen the ask is to integrate every finding into one framework (first principles, systems thinking, precise locations), including the over-fit trap and how to read a corpus larger than the context: `references/finding-framework-synthesis.md`.\n\nFor **running** a lane batch - the per-lane prompt contract, write-as-you-go so a crash costs the tail not the run, and the adversarial spot checks that decide which findings may be published as confirmed - see `references/lane-batch-operations.md`.\n\nWhen the audit fans out into many lanes and must end in a framework document, the synthesis\nlayer (per-source A/B/C extraction, id-level coverage diff, self-audit of the audit's own\nreport set) is `references/multi-track-audit-synthesis.md`, and the reusable coverage check is\n`scripts/doc-id-coverage-check.mjs`.\n\n- \"审计这个项目的全量代码，找出 bug / 隐患 / 死代码 / 技术债\" (typically with a severity floor, e.g. P0–P2 only).\n- A follow-up axis is requested on the same target (\"再看时间/空间复杂度\", \"再看并发\", \"再看权限\") — append to the **same** report, same rubric.\n- Before a release: an independent, evidence-backed pass over a codebase you did not write.\n- A single module looks suspicious and you want the surrounding surface checked with it.\n- The docs themselves are the target (\"文档里有没有过时/失实/未覆盖的内容\", \"安装说明对不对\") — a\n  documentation sweep is its own lane set: `references/documentation-audit.md`"
  },
  "skill_b": {
    "id": "codebase-inventory-survey",
    "description": "Survey a codebase and explain its functions as a list.",
    "head": "Survey a codebase and explain its functions as a list.\n\n# Codebase Inventory Survey\n\nRead an unfamiliar or existing codebase and deliver a structured, function-first inventory of what it does. It does NOT grade defects or rank findings (that is `codebase-defect-audit`) and does NOT judge a port against its upstream point by point (that is `capability-replication-audit`). The output is a list a reader can act on: what the thing is, every capability it has, the interfaces it exposes, the files and limits it owns, its invariants, and what is knowingly unfinished.\n\n- \"深入阅读 X 的项目代码，对功能做清单式讲解\" / \"survey this repo and list its functions\"\n- Onboarding onto a codebase that already has README/IMPL/design docs written by its own authors\n- Producing the \"what exists\" half of a review, before anyone argues about what should change\n- Any request where the deliverable is understanding, not edits\n\n- Read-only access to the repo root. No build, no test run, no install is needed for the survey itself.\n- The repo's own documentation set. Find it before reading code: a docs index that splits \"describes current behavior\" from \"dated process archive\" is the highest-value thing in the repo.\n- If the repo is a plugin or an extension, the host platform's installed docs matter more than the repo's prose — the code is usually shaped by host contracts it never restates.\n\n1. Enumerate everything (`pwsh`), once: directories + every file with size, excluding `node_modules` and `.git`.\n2. Read the authority documents whole. Note which ones are dated archives.\n3. Per-file extraction: small files in full; large files by structure grep then offset reads.\n4. Group the notes by capability, not by directory.\n5. Write the report into the reply, in numbered sections, dense.\n\n```powershell\n# Every directory, node_modules/.git excluded\nGet-ChildItem -Path <root> -Recurse -Force -Directory |\n  Where-Object { $_.FullName -notmatch 'node_modules|\\.git\\\\' } |\n  ForEach-Object { $_.FullName.Replace('<root>\\\\','') } | Sort-Object\n\n# Every file with size — the shape map (counts, hot spots, doc set)\nGet-ChildItem -Path <root> -Recurse -Force -File |\n  Where-Object { $_.FullName -notmatch 'node_modules|\\.git\\\\' } |\n  Select-Object @{n='Rel';e={$_.FullName.Replace('<root>\\\\','')}},Length | Sort-Object Rel\n```\n\n```\ngrep tool, path=<one large file>, pattern=\"^(export |async function |function |const [A-Z_]+ =)\""
  },
  "scores": {
    "jaccard_summary": 0.1667,
    "jaccard_body": 0.2704,
    "body_cosine": 0.9513,
    "summary_cosine": 0.4991
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