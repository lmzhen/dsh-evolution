/**
 * THE error-code table: E-301…E-325 with the exact text each one emits (E-317…E-319 are the
 * write-admission gates' own refusals).
 *
 * The codes used to be spelled out at 33 call sites across two packages, so one
 * code's wording could drift between the branches that answer it and nothing could
 * see the drift. Keys name the SCENARIO rather than the code, because a code
 * legitimately carries more than one text (E-301 answers pending / approve / reject
 * with different guidance); the code still leads every string, so model- and
 * user-facing output is unchanged. Interpolations are written `%aN%` and filled by
 * `errorText` from the values the call site used to interpolate inline.
 * @module @deepseek-ai/dsh-evolution-core
 */
import { hostLocale } from './messages.ts'
export const EVOLUTION_ERRORS = Object.freeze({
  'e-305-this-invocation-carries-no':
    'E-305: 本次调用没有携带 agent —— `%a1%` 需要由会话支撑的调用（请在 GUI 或 CLI 的会话里运行）。',
  'e-306-this-deployment-stages-foreground':
    'E-306: 本部署会暂存前台写入，但 `/evolution %a1%` 无法通过技能运行器回放 —— 没有可暂存的内容。请在批准策略为 \'never\' 的会话里运行，或在 evolution-approval 行上设置 `stageForeground: false`，然后重试该命令。',
  'e-301-approval-service-not-mounted':
    'E-301: 批准服务未挂载：待批准写入无法列出或回放。挂载 evolution-approval 行（随 evolution-host/evolution-all 提供）后，运行 /evolution doctor 可查看已挂载的服务。',
  'e-301-approval-service-not-mounted-2':
    'E-301: 批准服务未挂载。下一步：evolution-approval 行随 evolution-host/evolution-all 一起提供 —— 运行 /evolution doctor 查看已挂载的服务。',
  'e-304-the-mounted-approval-service':
    'E-304: 已挂载的批准服务早于本能力发布 —— 请改为驳回该记录。',
  'e-302-curator-service-not-mounted':
    'E-302: 策展服务未挂载。下一步：挂载 evolution-curator 行（evolution-host/evolution-all），并运行 /evolution doctor。',
  'e-305-the-invocation-agent-exposes':
    'E-305: 调用 agent 既没有暴露 `followup` 也没有 `inject` —— %a1% 没有投递通道。',
  'e-306-this-deployment-stages-foreground-2':
    'E-306: 本部署会暂存前台写入，但本次调用没有 agent 会话 —— `/evolution restructure` 会暂存一条没有会话归属的记录。请在 GUI 或 CLI 的会话里运行，或在 `stageForeground: false` 行上设置，然后重试该命令。',
  'e-303-replay-service-not-mounted':
    'E-303: 回放服务未挂载。下一步：挂载 evolution-replay 行（evolution-host/evolution-all），并运行 /evolution doctor。',
  'e-307-the-settings-service-could':
    'E-307: 设置服务无法报告它的分区（%a1%）。/evolution params 需要用户层来区分覆盖值与部署值；运行 /evolution doctor 查看已挂载的服务。',
  'e-308-unknown-parameter-group-group':
    'E-308: 未知的参数分组「%a1%」—— 已知分组：%a2%。',
  'e-311-no-settings-service-is':
    'E-311: 没有挂载设置服务，因此没有可写入的用户层。请挂载 settings 行（packages/settings/settings-file）后重试；本命令从不修改 cordis.yml —— 部署值属于部署。/evolution doctor 会列出已挂载的服务。',
  'e-312-error-instanceof-Error-error':
    'E-312: %a1% —— /evolution params 会列出规范 id。',
  'e-313-unknown-parameter-id-evolution':
    'E-313: 未知参数「%a1%」—— /evolution params 会列出每个已注册 id 及其层级与用户层。',
  'e-314-id-is-a-deployment':
    'E-314: 「%a1%」是部署参数（层级 %a2%，归属 %a3%）—— 它写在 cordis.yml 的插件行或策略行上，而不是从会话写入。/evolution params 会显示每一行由谁可写。',
  'e-315-id-has-no-user':
    'E-315: 「%a1%」没有用户层 —— 归属 %a2% 没有发布设置命名空间，因此该值留在部署层。',
  'e-307-the-settings-service-could-2':
    'E-307: 设置服务无法报告它的分区（%a1%）。/evolution policy set 需要当前修订号才能安全写入；运行 /evolution doctor 查看已挂载的服务。',
  'e-316-namespace-namespace-is-not':
    'E-316: namespace "%a1%" 未注册 —— 归属 %a2% 在本组合中未挂载，因此无法从这里写入它的参数。 /evolution params 会把那些行标为 \'unregistered\'.',
  'e-309-revision-conflict-you-sent':
    'E-309: 修订冲突 —— 你提交的是 %a1%，文档当前为 %a2%。请用 /evolution params --json 重新读取后重试。',
  'e-309-revision-conflict-message-Re':
    'E-309: 修订冲突 —— %a1%。请用 /evolution params --json 重新读取后重试。',
  'e-310-the-settings-service-refused':
    'E-310: 设置服务拒绝了这次写入：%a1% —— 归属插件的规则优先（跨字段成对约束，或只能收紧的上限）。/evolution params 会显示当前值。',
  // 0.9.0: the write-admission sequence's own refusals (tool-skill-manage/src/write-gates.ts).
  'e-317-skill-write-not-confirmed':
    'E-317: 技能 "%a1%" 未被%a2% —— 确认提示被拒绝或关闭，因此没有写入任何内容。每次创建与裸删除都会出现该提示；只有操作者要求时才重复调用。',
  'e-318-skill-write-without-a-read':
    'E-318: 本会话没有读取技能 "%a1%"，因此拒绝这次写入。请先用 `skill` 工具读取它（失败的读取不算），然后重复该写入。',
  'e-326-support-write-without-a-read':
    'E-326: 本会话没有读取技能 "%a1%" 的支撑文件 "%a2%"，因此拒绝这次写入。只读技能正文不算读过支撑文件；请先读取该文件（失败的读取不算），然后重复该写入。',
  // 0.12.0: the confirmation's own deadline (`skillWriteConfirm: 'timeout'`).
  'e-320-the-profile-home-is-not':
    'E-320: 本宿主没有报告 profile home，因此无法定位旧设置文档。/evolution migrate 读取 `<profile home>/settings.yaml.imported`；请在由 profile 启动的会话里运行。',
  // G5.12/U-4: the cross-field constraint the registry declares (params.ts) has one enforcement
  // point, and this is its message. The card shows the same relation before a save is attempted.
  'e-322-a-parameter-would-break-a':
    'E-322: %a1% 至少应为 %a2%，但这次写入把它设成 %a3%。未写入任何内容。',
  'e-321-no-io-provider-is':
    'E-321: 缺少数据读写组件 evolution-io，暂时读不到旧设置。请安装或启用 evolution-io 后重试。',
  'e-319-skill-write-confirm-timed-out':
    'E-319: 技能 "%a1%" 未被%a2% —— 确认提示在 %a3% 秒内无人应答，因此该写入被取消。没有人在场决定：把 `skillWriteConfirm` 设为 `auto` 可免提示直接写入，保留 `ask` 则一直等到有人应答，或提高 `skillWriteConfirmTimeoutSeconds`。',
  'e-323-subagent-channel-unavailable':
    'E-323: 审阅/维护代理不可用：程序缺少 subagents/agentPresets 服务，或当前运行方式不支持只读代理。审阅/维护会明确标为不可用，不会静默改在当前会话里跑。运行 /evolution doctor 查看原因。',
  'e-324-restricted-preset-unavailable':
    'E-324: 只读模式创建失败：%a1%。审阅/维护暂时不可用；运行 /evolution doctor 查看原因。',
  'e-325-host-data-plane-unavailable':
    'E-325: 页面拿不到平台连接（缺少 connection 服务），面板与审批不会注册。可改用 /evolution pending、approve、reject 命令完成同样的事；详情见 /evolution doctor。',
} as const)

