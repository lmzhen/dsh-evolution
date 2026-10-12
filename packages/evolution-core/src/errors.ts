/**
 * THE error-code table: E-301…E-322 with the exact text each one emits (E-317…E-319 are the
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
  // 0.12.0: the confirmation's own deadline (`skillWriteConfirm: 'timeout'`).
  'e-320-the-profile-home-is-not':
    'E-320: 本宿主没有报告 profile home，因此无法定位旧设置文档。/evolution migrate 读取 `<profile home>/settings.yaml.imported`；请在由 profile 启动的会话里运行。',
  // G5.12/U-4: the cross-field constraint the registry declares (params.ts) has one enforcement
  // point, and this is its message. The card shows the same relation before a save is attempted.
  'e-322-a-parameter-would-break-a':
    'E-322: %a1% 至少应为 %a2%，但这次写入把它设成 %a3%。未写入任何内容。',
  'e-321-no-io-provider-is':
    'E-321: 没有挂载 evolution-io 提供方，因此无法读取旧设置文档。请挂载 evolution-io 行（evolution-host/evolution-all）后重试。',
  'e-319-skill-write-confirm-timed-out':
    'E-319: 技能 "%a1%" 未被%a2% —— 确认提示在 %a3% 秒内无人应答，因此该写入被取消。没有人在场决定：把 `skillWriteConfirm` 设为 `auto` 可免提示直接写入，保留 `ask` 则一直等到有人应答，或提高 `skillWriteConfirmTimeoutSeconds`。',
} as const)

/** One table key. */
export type EvolutionErrorId = keyof typeof EVOLUTION_ERRORS

/**
 * Render one table entry, substituting its interpolation slots.
 * @param id - the scenario key.
 * @param args - values for the entry's `%aN%` slots.
 * @returns the message text the call site used to spell out inline.
 */
export function errorText(id: EvolutionErrorId, args: Record<string, string | number> = {}): string {
  return EVOLUTION_ERRORS[id].replace(/%a(\d+)%/g, (_match, n: string) => String(args['a' + n] ?? ''))
}
