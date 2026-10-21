{
  "level": "L0",
  "skill_a": {
    "id": "dsh-plugin-discovery",
    "name": "dsh-plugin-discovery",
    "description": "Rank DSH plugins from the live market catalog and GitHub."
  },
  "skill_b": {
    "id": "platform-plugin-port-verification",
    "name": "platform-plugin-port-verification",
    "description": "Prove a plugin port against a new platform release."
  },
  "scores": {
    "jaccard_summary": 0.05,
    "jaccard_body": 0.1583,
    "summary_cosine": 0.5849
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