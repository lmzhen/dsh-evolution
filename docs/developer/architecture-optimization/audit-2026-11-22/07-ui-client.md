# 07 · 客户端/UI 与 host 接缝审计（HEAD 564431ac）

对象：`packages/evolution-ui/src/**`、`evolution-ui/tests/**`、`evolution-client-kit/src/**`、`evolution-merge-ui/src/**`（UI 层）、`evolution-activity/src/**` 的客户端半边、`evolution-host/src/**` 的客户端装配。平台权威：`D:\dsh\harness-rc3`（0.2.2-rc.3 客户端 + ui-slots/ui-renderer/ui-settings/ui-sidebar/ui-layout/ui-locale 实现）。只读；本文件是唯一写入。证据等级：确定 / 推断 / 未验证。

## 结论

- 计数：**P0 1 项 / P1 3 项 / P2·技术债 11 项**。另列平台接口对照 10 条（9 条与平台契约一致，1 条家族自造全局）。
- 最高价值 5 条：确认开关显示与行为相反（P0-1）；settings 座在 apply 时被捕获一次（P1-1）；数据页刷新失败静默保留旧表（P1-2）；diff/body 延迟读失败后无重试路径（P1-3）；merge decision 路由由 `body` 路径字符串推导（P2-1）。
- 未发现（已查证）：请求-取消错配的主路径漏洞（ticket 覆盖了两类读）；token/权限绕行（同源 cookie 由平台 admission 处理，见对照 8）；HMR 清空注册（全部走 `ctx.effect`，样式注入幂等）；i18n 截断/死键（`verify-i18n` 已含「每个 key 必须有生产读者」，实测绿，见覆盖）。
- 有意不打：纯风格、缺测试本身、依赖版本问题。

## P0

### P0-1 「批准前先确认」开关：界面显示 `auto`，实际一律走 `ask`（确定）
- 位置：`evolution-ui/src/panels/settings/PendingCard.ts:50-55`（`confirmModeFrom` 只读 seat 的 **user 层**，缺失即 `ask`）、`:98`（`props.confirmMode?.() ?? 'ask'`）、`history/client/index.ts:36-39`（初值 `ask`，订阅回调同样只喂 `.user`）。
- 平台证据：registry 默认是 `auto`——`evolution-approval/src/index.ts:253` `.default('auto')`、`evolution-approval/README.md:18`、`evolution-core/src/params.ts:255` 的 hint「默认直接执行（不打断批量批准）」，同一句 hint 也进了客户端卡片（`panels/settings/generated-params.ts:56-61`，namespace `evolution-approval` + `approvalConfirm`）。而 settings 卡渲染的是 seat 的 **value 层**（组合后值）：`@deepseek-ai/dsh-client-ui-settings` 的 `ConfigFormSnapshot` 定义 `value` = schema 解析后的 section、`user` = 原始用户层（rc3 `packages/client/ui-settings/src/client/config-form-types.ts:8-31`）。因此默认部署卡片的 select 显示「直接执行」（推断：依赖 Host 把 schema 默认折进 value；若 value 不含该键则显示空白 option，矛盾由「显示相反」降为「默认不生效」），点「批准」仍弹二次确认。
- 影响/触发：默认配置（未手改该 select）→ 每次批准多一次点击；同一屏上控件值与实际行为相反，且 `PendingCard.ts:32-34` 自己的注释写着「Absent ⇒ shipped default `auto`」，与 `:98` 的 `?? 'ask'` 自相矛盾。这是一条被文档化的默认开关在黑盒行为上不成立。
- 判据（确定性）：把 `approvalConfirm` 的 user 层清空，打开 Pending 卡看 select 显示「直接执行」，点批准出现「即将批准：…/确认批准」。

## P1

### P1-1 settings 座在 apply 时被捕获一次 ⇒ 显式「直接执行」不生效（代码确定，触发条件推断）
- 位置：`history/client/index.ts:33-42`：`const approvalForm = settingsSeat()?.get('evolution-approval')` 只在 apply 时取值一次，注释却自称 lazy；同一包的 settings 半边 `panels/settings/index.ts:72` 明确写「每渲染读一次，因为 seat 可能晚到」，两处约定相反。
- 平台证据：`configForms` 由 `@deepseek-ai/dsh-client-ui-settings` 提供（rc3 `ui-settings/src/client/config-form.ts:258` `super(ctx,'configForms')`），ui-settings-general 以 `inject` 依赖它（`ui-settings-general/src/client/index.ts:77`）；家族 bundle 的 `inject=['slots','locale','layout']`（`history/client/index.ts:23`）**不等待** ui-settings。bundle 先激活时 `approvalForm` 永远 `undefined`，订阅永不建立 → 用户改了参数也不影响本会话（要刷新页面）。
- 第二机制：即使订阅成功，`approvalConfirmMode` 只是普通变量（`:36`），不触发 React 重渲染；PendingCard 只在自身状态变化时重读，故「改设置→立刻生效」不成立。
- 修的方向见「更优实现 1」。

