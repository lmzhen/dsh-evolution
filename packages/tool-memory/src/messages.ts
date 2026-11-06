import { registerHostMessages, tr as coreTr, type HostMessages } from '@deepseek-ai/dsh-evolution-core'

/** Host copy for @deepseek-ai/dsh-tool-memory. Keys are the Chinese source strings; '' = untranslated. */
export const MESSAGES: HostMessages = {
  en: {
  'operations 的每一项都必须是对象。': 'Each item in operations must be an object.',
  'memory："target" 必须是 "memory" 或 "user"（收到 {target}）；拒绝写入。': 'memory: "target" must be "memory" or "user" (received {target}); write refused.',
  'memory："{field}" 必须是字符串（收到 {kind}）；拒绝写入。': 'memory: "{field}" must be a string (received {kind}); write refused.',
  'memory：operations[{index}].{field} 必须是字符串（收到 {kind}）；拒绝写入 —— 重新批准无法修复载荷缺陷，请驳回该记录。': 'memory: operations[{index}].{field} must be a string (received {kind}); write refused — re-approving cannot fix a malformed payload, so reject this record.',
  '第 {position} 个操作（add）：必须提供 facts。未应用任何操作。': 'Operation #{position} (add): facts is required. No operations were applied.',
  '第 {position} 个操作：未知动作「{action}」（应为 add/remove/replace）。未应用任何操作。': 'Operation #{position}: unknown action "{action}" (expected add/remove/replace). No operations were applied.',
  '第 {position} 个操作（{action}）：必须提供 old_text。未应用任何操作。': 'Operation #{position} ({action}): old_text is required. No operations were applied.',
  '第 {position} 个操作（replace）：必须提供 facts。': 'Operation #{position} (replace): facts is required.',
  '每个操作只能提供 facts 或 content 之一（同一字段）：两者给了不同的值。': 'Each operation may specify only one of facts or content (they alias the same field): both were provided with different values.',
  '只能提供 facts 或 content 之一（同一字段）：两者给了不同的值。': 'Specify only one of facts or content (they alias the same field): both were provided with different values.',
  '没有提供任何操作（operations 数组为空）。': 'No operations were provided (the operations array is empty).',
  '形状不合法：operations 必须是 {action, content?, old_text?} 对象的数组（单个操作时可省略 operations）。': 'Invalid shape: operations must be an array of {action, content?, old_text?} objects (operations may be omitted for a single operation).',
  '拒绝：记忆工具已禁用（tool-memory memoryEnabled:false）—— 它的回放运行器无法执行这条暂存写入。请驳回该记录；若仍需要该写入，请在重新启用该工具后再暂存。': 'Refused: the memory tool is disabled (tool-memory memoryEnabled:false) — its replay runner cannot execute this staged write. Reject this record; if the write is still needed, re-enable the tool and stage it again.',
  },
  ja: {
  'operations 的每一项都必须是对象。': 'operations の各項目はオブジェクトである必要があります。',
  'memory："target" 必须是 "memory" 或 "user"（收到 {target}）；拒绝写入。': 'memory："target" は "memory" または "user" である必要があります（受信値：{target}）。書き込みを拒否しました。',
  'memory："{field}" 必须是字符串（收到 {kind}）；拒绝写入。': 'memory："{field}" は文字列である必要があります（受信値：{kind}）。書き込みを拒否しました。',
  'memory：operations[{index}].{field} 必须是字符串（收到 {kind}）；拒绝写入 —— 重新批准无法修复载荷缺陷，请驳回该记录。': 'memory：operations[{index}].{field} は文字列である必要があります（受信値：{kind}）。書き込みを拒否しました。再承認してもペイロードの不備は修復できないため、このレコードを却下してください。',
  '第 {position} 个操作（add）：必须提供 facts。未应用任何操作。': '{position} 番目の操作（add）：facts の指定が必要です。操作は適用されませんでした。',
  '第 {position} 个操作：未知动作「{action}」（应为 add/remove/replace）。未应用任何操作。': '{position} 番目の操作：不明なアクション「{action}」です（add/remove/replace のいずれかを指定してください）。操作は適用されませんでした。',
  '第 {position} 个操作（{action}）：必须提供 old_text。未应用任何操作。': '{position} 番目の操作（{action}）：old_text の指定が必要です。操作は適用されませんでした。',
  '第 {position} 个操作（replace）：必须提供 facts。': '{position} 番目の操作（replace）：facts の指定が必要です。',
  '每个操作只能提供 facts 或 content 之一（同一字段）：两者给了不同的值。': '各操作で指定できるのは facts または content のいずれか一方のみです（同一フィールドの別名）。両方に異なる値が指定されました。',
  '只能提供 facts 或 content 之一（同一字段）：两者给了不同的值。': '指定できるのは facts または content のいずれか一方のみです（同一フィールドの別名）。両方に異なる値が指定されました。',
  '没有提供任何操作（operations 数组为空）。': '操作が指定されていません（operations 配列が空です）。',
  '形状不合法：operations 必须是 {action, content?, old_text?} 对象的数组（单个操作时可省略 operations）。': '形式が不正です：operations は {action, content?, old_text?} オブジェクトの配列である必要があります（単一操作の場合は operations を省略できます）。',
  '拒绝：记忆工具已禁用（tool-memory memoryEnabled:false）—— 它的回放运行器无法执行这条暂存写入。请驳回该记录；若仍需要该写入，请在重新启用该工具后再暂存。': '拒否：メモリツールが無効化されているため（tool-memory memoryEnabled:false）、リプレイランナーでこの一時保存された書き込みを実行できません。このレコードを却下してください。書き込みが引き続き必要な場合は、ツールを再度有効化してから改めて一時保存してください。',
  },
}
registerHostMessages(MESSAGES)
export const tr = coreTr
