export const NS = 'evolution-merge'

export const zh: Record<string, string> = {
  'entry.label': '技能合并',
  'hint': '手动触发；后台逐对判定。这里只读，不写技能。',
  'tab.pending': '待批准',
  'tab.retry': '待重跑',
  'tab.skipped': '无需合并',
  'empty.pending': '没有待批准的合并。',
  'empty.retry': '没有待重跑的对。',
  'empty.skipped': '没有标记为无需合并的对。',
  'loading': '正在读取…',
  'refresh': '刷新',
  'failed': '读取失败，保留上次结果。',
  'stage.decide': '判定',
  'stage.author': '合并',
  'stage.validate': '检查',
  'stage.commit': '提交',
}

export const en: Record<string, string> = {
  'entry.label': 'Skill merge',
  'hint': 'Manual only; pairs are judged in the background. Read-only here.',
  'tab.pending': 'Pending',
  'tab.retry': 'Retry',
  'tab.skipped': 'Skipped',
  'empty.pending': 'No pending merges.',
  'empty.retry': 'No pairs waiting to retry.',
  'empty.skipped': 'No pairs marked as not worth merging.',
  'loading': 'Loading…',
  'refresh': 'Refresh',
  'failed': 'Read failed; keeping the last result.',
  'stage.decide': 'Decide',
  'stage.author': 'Author',
  'stage.validate': 'Validate',
  'stage.commit': 'Commit',
}
