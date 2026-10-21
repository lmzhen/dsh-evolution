{
  "level": "L0",
  "skill_a": {
    "id": "literature-artifact-triage",
    "name": "literature-artifact-triage",
    "description": "Triage research papers into an evidence-graded report with verified artifacts."
  },
  "skill_b": {
    "id": "research-artifact-dependency-audit",
    "name": "research-artifact-dependency-audit",
    "description": "Trace a research project's data and ground-truth needs."
  },
  "scores": {
    "jaccard_summary": 0.0833,
    "jaccard_body": 0.2104,
    "summary_cosine": 0.5514
  },
  "note": "仅凭名称与描述判断；若不够判断请回 0，不要猜。",
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