{
  "level": "L0",
  "skill_a": {
    "id": "dsh-evolution-maintenance",
    "name": "dsh-evolution-maintenance",
    "description": "维护家族插件：发布/CI、客户端、门禁、审计与复核报告、参数、宿主重启。"
  },
  "skill_b": {
    "id": "dsh-evolution-release",
    "name": "dsh-evolution-release",
    "description": "Cut a family release and triage its CI failures."
  },
  "scores": {
    "jaccard_summary": 0.0968,
    "jaccard_body": 0.1197,
    "body_cosine": 0.9585,
    "summary_cosine": 0.5014
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