/** One table key. */
export type EvolutionErrorId = keyof typeof EVOLUTION_ERRORS

/**
 * English column of the error table. Keys match {@link EVOLUTION_ERRORS}; a missing or
 * empty entry falls back to the authored Chinese, so partial translation is safe.
 */
export const EVOLUTION_ERRORS_EN: Readonly<Partial<Record<EvolutionErrorId, string>>> = Object.freeze({
  'e-305-this-invocation-carries-no':
    'E-305: This invocation carries no agent — `%a1%` requires a session-backed invocation (run it inside a GUI or CLI session).',
  'e-306-this-deployment-stages-foreground':
    'E-306: This deployment stages foreground writes, but `/evolution %a1%` cannot be replayed through the skill runner — there is nothing to stage. Run it in a session whose approval policy is \'never\', or set `stageForeground: false` on the evolution-approval row, then retry the command.',
  'e-301-approval-service-not-mounted':
    'E-301: Approval service is not mounted: pending writes cannot be listed or replayed. Mount the evolution-approval row (shipped with evolution-host/evolution-all) and run /evolution doctor to inspect mounted services.',
  'e-301-approval-service-not-mounted-2':
    'E-301: Approval service is not mounted. Next step: the evolution-approval row ships with evolution-host/evolution-all — run /evolution doctor to inspect mounted services.',
  'e-304-the-mounted-approval-service':
    'E-304: The mounted approval service predates this capability — reject the record instead.',
  'e-302-curator-service-not-mounted':
    'E-302: Curator service is not mounted. Next step: mount the evolution-curator row (evolution-host/evolution-all) and run /evolution doctor.',
  'e-305-the-invocation-agent-exposes':
    'E-305: The invocation agent exposes neither `followup` nor `inject` — %a1% has no delivery channel.',
  'e-306-this-deployment-stages-foreground-2':
    'E-306: This deployment stages foreground writes, but this invocation has no agent session — `/evolution restructure` would stage an unowned record. Run it inside a GUI or CLI session, or set `stageForeground: false` on the row, then retry the command.',
  'e-303-replay-service-not-mounted':
    'E-303: Replay service is not mounted. Next step: mount the evolution-replay row (evolution-host/evolution-all) and run /evolution doctor.',
  'e-307-the-settings-service-could':
    'E-307: The settings service could not report its partitions (%a1%). /evolution params requires the user layer to distinguish overrides from deployment values; run /evolution doctor to inspect mounted services.',
  'e-308-unknown-parameter-group-group':
    'E-308: Unknown parameter group "%a1%" — known groups: %a2%.',
  'e-311-no-settings-service-is':
    'E-311: No settings service is mounted, so there is no writable user layer. Mount the settings row (packages/settings/settings-file) and retry; this command never modifies cordis.yml — deployment values belong to the deployment. /evolution doctor lists mounted services.',
  'e-312-error-instanceof-Error-error':
    'E-312: %a1% — /evolution params lists the canonical ids.',
  'e-313-unknown-parameter-id-evolution':
    'E-313: Unknown parameter "%a1%" — /evolution params lists every registered id along with its tier and user layer.',
  'e-314-id-is-a-deployment':
    'E-314: "%a1%" is a deployment parameter (tier %a2%, owner %a3%) — it lives on the plugin or policy row in cordis.yml rather than being written from a session. /evolution params shows who can write each row.',
  'e-315-id-has-no-user':
    'E-315: "%a1%" has no user layer — owner %a2% does not publish a settings namespace, so this value stays in the deployment layer.',
  'e-307-the-settings-service-could-2':
    'E-307: The settings service could not report its partitions (%a1%). /evolution policy set requires the current revision number to write safely; run /evolution doctor to inspect mounted services.',
  'e-316-namespace-namespace-is-not':
    'E-316: namespace "%a1%" is not registered — owner %a2% is not mounted in this composition, so its parameters cannot be written from here. /evolution params marks those rows as \'unregistered\'.',
  'e-309-revision-conflict-you-sent':
    'E-309: Revision conflict — you submitted %a1%, while the document is currently at %a2%. Re-read with /evolution params --json and retry.',
  'e-309-revision-conflict-message-Re':
    'E-309: Revision conflict — %a1%. Re-read with /evolution params --json and retry.',
  'e-310-the-settings-service-refused':
    'E-310: The settings service refused this write: %a1% — the owning plugin\'s rules take precedence (cross-field paired constraints or tighten-only bounds). /evolution params shows the current values.',
  'e-317-skill-write-not-confirmed':
    'E-317: Skill "%a1%" (%a2%) was not confirmed — the confirmation prompt was declined or dismissed, so nothing was written. This prompt appears on every creation and bare deletion; repeat the call only when the operator asks for it.',
  'e-318-skill-write-without-a-read':
    'E-318: This session has not read skill "%a1%", so this write was refused. Read it with the `skill` tool first (a failed read does not count), then repeat the write.',
  'e-326-support-write-without-a-read':
    'E-326: This session has not read supporting file "%a2%" of skill "%a1%", so this write was refused. Reading the skill body alone does not count as reading the supporting file; read that file first (a failed read does not count), then repeat the write.',
  'e-320-the-profile-home-is-not':
    'E-320: This host did not report a profile home, so the legacy settings document cannot be located. /evolution migrate reads `<profile home>/settings.yaml.imported`; run it inside a profile-backed session.',
  'e-322-a-parameter-would-break-a':
    'E-322: %a1% must be at least %a2%, but this write sets it to %a3%. Nothing was written.',
  'e-321-no-io-provider-is':
    'E-321: The data read/write component evolution-io is missing, so legacy settings cannot be read right now. Install or enable evolution-io and retry.',
  'e-319-skill-write-confirm-timed-out':
    'E-319: Skill "%a1%" (%a2%) was not confirmed — the confirmation prompt received no response within %a3%s, so this write was cancelled. Nobody was present to decide: set `skillWriteConfirm` to `auto` to write without prompting, keep `ask` to wait until someone responds, or increase `skillWriteConfirmTimeoutSeconds`.',
  'e-323-subagent-channel-unavailable':
    'E-323: Review/maintenance agent is unavailable: the app is missing the subagents/agentPresets services, or the current runtime does not support read-only agents. Review and maintenance are explicitly marked unavailable and never silently fall back to running in the current session. Run /evolution doctor to inspect the cause.',
  'e-324-restricted-preset-unavailable':
    'E-324: Read-only mode creation failed: %a1%. Review and maintenance are temporarily unavailable; run /evolution doctor to inspect the cause.',
  'e-325-host-data-plane-unavailable':
    'E-325: The page cannot reach the platform connection (the connection service is missing), so panels and approvals are not registered. Use the /evolution pending, approve, and reject commands to perform the same actions; see /evolution doctor for details.',
})

