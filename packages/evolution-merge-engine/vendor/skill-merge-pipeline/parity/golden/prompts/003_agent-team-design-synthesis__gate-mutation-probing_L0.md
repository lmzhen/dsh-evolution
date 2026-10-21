{
  "level": "L0",
  "skill_a": {
    "id": "agent-team-design-synthesis",
    "name": "agent-team-design-synthesis",
    "description": "Design via parallel facets with adversarial review."
  },
  "skill_b": {
    "id": "gate-mutation-probing",
    "name": "gate-mutation-probing",
    "description": "Prove a gate or test can fail before trusting its pass."
  },
  "scores": {
    "jaccard_summary": 0,
    "jaccard_body": 0.1586,
    "body_cosine": 0.9682
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