### P1-2 数据总览刷新失败：旧表当新表展示（确定）
- 位置：`evolution-ui/src/panels/history/client/StatsPage.ts:65-76`。刷新（`statsRevision` 变化）失败时 `catch` 里 `current.status === 'ready' ? current` 直接保留旧快照，**不置失败态、不出提示**；同文件 `:279-281` 的 `stats.failed` 只在首次加载失败时可达。
- 触发：历史面板「刷新」→ `invalidateStats()`（`Workbench.ts:117-121`）→ stats 重读遇 401/403/5xx 或宿主重启窗口。此时表格、`totals`、失败率都是旧值，读者无法区分「没变」和「没读到」。
- 平台对照：同仓的 `DiagnosticsCard.ts:196-215` 对同一风险已有正确做法（`refreshFailure` 常驻 strip + 重试）。这两处对「后台刷新失败」用了两套语义。

### P1-3 延迟读（diff/body）失败后无重试入口（确定）
- 位置：`history/client/skills/useSkillHistory.ts:247-252`。`toggle` 在 `diffs.has(v) / bodies.has(v)` 时直接 return，而失败态 `{kind:'failed'}` 也写进同一 Map（`:137/:263`）；`dropIfTicket`（`:305-308`）再从缓存删条目时，展开区直接空白（`expandedOf` 返回 null）。
- 影响/触发：一次网络抖动/超时后，该版本行的展开永久停在失败文案；`refresh()` 走 `keepContent=true` 不清缓存（`:157-171`），只有「重开另一个 skill 再回来」或整页刷新才恢复。
- 判据：stub `loadDiff` 首次 reject、第二次 resolve，点开同一行两次——第二次不会发请求（可直接用现有 spec 的 stub 计数复现）。

## P2 / 技术债 / 屎山

