{
  "level": "L0",
  "skill_a": {
    "id": "capability-claim-audit",
    "name": "capability-claim-audit",
    "description": "Check a tool's capability claims against its source."
  },
  "skill_b": {
    "id": "capability-replication-audit",
    "name": "capability-replication-audit",
    "description": "Judge whether a port matches its upstream point by point."
  },
  "scores": {
    "jaccard_summary": 0.2105,
    "jaccard_body": 0.1604,
    "body_cosine": 0.9582,
    "summary_cosine": 0.679
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