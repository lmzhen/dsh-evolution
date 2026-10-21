{
  "level": "L0",
  "skill_a": {
    "id": "docx-layout-and-figures",
    "name": "docx-layout-and-figures",
    "description": "Verify and fix Word layout, fonts, and figures in a .docx."
  },
  "skill_b": {
    "id": "officecli-docx",
    "name": "officecli-docx",
    "description": "Use this skill any time a .docx file is involved -- as input, output, or both. This includes: creating Word documents, reports, letters, memos, or proposals; reading, parsing, or extracting text from any .docx file; editing, modifying, or updating existing documents; working with templates, tracked changes, comments, headers/footers, or tables of contents. Trigger whenever the user mentions 'Word doc', 'document', 'report', 'letter', 'memo', or references a .docx filename."
  },
  "scores": {
    "jaccard_summary": 0.0476,
    "jaccard_body": 0.0248,
    "summary_cosine": 0.6404
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