- **P2-1 merge 唯一写路由靠字符串手术推导（确定）**：`evolution-merge-ui/src/client/api.ts:230` `HOST_ROUTES.body.replace(/body$/, 'decision')`；host 端同样自行拼：`evolution-merge/src/merge-routes.ts:20` `MERGE_BASE + 'decision'`。core 的 `HOST_ROUTES.merge`（`evolution-core/src/http-routes.ts:87-94`）只有 view/rows/run/runs/body/history，**没有 decision**，可 approval 面却有 approve/reject/release（`:68-74`）。后果：`body` 路径一改，客户端 POST 落到 404，且被 `wire-version` 归类（`api.ts:238`）而不是「路由不存在」。`verify-host-routes` 实测输出「no … hand-copied paths」，说明门禁看不见 `.replace` 派生（已现场跑过）。
- **P2-2 座位几何门禁对真实注册点零命中（确定，实测）**：`node packages/scripts/verify-client-seats.mjs packages --upstream D:\dsh\harness-rc3 --strict` 输出 `4 parameterized seat(s) on the platform line, 0 occupant(s) judged, 0 seat row(s)`。原因：扫描只走 `<pkg>/src/client/**` 的 `name: '<seat>'` 字面（`verify-client-seats.mjs:331-365`），而家族实际注册全部经 `registerSurface`/`registerSidebarPanel`，icon 在 `panels/**`。平台侧真有 4 个传参座位（`ui-sidebar/src/client/SidebarRoot.tsx:92` 传 `{id,size,active}` → `PanelIcon.tsx:11`；`ui-settings/src/client/contract/slots.ts:134-145` 传 `{close}` / `{size,active}`）。这正是脚本自己 `:313-328` 警告的「匹配不到即假绿」。
- **P2-3 configForms 手抄座形状带了平台不存在的字段（确定）**：`client-kit/src/seam.ts:60-95` 声明 `status/value/base/user/writable/revision` 之外还有 `save?/refresh?/dispose?`、`ConfigWriteKind='conflict'|'validation'|'transport'`、snapshot 的 `reason/stale`；平台只有 `getSnapshot/subscribe/mutate/set/unset` 与 6 个快照字段（rc3 `config-form-types.ts:8-74`）。后果是死 UI/死分支：`settings/source.ts:33-34` 的 `reason` 永远退成 `not-served`（「seat 缺失 / 投影失败」两类文案不可达）、`ParamCard.ts:455` 的 `readbackStale` 永不出现、`ParamCard.ts:429-432` 的 `saveOnce/readback:'failed'` 生产端从不传（`SettingsPage.ts:45-50` 只给 `state+mutate`）。建议删到平台真有的字段，另用一次编译期 parity 断言防漂移（同仓 `gen-client-seam.mjs --check` 已有先例）。
- **P2-4 `panelWorkspaceId` 读不存在的服务形状（确定）**：`client-kit/src/workspace.ts:12-29` 依次取 `ctx.get('workspace'|'uiWorkspace').workspaceId ?? currentWorkspaceId`。平台 rc3 里 `UiWorkspace` 是 `uiWorkspace` 服务且只暴露 openSession/openWorkspace/connectWorkspace/startSession/… 没有任何 workspaceId 字段（`ui-workspace/src/client/navigation.ts:39-146`），名为 `workspace` 的服务也没有。于是恒为 `undefined` → `resolveWorkspaceId` 恒 `local`（`evolution-merge-ui/src/client/sorting.ts:12-18`），merge 的手动排序在所有工作区之间共用、`MergeFace.workspaceId` 永不出现；而且它在 face 构造时取一次，切工作区也不刷新。平台同题的正确取法（当前 session 的 `cwd` → `workspaces.list` 匹配）在 `ui-workspace/src/client/tree.ts:40` 有现成写法。
- **P2-5 隐藏视图照常打 host 读、还挂 window focus 监听（确定）**：workbench 把 merge 视图常驻挂载只是 `hidden`（`Workbench.ts:221`），`Panel.ts:218-227` 在挂载后无条件 `store.start()` 并对 `window focus`/`visibilitychange`/自定义事件 `refresh()`。用户停在「历史」页时每次切回窗口都会发 view+rows 两个读，再加 PendingCard 自己 focus 重读两路 pending（`PendingCard.ts:154-164`）——一次焦点 4 个 host 请求。机制上 `hidden` 不会停 effect；`Workbench.ts:221` 已经把 `activeView` 传给了 MergeView，只是没当门用。
- **P2-6 load-more 失败清空已显示行（确定）**：`evolution-merge-ui/src/client/MergeStore.ts:137-156`，`keepRows` 只对 `cursor === undefined` 成立；翻页失败走 `{status:'error', rows:[]}`，把前几页一起丢掉，且 `Panel.ts:298` 因 `queue.status !== 'ready'` 整块列表消失。正确形态是保留 rows 并单独挂 `failure`（同函数 refresh 分支已经这么做）。
- **P2-7 merge 视图存在性非响应式 + 第二次手写 merge 解析（确定）**：`history/client/index.ts:44-49` 的 `hasView` 每次调用现读 `ctx.slots.entries('evolution.workbench.view')`，不订阅 ledger；`Workbench.ts:109` 在渲染期用它决定 merge tab 是否出现。若 merge-ui 客户端晚于工作台首帧注册，tab 缺失直到某次偶然重渲染（切 tab/切语言）。同一处 `:65-79` 又用裸 `fetch` + 手写 `counts.active.pending` 解析再算一遍落地页计数，与 merge-ui 的 `api.view()`（有 wireVersion 校验）构成两份契约解析。
- **P2-8 品牌/警告色绕过主题 token（确定）**：`--evo-accent`/`--evo-accent-weak`/`--evo-warn`/`--evo-radius-card` 全仓 0 定义（`tokens.ts` 的 29 个属性里没有，`verify-client-tokens` 只核已声明项故放行），实际生效的是 fallback 字面量：`client-kit/src/data-table.ts:96,101`、`evolution-ui/src/panels/history/client/StatsPage.ts:308,312,318-319,329,345,353`。另有整段写死色：`StatsPage.ts` 的 `#fff/#20261f/#fbf0e7/#b26a3c/#fbf6f2/#a5482b` 等（`:307-360`），不随平台 dark/skin 变；平台对应 token 都在（`ui-theme/src/styles/design-platform.css:418-419` 有 dark 覆盖，`--dsw-alias-brand-primary`、`--dsw-alias-state-warn-primary` 均已定义）。`tokens.ts:9` 注释还举例了并不存在的 `--evo-group-name`。
- **P2-9 撤销成功后重读失败被报成「已重新载入」（确定）**：`useSkillHistory.ts:227-233`，`showVersions(name, onFailure)` 的 `onFailure` 清掉 failure 并 `setNoteText(t('undo.reloaded'))`；此时行仍是撤销前数据，读者看到的是「成功 + 没变化」。既然写结果要保留，至少应显示「已撤销，列表重读失败」这类组合句。
- **P2-10 一个 `readTicket` 管三类读 ⇒ 刷新与展开互相作废，展开空白（确定）**：`useSkillHistory.ts:130/157/255` 共用同一 ticket 计数。先展开某行（ticket N+1）再点刷新（ticket N+2）→ 展开回复按 `dropIfTicket` 丢掉，该行 `expandedOf` 返 null，读者需要再点一次（第一次点击是收起）。按 (skill, v, kind) 分 ticket 即可根治，同时解决 P1-3 的失败缓存边界。
- **P2-11 死契约/死常量（确定）**：`client-kit/src/panel.ts:34-36` 的 `SidebarPanelSpec.children/store` 与 `seam.ts:56-63` 的 `PanelBodyOptions`（不含 children/store）不一致——真实注册靠对象展开绕过 tsc（`panel.ts:64-70`），且 `store` 全仓无调用方；`history/client/ids.ts:1` 的 `PANEL_ID='skill-history'` 无人引用（注册用的是 `WORKBENCH_ID='evolution.workbench'`）；`history/client/index.ts:95-103` 的 stats face 五个字段（`view/onView/layout/openSkill/onOrganize`）在 `Workbench.ts:209-220` 全部被覆盖，属必填假面。巨型/重复：`useSkillHistory.ts` 351 行把 5 种状态机揉在一起；生成物与手写同目录（`panels/settings/generated-param-i18n.ts` 1302 行、`generated-params.ts`、`generated-about.ts`）而 kit 的生成物统一在 `src/generated/`，两套放置约定。

