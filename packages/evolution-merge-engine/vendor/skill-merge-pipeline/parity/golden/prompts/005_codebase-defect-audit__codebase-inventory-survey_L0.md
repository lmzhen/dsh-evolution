{
  "level": "L0",
  "skill_a": {
    "id": "codebase-defect-audit",
    "name": "codebase-defect-audit",
    "description": "Audit a codebase read-only and grade findings P0-P2."
  },
  "skill_b": {
    "id": "codebase-inventory-survey",
    "name": "codebase-inventory-survey",
    "description": "Survey a codebase and explain its functions as a list."
  },
  "scores": {
    "jaccard_summary": 0.1667,
    "jaccard_body": 0.2704,
    "body_cosine": 0.9513,
    "summary_cosine": 0.4991
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