/**
 * Japanese column of the error table, same key space and fallback as
 * {@link EVOLUTION_ERRORS_EN}.
 */
export const EVOLUTION_ERRORS_JA: Readonly<Partial<Record<EvolutionErrorId, string>>> = Object.freeze({
  'e-305-this-invocation-carries-no':
    'E-305: この呼び出しにはエージェントが含まれていません。`%a1%` にはセッションを伴う呼び出しが必要です（GUI または CLI のセッション内で実行してください）。',
  'e-306-this-deployment-stages-foreground':
    'E-306: このデプロイメントはフォアグラウンドの書き込みを一時保存しますが、`/evolution %a1%` はスキルランナー経由でリプレイできないため、一時保存できる内容がありません。承認ポリシーが \'never\' のセッション内で実行するか、evolution-approval 行に `stageForeground: false` を設定してから、コマンドを再試行してください。',
  'e-301-approval-service-not-mounted':
    'E-301: 承認サービスがマウントされていません。承認待ちの書き込みを一覧表示またはリプレイできません。evolution-approval 行（evolution-host/evolution-all に同梱）をマウントし、/evolution doctor を実行するとマウント済みのサービスを確認できます。',
  'e-301-approval-service-not-mounted-2':
    'E-301: 承認サービスがマウントされていません。次の手順：evolution-approval 行は evolution-host/evolution-all と共に提供されます。/evolution doctor を実行してマウント済みのサービスを確認してください。',
  'e-304-the-mounted-approval-service':
    'E-304: マウントされている承認サービスはこの機能の導入前のものです。代わりに該当レコードを却下してください。',
  'e-302-curator-service-not-mounted':
    'E-302: キュレーターサービスがマウントされていません。次の手順：evolution-curator 行（evolution-host/evolution-all）をマウントし、/evolution doctor を実行してください。',
  'e-305-the-invocation-agent-exposes':
    'E-305: 呼び出し元のエージェントが `followup` も `inject` も公開していないため、%a1% の配信チャネルがありません。',
  'e-306-this-deployment-stages-foreground-2':
    'E-306: このデプロイメントはフォアグラウンドの書き込みを一時保存しますが、今回の呼び出しにはエージェントセッションがないため、`/evolution restructure` を実行するとセッションの帰属先がないレコードが一時保存されてしまいます。GUI または CLI のセッション内で実行するか、行に `stageForeground: false` を設定してから、コマンドを再試行してください。',
  'e-303-replay-service-not-mounted':
    'E-303: リプレイサービスがマウントされていません。次の手順：evolution-replay 行（evolution-host/evolution-all）をマウントし、/evolution doctor を実行してください。',
  'e-307-the-settings-service-could':
    'E-307: 設定サービスがパーティションを報告できませんでした（%a1%）。/evolution params で上書き値とデプロイメント値を区別するにはユーザー層が必要です。/evolution doctor を実行してマウント済みのサービスを確認してください。',
  'e-308-unknown-parameter-group-group':
    'E-308: 不明なパラメータグループ「%a1%」（既知のグループ：%a2%）。',
  'e-311-no-settings-service-is':
    'E-311: 設定サービスがマウントされていないため、書き込み可能なユーザー層がありません。settings 行（packages/settings/settings-file）をマウントしてから再試行してください。デプロイメント値はデプロイメントに属するため、このコマンドは cordis.yml を一切変更しません。/evolution doctor でマウント済みのサービスを確認できます。',
  'e-312-error-instanceof-Error-error':
    'E-312: %a1%（/evolution params で正規の id を一覧表示できます）。',
  'e-313-unknown-parameter-id-evolution':
    'E-313: 不明なパラメータ「%a1%」（/evolution params で登録済みの各 id とその階層およびユーザー層を確認できます）。',
  'e-314-id-is-a-deployment':
    'E-314: 「%a1%」はデプロイメントパラメータ（階層 %a2%、所属 %a3%）であり、セッションから書き込むものではなく、cordis.yml のプラグイン行またはポリシー行に記述します。/evolution params で各行の書き込み可能な主体を確認できます。',
  'e-315-id-has-no-user':
    'E-315: 「%a1%」にはユーザー層がありません。所属先の %a2% が設定の名前空間を公開していないため、この値はデプロイメント層に留まります。',
  'e-307-the-settings-service-could-2':
    'E-307: 設定サービスがパーティションを報告できませんでした（%a1%）。/evolution policy set で安全に書き込むには現在のリビジョン番号が必要です。/evolution doctor を実行してマウント済みのサービスを確認してください。',
  'e-316-namespace-namespace-is-not':
    'E-316: namespace "%a1%" は未登録です。所属先の %a2% がこの構成でマウントされていないため、ここからそのパラメータを書き込むことはできません。/evolution params では該当する行が \'unregistered\' と表示されます。',
  'e-309-revision-conflict-you-sent':
    'E-309: リビジョンの競合：送信された値は %a1% ですが、ドキュメントの現在値は %a2% です。/evolution params --json で再読み込みしてから再試行してください。',
  'e-309-revision-conflict-message-Re':
    'E-309: リビジョンの競合：%a1%。/evolution params --json で再読み込みしてから再試行してください。',
  'e-310-the-settings-service-refused':
    'E-310: 設定サービスがこの書き込みを拒否しました：%a1%。所属プラグインのルール（フィールド間のペア制約、または引き締めのみ可能な上限）が優先されます。/evolution params で現在の値を確認できます。',
  'e-317-skill-write-not-confirmed':
    'E-317: スキル "%a1%" は%a2%されませんでした。確認プロンプトが拒否または閉じられたため、何も書き込まれませんでした。このプロンプトは新規作成および単純削除のたびに表示されます。操作者から求められた場合のみ再呼び出ししてください。',
  'e-318-skill-write-without-a-read':
    'E-318: このセッションではスキル "%a1%" をまだ読み取っていないため、今回の書き込みを拒否しました。先に `skill` ツールで読み取ってから（失敗した読み取りは対象外です）、再度書き込みを実行してください。',
  'e-326-support-write-without-a-read':
    'E-326: このセッションではスキル "%a1%" のサポートファイル "%a2%" をまだ読み取っていないため、今回の書き込みを拒否しました。スキル本文の読み取りだけではサポートファイルを読み取ったことになりません。先に該当ファイルを読み取ってから（失敗した読み取りは対象外です）、再度書き込みを実行してください。',
  'e-320-the-profile-home-is-not':
    'E-320: このホストが profile home を報告していないため、旧設定ドキュメントの場所を特定できません。/evolution migrate は `<profile home>/settings.yaml.imported` を読み取ります。プロファイルから起動されたセッション内で実行してください。',
  'e-322-a-parameter-would-break-a':
    'E-322: %a1% は少なくとも %a2% である必要がありますが、今回の書き込みでは %a3% に設定されています。何も書き込まれませんでした。',
  'e-321-no-io-provider-is':
    'E-321: データの読み書きコンポーネント evolution-io が不足しているため、現在旧設定を読み取れません。evolution-io をインストールまたは有効にしてから再試行してください。',
  'e-319-skill-write-confirm-timed-out':
    'E-319: スキル "%a1%" は%a2%されませんでした。確認プロンプトに %a3% 秒以内の応答がなかったため、この書き込みはキャンセルされました。判断する操作者が不在の場合は、`skillWriteConfirm` を `auto` に設定すると確認なしで直接書き込み、`ask` のままにすると応答があるまで待機します。または `skillWriteConfirmTimeoutSeconds` を増やしてください。',
  'e-323-subagent-channel-unavailable':
    'E-323: レビュー・メンテナンス用エージェントを利用できません：アプリに subagents/agentPresets サービスがないか、現在の実行方式が読み取り専用エージェントに対応していません。レビューとメンテナンスは明示的に利用不可と記録され、暗黙に現在のセッション内で実行へ切り替わることはありません。原因を確認するには /evolution doctor を実行してください。',
  'e-324-restricted-preset-unavailable':
    'E-324: 読み取り専用モードの作成に失敗しました：%a1%。レビューとメンテナンスは現在利用できません。原因を確認するには /evolution doctor を実行してください。',
  'e-325-host-data-plane-unavailable':
    'E-325: ページからプラットフォーム接続を取得できないため（connection サービスが不足）、パネルと承認は登録されません。代わりに /evolution pending、approve、reject コマンドで同じ操作を行えます。詳細は /evolution doctor を参照してください。',
})

/**
 * Render one table entry, substituting its interpolation slots, in the host's active
 * locale. The stable `E-3xx` code always leads the string; only the prose is localized.
 * @param id - the scenario key.
 * @param args - values for the entry's `%aN%` slots.
 * @returns the message text the call site used to spell out inline.
 */
export function errorText(id: EvolutionErrorId, args: Record<string, string | number> = {}): string {
  const locale = hostLocale()
  const column = locale === 'ja' ? EVOLUTION_ERRORS_JA : locale === 'en' ? EVOLUTION_ERRORS_EN : undefined
  const localized = column?.[id]
  const template = typeof localized === 'string' && localized !== '' ? localized : EVOLUTION_ERRORS[id]
  return template.replace(/%a(\d+)%/g, (_match, n: string) => String(args['a' + n] ?? ''))
}