## 平台接口对照

1. `sidebar.panellist` 图标座：平台传 `{size, active}`（rc3 `ui-sidebar/src/client/SidebarRoot.tsx:92` → `PanelIcon.tsx:11`）；家族 `WorkbenchIcon` 两者都用（`Workbench.ts:228-232`），settings 的 `SectionIcon` 只吃 `size`、忽略 `active`（`panels/settings/index.ts:118`）——契约允许，但选中态字形不会变化。
2. `settings.section` / `.icon`：owner props `{close}` / `{size,active}`（rc3 `ui-settings/src/client/contract/slots.ts:134-145`）；家族组件签名 `{close?}` 兼容（`settings/index.ts:76-90`）；`label` 传 thunk `() => t('title')` 正确——设置壳每次投影用 `resolveSlotLabel` 解析并随 locale revision 重建（rc3 `ui-settings-general/src/client/index.ts:161-186,173`）。
3. `main` keyed 座：`{kind:'keyed', scope:'root'}`（rc3 `ui-layout/src/client/index.ts:75`）；家族同 id 注册 main 且声明子座 `evolution.workbench.view`，与平台「声明即占有」一致（rc3 `ui-slots/src/index.ts:1176-1208`）。
4. `slots.inject` 回调：平台接受 disposer 或 `Iterable<() => void>`（rc3 `ui-renderer/src/client/registry.ts:116-117,242`）；家族统一 `function* () { yield register(...) }` 合法，且声明消失即回卷，HMR 安全。
5. locale：`register(ns, dicts)` / `bind(ns)` / `getLocale().active` 与平台一致（rc3 `client/locale/src/client/index.ts:403,459,205`）；切语言时每个 slot outlet 强制重渲染（rc3 `ui-renderer/src/client/scoped-slots.tsx:1333-1335`），所以家族自持 `t` 也能换文案——无需再订阅 locale。
6. `configForms`：`get(entryId)` 恒返回表单（rc3 `ui-settings/src/client/config-form.ts:284-293`），无 `save/refresh/dispose`，快照无 `stale/reason`（见 P2-3）。
7. 平台 Modal/Menu 原语经 `require('@deepseek-ai/dsh-client-ui-primitives')` 取：导出名与 props 都匹配（rc3 `ui-primitives/src/index.ts:35-37,49`；`MenuSurfaceProps extends div`、`MenuItemButtonProps` 见 `MenuSurface.tsx:13-18`、`Menu.tsx:47-75`）——`PLATFORM_MENU`（`presentation/action-menu.ts:75-85`）与 `platformModal()`（`evolution-merge-ui/src/client/platform-modal.ts:20-29`）只在 deployment 缺行时降级，正确。
8. 鉴权：家族客户端全部裸 `fetch('/api/dsh-evolution/…')`（`history/client/api.ts:196-203`、`settings/api.ts:82-89`、`merge-ui/api.ts:112-160,229-237`）。平台 browser 鉴权是 **同源 cookie**（`dsh-auth-*`）+ Fetch-Metadata 的 same-origin 校验（rc3 `client/connection/src/browser-auth.ts:17-41`、`api-request-trust.ts:143-148`），裸同源 fetch 默认带 cookie 且 same-origin POST 的 Origin 合规，故可用——这是「依赖平台隐式契约」，建议在 seam 注释里写明（“admission 由平台 connection 承担，客户端不添加任何 header”），否则未来平台改成显式 token 时会一次性全红。
9. 模块系统：家族 build 自注入 `globalThis.__dshClientRequire = require`（`packages/scripts/build-client.mjs:44-56`）。平台只承诺 factory 的 `require` 参数（rc3 `client/tsdown.client.ts:941` 的 banner），`__dshClientRequire` 是家族发明的全局；`require('@deepseek-ai/dsh-client-ui-primitives')` 能通是因为它在平台 seed 表里（rc3 `client/web/src/platform.ts:8-15`）。HMR 下后物化 bundle 会覆盖该全局（各 bundle 的 require 等价，暂不出错），属 P2 债：把 require 传成模块局部变量（`platform-ui.ts` 接收 require）即可去掉全局。
10. `sessions` 读法：`ctx.sessions.list.getSnapshot().byId[].retainedBy.mainView` 与平台自己找「主视图 session」的写法一致（rc3 `ui-session/src/client/index.ts:460-475`、`ui-layout/src/client/DocumentTitle.tsx:21`）；merge 的 `decide` 因此只在「有主视图 session」时可用，与平台语义一致（`evolution-merge/src/merge-routes.ts:149-153` 要求 sessionId）——不列为缺陷。

