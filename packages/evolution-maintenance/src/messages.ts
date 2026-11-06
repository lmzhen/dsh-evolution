import { registerHostMessages, tr as coreTr, type HostMessages } from '@deepseek-ai/dsh-evolution-core'

/** Host copy for @deepseek-ai/dsh-evolution-maintenance. Keys are the Chinese source strings; '' = untranslated. */
export const MESSAGES: HostMessages = {
  en: {
  '(阈 {id})': '(threshold {id})',
  '未检测到漂移问题，无需处理。': 'No drift issues detected; no action required.',
  'dsh-evolution 提示词包完整性检查失败；拒绝运行 maintain': 'dsh-evolution prompt bundle integrity check failed; refusing to run maintain',
  '维护扫描无法读取列出的 {count} 个技能（{list}），且一个技能都没读到 —— the library was NOT audited; fix the unreadable skills (or their directory names) and run the scan again': 'Maintenance scan could not read the {count} listed skill(s) ({list}) and read zero skills in total — the library was NOT audited; fix the unreadable skills (or their directory names) and run the scan again',
  '维护扫描发现技能库为空，但配置的技能根目录不存在{rootNote} —— point the skillsRoot config at a real directory (a literal `~` is not expanded) and run the scan again': 'Maintenance scan found an empty skill library, and the configured skills root directory does not exist{rootNote} — point the skillsRoot config at a real directory (a literal `~` is not expanded) and run the scan again',
  '维护扫描：技能库为空，无需处理。': 'Maintenance scan: skill library is empty; no action required.',
  'maintain：--timeout 必须是以毫秒为单位的正整数，最大 {max}；收到 {received}': 'maintain: --timeout must be a positive integer in milliseconds up to {max}; received {received}',
  '维护扫描不可用（{code}）：{reason}。请在已挂载 agentPresets/subagents 的宿主会话中重试。': 'Maintenance scan is unavailable ({code}): {reason}. Retry inside a host session with agentPresets/subagents mounted.',
  '维护扫描已中止（取消或超时），计划尚未产出 —— 在技能多、库大的场景下，请重试或提高超时（evolution-commands maintainTimeoutMs）。': 'Maintenance scan was aborted (cancelled or timed out) before a plan was produced — for large libraries with many skills, retry or increase the timeout (evolution-commands maintainTimeoutMs).',
  '维护子智能体没有返回结构化计划（模型没有产出结构化计划，或运行在产出前结束）：请重试；若反复出现，请提高 --timeout 或检查模型的输出结构。': 'The maintenance subagent did not return a structured plan (the model produced no structured plan, or the run ended before producing one): retry; if this persists, increase --timeout or inspect the model\'s output structure.',
  '维护计划被校验器拒绝：{errors}': 'Maintenance plan was rejected by the validator: {errors}',
  },
  ja: {
  '(阈 {id})': '（しきい値 {id}）',
  '未检测到漂移问题，无需处理。': 'ドリフトの問題は検出されませんでした。対応は不要です。',
  'dsh-evolution 提示词包完整性检查失败；拒绝运行 maintain': 'dsh-evolution プロンプトバンドルの整合性チェックに失敗したため、maintain の実行を拒否しました',
  '维护扫描无法读取列出的 {count} 个技能（{list}），且一个技能都没读到 —— the library was NOT audited; fix the unreadable skills (or their directory names) and run the scan again': 'メンテナンススキャンで一覧の {count} 件のスキル（{list}）を読み取れず、読み取れたスキルが 0 件でした。ライブラリは監査されていません。読み取れないスキル（またはそのディレクトリ名）を修正してから、スキャンを再実行してください',
  '维护扫描发现技能库为空，但配置的技能根目录不存在{rootNote} —— point the skillsRoot config at a real directory (a literal `~` is not expanded) and run the scan again': 'メンテナンススキャンでスキルライブラリが空であり、かつ設定されたスキルルートディレクトリが存在しないことが判明しました{rootNote}。skillsRoot 設定に実在するディレクトリを指定し（リテラルの `~` は展開されません）、スキャンを再実行してください',
  '维护扫描：技能库为空，无需处理。': 'メンテナンススキャン：スキルライブラリは空です。対応は不要です。',
  'maintain：--timeout 必须是以毫秒为单位的正整数，最大 {max}；收到 {received}': 'maintain：--timeout はミリ秒単位の正の整数（最大 {max}）である必要があります（受信値：{received}）',
  '维护扫描不可用（{code}）：{reason}。请在已挂载 agentPresets/subagents 的宿主会话中重试。': 'メンテナンススキャンを利用できません（{code}）：{reason}。agentPresets/subagents がマウントされたホストセッション内で再試行してください。',
  '维护扫描已中止（取消或超时），计划尚未产出 —— 在技能多、库大的场景下，请重试或提高超时（evolution-commands maintainTimeoutMs）。': '計画が出力される前にメンテナンススキャンが中断されました（キャンセルまたはタイムアウト）。スキル数が多い大規模なライブラリでは、再試行するかタイムアウト時間を延長してください（evolution-commands maintainTimeoutMs）。',
  '维护子智能体没有返回结构化计划（模型没有产出结构化计划，或运行在产出前结束）：请重试；若反复出现，请提高 --timeout 或检查模型的输出结构。': 'メンテナンスサブエージェントが構造化計画を返しませんでした（モデルが構造化計画を生成しなかったか、生成前に実行が終了しました）：再試行してください。繰り返し発生する場合は、--timeout を増やすかモデルの出力構造を確認してください。',
  '维护计划被校验器拒绝：{errors}': 'メンテナンス計画がバリデータに拒否されました：{errors}',
  },
}
registerHostMessages(MESSAGES)
export const tr = coreTr
