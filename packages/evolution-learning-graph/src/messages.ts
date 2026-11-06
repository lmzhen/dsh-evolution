import { registerHostMessages, tr as coreTr, type HostMessages } from '@deepseek-ai/dsh-evolution-core'

/** Host copy for @deepseek-ai/dsh-evolution-learning-graph. Keys are the Chinese source strings; '' = untranslated. */
export const MESSAGES: HostMessages = {
  en: {
  '记忆 {source}[{index}] 不存在（共 {count} 条）。': 'Memory {source}[{index}] does not exist ({count} total entries).',
  '记忆 {source}[{index}] 在图渲染之后被改动过：请重新运行 /graph 再重试。': 'Memory {source}[{index}] was modified after the graph was rendered: run /graph again and retry.',
  '技能「{name}」不存在。': 'Skill "{name}" does not exist.',
  'Memory {source}[{index}] 不可用。': 'Memory {source}[{index}] is unavailable.',
  '显示学习图，或对某个节点操作：graph [detail|edit|delete] <nodeId>': 'Display the learning graph or act on a node: graph [detail|edit|delete] <nodeId>',
  'skill-usage、memory 或 evolution-io 服务未挂载。': 'The skill-usage, memory, or evolution-io service is not mounted.',
  '未知的 graph 子命令「{command}」。{directory}': 'Unknown graph subcommand "{command}".{directory}',
  '实时技能库里没有技能「{name}」，即该技能不存在。（图里可能显示的是过期节点。）': 'Skill "{name}" is not in the live skill library and does not exist. (The graph may be showing a stale node.)',
  '无法读取技能「{name}」以确认它存在（{reason}）：拒绝暂存。该技能可能仍然存在；请解决读取失败后重试。': 'Could not read skill "{name}" to confirm its existence ({reason}): staging refused. The skill may still exist; resolve the read failure and retry.',
  '节点 id「{id}」不合法：应为技能名或 memory:<source>:<index>。': 'Invalid node id "{id}": expected a skill name or memory:<source>:<index>.',
  '无法暂存 graph 技能写入：没有注册技能回放运行器 —— 请挂载 tool-skill-manage 行（evolution-agent 预设），或禁用 evolution-approval。': 'Cannot stage graph skill write: no skill replay runner is registered — mount the tool-skill-manage row (evolution-agent preset) or disable evolution-approval.',
  '记忆索引检查失败。': 'Memory index check failed.',
  '无法暂存 graph 记忆写入：没有注册记忆回放运行器 —— 请挂载 tool-memory 行（evolution-all bundle，或 evolution-preset overlay；宿主 bundle 里不含它），或禁用 evolution-approval。': 'Cannot stage graph memory write: no memory replay runner is registered — mount the tool-memory row (evolution-all bundle or evolution-preset overlay; not included in the host bundle) or disable evolution-approval.',
  '无法暂存 graph 技能删除：没有注册技能回放运行器 —— 请挂载 tool-skill-manage 行（evolution-agent 预设），或禁用 evolution-approval。': 'Cannot stage graph skill deletion: no skill replay runner is registered — mount the tool-skill-manage row (evolution-agent preset) or disable evolution-approval.',
  '无法暂存 graph 记忆删除：没有注册记忆回放运行器 —— 请挂载 tool-memory 行（evolution-all bundle，或 evolution-preset overlay；宿主 bundle 里不含它），或禁用 evolution-approval。': 'Cannot stage graph memory deletion: no memory replay runner is registered — mount the tool-memory row (evolution-all bundle or evolution-preset overlay; not included in the host bundle) or disable evolution-approval.',
  'graph：命令失败：{message}\n请检查节点 id 以及 evolution 根目录下的 skills/memory 文件，然后重试。': 'graph: command failed: {message}\nCheck the node id and the skills/memory files under the evolution root directory, then retry.',
  },
  ja: {
  '记忆 {source}[{index}] 不存在（共 {count} 条）。': 'メモリ {source}[{index}] は存在しません（全 {count} 件）。',
  '记忆 {source}[{index}] 在图渲染之后被改动过：请重新运行 /graph 再重试。': 'グラフの描画後にメモリ {source}[{index}] が変更されました。/graph を再実行してからやり直してください。',
  '技能「{name}」不存在。': 'スキル「{name}」は存在しません。',
  'Memory {source}[{index}] 不可用。': 'Memory {source}[{index}] は利用できません。',
  '显示学习图，或对某个节点操作：graph [detail|edit|delete] <nodeId>': '学習グラフを表示するか、特定のノードを操作します：graph [detail|edit|delete] <nodeId>',
  'skill-usage、memory 或 evolution-io 服务未挂载。': 'skill-usage、memory、または evolution-io サービスがマウントされていません。',
  '未知的 graph 子命令「{command}」。{directory}': '不明な graph サブコマンド「{command}」です。{directory}',
  '实时技能库里没有技能「{name}」，即该技能不存在。（图里可能显示的是过期节点。）': '現在のスキルライブラリにスキル「{name}」がないため、そのスキルは存在しません。（グラフに古いノードが表示されている可能性があります。）',
  '无法读取技能「{name}」以确认它存在（{reason}）：拒绝暂存。该技能可能仍然存在；请解决读取失败后重试。': 'スキル「{name}」の存在を確認するための読み取りに失敗したため（{reason}）、一時保存を拒否しました。スキル自体は存在している可能性があります。読み取り失敗の原因を解消してから再試行してください。',
  '节点 id「{id}」不合法：应为技能名或 memory:<source>:<index>。': 'ノード id「{id}」が不正です。スキル名または memory:<source>:<index> を指定してください。',
  '无法暂存 graph 技能写入：没有注册技能回放运行器 —— 请挂载 tool-skill-manage 行（evolution-agent 预设），或禁用 evolution-approval。': 'graph によるスキル書き込みを一時保存できません：スキルリプレイランナーが登録されていません。tool-skill-manage 行（evolution-agent プリセット）をマウントするか、evolution-approval を無効化してください。',
  '记忆索引检查失败。': 'メモリインデックスの確認に失敗しました。',
  '无法暂存 graph 记忆写入：没有注册记忆回放运行器 —— 请挂载 tool-memory 行（evolution-all bundle，或 evolution-preset overlay；宿主 bundle 里不含它），或禁用 evolution-approval。': 'graph によるメモリ書き込みを一時保存できません：メモリリプレイランナーが登録されていません。tool-memory 行（evolution-all バンドル、または evolution-preset オーバーレイ。ホストバンドルには含まれません）をマウントするか、evolution-approval を無効化してください。',
  '无法暂存 graph 技能删除：没有注册技能回放运行器 —— 请挂载 tool-skill-manage 行（evolution-agent 预设），或禁用 evolution-approval。': 'graph によるスキル削除を一時保存できません：スキルリプレイランナーが登録されていません。tool-skill-manage 行（evolution-agent プリセット）をマウントするか、evolution-approval を無効化してください。',
  '无法暂存 graph 记忆删除：没有注册记忆回放运行器 —— 请挂载 tool-memory 行（evolution-all bundle，或 evolution-preset overlay；宿主 bundle 里不含它），或禁用 evolution-approval。': 'graph によるメモリ削除を一時保存できません：メモリリプレイランナーが登録されていません。tool-memory 行（evolution-all バンドル、または evolution-preset オーバーレイ。ホストバンドルには含まれません）をマウントするか、evolution-approval を無効化してください。',
  'graph：命令失败：{message}\n请检查节点 id 以及 evolution 根目录下的 skills/memory 文件，然后重试。': 'graph：コマンドが失敗しました：{message}\nノード id と evolution ルート配下の skills/memory ファイルを確認してから、再試行してください。',
  },
}
registerHostMessages(MESSAGES)
export const tr = coreTr