## 同一功能更优实现（机制，不是口号）

1. **确认门单一来源**：`confirmMode` 改为 `() => seat()?.get('evolution-approval')?.getSnapshot().value?.approvalConfirm === 'auto' ? 'auto' : 'ask'`，seat 每次现取（照 `settings/index.ts:72` 的写法），并在 Workbench 注册时把这个 reader 放进 face；用 `useSyncExternalStore(form.subscribe, form.getSnapshot)` 在 PendingCard 里订阅，订阅值变化才触发重渲染。删掉 PendingCard 的 `?? 'ask'` 双重默认：缺省 = registry 默认（auto），只有 seat 明确给出 `ask`/未知值才问。
2. **延迟读的可恢复错误态**：缓存命中判据从 `has(v)` 改成 `state?.kind !== 'failed'`；`toggle` 在 failed 时 `ticket=++ticket` 重发；展开区自身渲染「重试」按钮（`DiffBody` 已有 face，直接 `onToggle` 再调一次即可）。
3. **ticket 分域**：`rowsTicket` / `lazyTickets: Map<'diff'|'body', Map<v, ticket>>`，或按 `(skill, v, kind)` 生成字符串键存 `Map`；刷新只 bump rows，展开只作废同键。顺手把 `useSkillHistory` 拆成 `useRows` + `useLazyReads` 两个 hook（<150 行/个），保持 props 形状不变。
4. **隐藏即停工**：`MergeView`（`evolution-merge-ui/src/client/index.ts:17-19`）已经有 `activeView`，把 `start()/refresh()` 与两个监听都包在 `activeView === 'merge'` 的 effect 里；`Panel` 不再自带 focus 重读，改由 `activeView` 变 true 时 `store.refresh()`。这样 workbench 首屏 0 个 merge 请求。
5. **decision 进表**：`HOST_ROUTES.merge.decision = '/api/dsh-evolution/merge/decision'` 写进 core，`gen-client-seam` 重生成客户端，删掉两处 `replace/拼接`；`verify-host-routes` 增加规则「客户端源码不得对 `ROUTES.*` 做字符串替换/拼接，只许整键引用」，并以 merge decision 作负例 drill。
6. **工作区作用域**：排序 key 用 `sid:<currentSessionId>` 或 `cwd:<workspacePath>`，来源照平台 `tree.ts:40`（sessions+workspaces 组合），并订阅 `sessions.list`/`workspaces.list`（`useSyncExternalStore`）在 face 里暴露实时 `workspaceId`；若短期不做，就把 key 降到 `queue+expired` 并在设置里说明是全局排序，别保留假 scope。
7. **刷新失败可见**：StatsPage 复刻 `DiagnosticsCard` 的 `refreshFailure` strip（常驻、带重试、不清旧表），并在 `page` 顶部一行 `role=status`；与 PendingCard 的 `notice` 语义统一成「成功句 / 拒绝句 / 失败句」三种，不再用同一个 `evolution-param-error` 样式。
8. **动态键回退统一**：merge 行里的 `t('action.'+id)` / `t('stage.state.'+state)` / `t('verify.'+…)` 全部走 `MergeRow.ts:18-22` 已有的 `reasonText` 同款（`t(key)===key ? fallback`）；更好的做法是让 host 在 wire 里给出 `labelKey` 并校验属于白名单（core 的 `skill-row-cells` 已经这么做了），客户端只翻白名单键。
9. **座门禁跟着注册入口走**：`verify-client-seats` 改为解析 `registerSidebarPanel/registerSurface` 的 `icon`/`component` 实参与 `panels/**`，对平台 4 个传参座逐一判 occupant；drill 用「给 `WorkbenchIcon` 注入固定 26px 盒子」必须红来证明不是空转。
10. **宿主契约减半**：`seam.ts` 只留平台真有的 6 个快照字段 + 5 个方法；把 `reason/stale/save/readback` 相关 UI 与分支删除（涉及 `source.ts:33-34`、`ParamCard.ts:26,330-331,429-432,455`、`seam.ts:60-101`）。若确要「读回失败」能力，就把它做成对平台 `mutate` 返回值 + 一次 `getSnapshot().value` 的本地判定，而不是假设 seat 会给出 `readback`。

