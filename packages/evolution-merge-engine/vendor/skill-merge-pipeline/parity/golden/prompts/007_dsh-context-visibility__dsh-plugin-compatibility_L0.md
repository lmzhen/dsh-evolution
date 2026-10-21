{
  "level": "L0",
  "skill_a": {
    "id": "dsh-context-visibility",
    "name": "dsh-context-visibility",
    "description": "Decide what reaches a DSH model context and how to inject."
  },
  "skill_b": {
    "id": "dsh-plugin-compatibility",
    "name": "dsh-plugin-compatibility",
    "description": "Audit DSH plugins against a new release and fix what breaks."
  },
  "scores": {
    "jaccard_summary": 0.1905,
    "jaccard_body": 0.1215,
    "body_cosine": 0.949
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