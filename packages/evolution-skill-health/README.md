# @deepseek-ai/dsh-evolution-skill-health

技能健康面板：把体检引擎（`evolution-core` 的 skill-lint／skill-health）的结论**按规则聚合**呈现，
让"哪条规则在哪些技能上出现、本次改动新引入了什么"一眼可见。**只读**：不写任何技能、不改任何配置。

## 座位与注册（照 `evolution-skill-history` 的成例）

- 侧栏行：`ctx.slots.inject('sidebar.panellist', …)` ＋ `slots.register({ name: 'sidebar.panellist', id, order, label: () => … })`；
  `label` 必须是 **thunk**（跟语言切换走 ✓），`order` 取 40 一带（与技能历史相邻 ✓）；`sidebar.panellist` 是**列表座位** ⇒ 多个面板可并存 ✓。
- 主区：`slots.register({ name: 'main', key: <同一个 id>, inject })` —— **同一个 id 注册两次**，这是本家族面板的既定契约 ✓。

## 数据来源与边界

- **数据**：只经只读通道取引擎结论（`healthView()` 一类的**全量行**：`{ name, verdict, dims, findings }` ✓；读不到的技能以 `unreadable-skill` 呈现，**不沉默** ✓）。
- **呈现**：总览四态（ok／warn／error／不可读）＋ **按规则聚合**的清单 ＋ 与技能历史／技能目录的交叉跳转；
  `line: …`／`line: UNKNOWN` 两态要写清（未知就是未知 ✓）。
- **不上屏**：**未标定**的阈值（如 `SUPPORT_SPRAWL_FILES`）**只报规则名、不报数字** ✓ —— 口径冻结之前不许把数字给读者 ✓。
- 客户端半**不得** import 其它插件的值/类型 ⇒ 只声明自己消费的座位形状（见 `evolution-settings-ui/src/client/seam.ts` 的头注释 ✓）。

## 当前状态

**占名已发布**（npm `@lmzhen/dsh-evolution-skill-health`，占位版本 `0.0.0-stage` ✓）；本包的 `src/` 内容随后补齐，
**首次真实内容必须发更高版本** ✓（"已发布只能抬版本"）。
