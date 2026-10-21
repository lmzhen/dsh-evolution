{
  "level": "L0",
  "skill_a": {
    "id": "dsh-plugin-discovery",
    "name": "dsh-plugin-discovery",
    "description": "Rank DSH plugins from the live market catalog and GitHub."
  },
  "skill_b": {
    "id": "dsh-plugin-extension-design",
    "name": "dsh-plugin-extension-design",
    "description": "Design DSH plugin seams that reuse host services."
  },
  "scores": {
    "jaccard_summary": 0.1053,
    "jaccard_body": 0.1132,
    "summary_cosine": 0.6708
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