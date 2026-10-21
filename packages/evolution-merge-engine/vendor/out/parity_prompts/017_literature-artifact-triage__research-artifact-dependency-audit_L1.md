{
  "level": "L1",
  "skill_a": {
    "id": "literature-artifact-triage",
    "description": "Triage research papers into an evidence-graded report with verified artifacts.",
    "head": "Triage research papers into an evidence-graded report with verified artifacts.\n\n# Literature Artifact Triage\n\nBuilds a filtered, evidence-graded literature list: find papers matching stated inclusion\ncriteria, then **verify each claimed artifact and each author affiliation** before ranking.\nIt does NOT write the papers' science, and it does not rank by citation counts or popularity.\nCore stance: rank by *what you can actually obtain*, not by what the paper claims to release.\n\n- \"Find research on X since <date>, prioritize high-quality / reliable authors / with GitHub or HuggingFace links\"\n- \"Which of these papers can I actually reproduce?\"\n- Any request where a paper's *artifact availability* or *author credibility* is a selection criterion.\n- Also use when auditing a report someone else produced for unsupported artifact claims.\n\nNone. Uses `web_search`, `web_fetch`, `subagent`, `skill_manage`. For arXiv metadata prefer the\nAtom API (`https://export.arxiv.org/api/query?...`) — it returns authors, dates, `journal_ref`\nand the full abstract in one call.\n\n| Need | Call |\n|---|---|\n| Paper metadata (authors, venue, dates) | `export.arxiv.org/api/query?id_list=<ids>&max_results=N` |\n| Metadata for a whole list at once | ONE `id_list=` request carrying every ID (`max_results=100`) — splitting into small batches trips `Rate exceeded.` (HTTP 429); on 429 wait ~60 s and retry the same single call |\n| Survey PDF → text | bundled Python has `pypdf`: `PdfReader(p).pages[i].extract_text()` per page, keep `=== PAGE n ===` markers |\n| Artifact verdict for a whole list | `node scripts/verify-paper-artifacts.mjs papers.json` — encodes the E1/E2 ladder (name + citation + ≤4 arXiv ids), paces searches, rewrites the result file per paper |\n| Download + score the code you found | see `references/code-scoring-rubric.md`: shallow-clone hygiene (verify HEAD + file count), measured-vs-judged rubric, and the four measurement traps |\n| Affiliation (NOT in abstract) | `arxiv.org/html/<id>v<N>` — the affiliation block |\n| Repo metadata | `api.github.com/repos/<owner>/<repo>` |\n| Repo file tree | `api.github.com/repos/<owner>/<repo>/contents/` |\n| Repo real commit history | `api.github.com/repos/<owner>/<repo>/commits?per_page=5` |\n| Model-weights page | `huggingface.co/api/models/<owner>/<name>` |\n\n**Escalate hosts, never declare a host dead.** `api.github.com`, `github.com`,\n`raw.githu"
  },
  "skill_b": {
    "id": "research-artifact-dependency-audit",
    "description": "Trace a research project's data and ground-truth needs.",
    "head": "Trace a research project's data and ground-truth needs.\n\n# Research Artifact Dependency Audit\n\nAnswers a pointed question about one research project — \"does it need a dataset?\", \"does it need\nground truth?\", \"can I run this without X?\" — by tracing each dependency to its exact layer and\nciting paper text, not repo vibes. It does NOT rank papers or discover new ones (use\n`literature-artifact-triage` for that), and it does not run the method.\n\nCore stance: **a paper repository is usually the paper plus images.** With no code, dependency\nclaims are structurally unverifiable — say so, cite where each claim comes from, and never let the\nREADME's framing stand in for the method's actual data flow.\n\n- \"这个项目依赖于数据集吗？尤其是依赖于 ground truth 吗？\"\n- \"Does <project> need training data / labels / a reference implementation?\"\n- \"Can I run <method> without <resource>?\" / \"What would I need to reproduce this?\"\n- Any request to judge a paper's data requirements before committing to reimplement or reuse it.\n- \"还能不能用在真实任务上\" / free-form B2C use with no explicit task boundary and no ground truth.\n  Answer this **first** (step 3), then use the layer accounting as evidence for it.\n\n`web_fetch` for the repo page and project site; `pwsh` + `git` for a shallow clone when the repo is\nsmall; a PDF text extractor for the paper (`pymupdf`/`fitz`, `pypdf`, `pdfminer` are commonly\npresent — probe with `importlib.util.find_spec` before assuming); `gh api` for artifact state that\nthe rendered page hides.\n\nClone the artifact, count its real contents, then read the paper — in that order.\n\n```powershell\ngit clone --depth 1 <repo-url> D:\\<work>\\_probe\\<name>   # git writes progress to stderr;\n                                                          # a NativeCommandError there is not failure\nGet-ChildItem <clone> -Recurse -File | Where-Object { $_.FullName -notmatch '\\\\\\.git\\\\' } |\n  Select-Object @{n='Path';e={$_.FullName.Replace('<clone>\\','')}}, Length\n```\n\n1. **Establish what artifact exists.** File list + `gh api repos/<o>/<r>` (`size`, `pushed_at`).\n   README + `assets/` + a PDF and nothing else ⇒ **paper-only**: your answer must be flagged as\n   unverified against code, and any release-plan table quoted verbatim.\n2. **Extract the whole paper to text, then two-pass grep.** First pass: a terminology map to build\n   vocabulary. Second: targeted terms. Do **not** start from generic `data|instance`"
  },
  "scores": {
    "jaccard_summary": 0.0833,
    "jaccard_body": 0.2104,
    "summary_cosine": 0.5514
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