## 覆盖清单

- 逐字读完：`evolution-client-kit/src`（除 4 个 generated i18n 大文件）、`evolution-ui/src` 全部（含 settings/history 两半）、`evolution-merge-ui/src/client` 全部、`evolution-activity/src` 全部、`evolution-host/src`（`index.ts` 仅 `export {}`，客户端装配在 `cordis.patch.yml`/各包 `dsh.client`，已核对 manifest 格式与平台 `ui-schedule/package.json` 一致）。
- 跳读/抽样：4 个 generated i18n（1590/1478/1054/662 行）只查 key 集/复数 `.one`/抽样英文；`evolution-ui/tests`（25 个 spec）与 `evolution-merge-ui/tests`（25 项，含 api/store/panel/focus/lifecycle/locale/sorting/platform-menu）按文件名与关键断言抽读，未逐行。
- 平台对照读实现：`ui-slots/src/index.ts`、`ui-renderer/src/client/{registry,scoped-slots}.tsx`、`ui-sidebar/src/client/{SidebarRoot,PanelIcon}.tsx`、`ui-settings/src/client/{config-form-types,config-form,contract/slots}.ts`、`ui-settings-general/src/client/index.ts`、`ui-layout/src/client/{index,AppFrame,DocumentTitle}.tsx`、`ui-session/src/client/index.ts`、`client/locale/src/client/index.ts`、`client/modules/src/client/{system,manifest}.ts`、`client/web/src/platform.ts`、`client/tsdown.client.ts`、`client/ui-primitives/src/{index,MenuSurface,Menu}.tsx`、`client/connection/src/{browser-auth,api-request-trust}.ts`。
- 现场跑的门禁（只读，全绿）：`verify-client-seats packages --upstream D:\dsh\harness-rc3 --strict`（但 0 occupant，见 P2-2）、`verify-client-ui-i18n`、`verify-client-tokens`、`verify-i18n`（587 UI key / 8 语言）、`verify-host-routes`（20 端点，但仍漏 decision 派生，见 P2-1）。
- 未覆盖/未验证：`evolution-skill-health` 客户端（不在本轮范围）；merge 事务语义（另单）；host route 业务实现（只读契约）；真机点击/截图（本轮只读审计，无 GUI）；HMR 实际重载未跑（P1-1 的触发条件、对照 9 的全局覆盖均为推断）；`activity` 无浏览器半边，只有 host 侧 5 个模块，客户端消费点仅经 host 路由的 `getFeedback/getReviews`。
