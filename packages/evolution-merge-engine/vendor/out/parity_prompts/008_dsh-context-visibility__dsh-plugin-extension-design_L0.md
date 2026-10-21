{
  "level": "L0",
  "skill_a": {
    "id": "dsh-context-visibility",
    "name": "dsh-context-visibility",
    "description": "Decide what reaches a DSH model context and how to inject."
  },
  "skill_b": {
    "id": "dsh-plugin-extension-design",
    "name": "dsh-plugin-extension-design",
    "description": "Design DSH plugin seams that reuse host services."
  },
  "scores": {
    "jaccard_summary": 0.05,
    "jaccard_body": 0.129,
    "body_cosine": 0.9673
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