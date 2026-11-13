/**
 * Release-lane runnable checks: pack/audit/evidence/probe coverage and the packed-install smokes.
 *
 * Data only: ids are FROZEN (see W10 §16.3) — never renumber, never derive from position.
 * `title` is the human Command column text; `argv` is the executable form (null = registered cannot-decide).
 */
import { gate } from './helpers.mjs'

export const release = [
  gate("gate-16", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-profile-bundles.mjs --self-test`",
    argv: ["node","packages/scripts/verify-profile-bundles.mjs","--self-test"],
    lanes: ["local","ci-release","ci-windows"],
  }),

  gate("gate-27", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-platform-ranges.mjs --manifest-dir packages/evolution/.release-staging`（**发布期**：每个 staged manifest 的 `@deepseek-ai/dsh-*` 必须逐字等于 platform-line.json 派生的 peers 范围、`engines.dsh` 必须等于 engines 窗口；vendored 范围由 `lib-vendored-ranges.mjs` 单源钉住；同时打印双谓词窗口网格两表读数 ✓）",
    argv: ["node","packages/scripts/verify-platform-ranges.mjs","--manifest-dir","packages/evolution/.release-staging"],
    lanes: ["local","ci-release"],
  }),

  gate("gate-48", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-check-registry.mjs packages --strict`（七轴总账：闭包／可执行性／到期／**mutation 覆盖（读 reports/mutation-coverage.json 的签名台账，6 探针逐条）**／**生产者接线（每条 check.requires 的 producer 必须有 manifest 行或 CI action 执行）**／真空证伪／占位符——在册的轴计数与实测不符即红，闭包破了即红）",
    argv: ["node","packages/scripts/verify-check-registry.mjs","packages","--strict"],
    lanes: ["local","ci-release"],
  }),

  gate("gate-49", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-mutations.mjs --coverage`（G5/1 变异库：每条 check 需 `checkMutations` 记录，缺／残 ⇒ cannot-decide；`--only <id>` 现场打补丁→跑→断言语义→还原并校验哈希；`--self-test` 必须抓出等值 mutation 与矛盾期望，抓出即 **exit 0**；`--probes [--only <probe>] [--list] [--ledger <path>] [--no-stamp]` 逐条执行 `probes.json` 的 mutation fixture：快照→应用→探针必红→还原校验→写 `reports/mutation-coverage.json` 签名台账）",
    argv: ["node","packages/scripts/verify-mutations.mjs","--coverage"],
    lanes: ["local","ci-release"],
    registration: {"reason":"the mutation ledger is still being filled: 29 of 109 checks carry a proven red record","owner":"scripts/gates","expiry":"0.47.0","plan":"close records per check; coverage exits 0 once every check is proven","renewal":"Renewed at 0.46.0 (expiry 0.47.0): the row judges the build line/CI tree (platform typecheck, full suite, built entries, coverage records, health corpora) and the local overlay cannot supply those inputs; the CI action executes the same check. Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the axis rows' reduction lands with the gate-table split / probe-baseline work tracked in W9-gates §4, scheduled before 0.47."},
  }),

  gate("gate-56", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-release-evidence.mjs packages/evolution/dist/release-evidence.json`（W2/W3/W10/W11 发布证据：schemaVersion=2、platformLine 与 platform-line.json 逐字、manifests 范围一致；`--release` 时另要求 ciFace/gates/S1–S4 全 pass/52 项 traceability 全覆——blocked 不算 pass。缺文件/不可解析→**exit 2**）",
    argv: ["node","packages/scripts/verify-release-evidence.mjs","packages/evolution/dist/release-evidence.json"],
    // Release-phase only: it judges a packed staging/dist artifact the local dev line does not have.
    // pre-tag still runs it through the ci profile (pre-tag = local ∪ ci).
    lanes: ["ci-release"],
  }),

  gate("gate-57", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/assemble-release-evidence.mjs packages/evolution/dist/release-evidence.json --rehearsal packages/evolution/scripts/release-evidence-rehearsal.json --gates-from-manifest ci --ci-face ci --os ci`（W3/W10 发布证据装配：把 pack 写出的 schema-2 骨架与本仓演练快照（S1–S4 spike 证据 + W11 52 项 traceability）合并，并写入 CI face 与本次 compat-check 已执行的 gate 台账；`--release` 在 publish 前复验；缺输入/不合格→exit 1/2）",
    argv: ["node","packages/scripts/assemble-release-evidence.mjs","packages/evolution/dist/release-evidence.json","--rehearsal","packages/evolution/scripts/release-evidence-rehearsal.json","--gates-from-manifest","ci","--ci-face","ci","--os","ci"],
    // Release-phase only (needs the packed evidence skeleton); pre-tag keeps it via the ci profile.
    lanes: ["ci-release"],
  }),

  gate("gate-59", {
    kind: "script",
    tree: "overlay",
    title: "node packages/evolution/scripts/audit-release-tarballs.mjs packages/evolution/dist --version \"${RELEASE_VERSION#v}\" --platform-range \"^$RANGE\"",
    argv: null,
    lanes: ["local","ci-release"],
    argvProblem: "no-command-in-cell",
    registration: {"reason":"the gate table cell states the step in prose or carries a placeholder the runner cannot resolve","owner":"scripts/gate-manifest","expiry":"0.47.0","plan":"split each prose cell into a real argv row (or give the row an args source); rows that stay unresolvable keep the registration","renewal":"Renewed at 0.46.0 (expiry 0.47.0): the row is a prose table cell with no single argv; splitting the table into executable rows is one mechanical pass over CONTRIBUTING that this release did not include. The count is unchanged; the reduction is the split, not a per-row fix. Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the axis rows' reduction lands with the gate-table split / probe-baseline work tracked in W9-gates §4, scheduled before 0.47."},
  }),

  gate("gate-74", {
    kind: "script",
    tree: "overlay",
    title: "node packages/evolution/scripts/smoke-packed-install.mjs packages/evolution/dist --assets-only",
    argv: null,
    lanes: ["local","ci-release","ci-windows"],
    argvProblem: "no-command-in-cell",
    registration: {"reason":"the gate table cell states the step in prose or carries a placeholder the runner cannot resolve","owner":"scripts/gate-manifest","expiry":"0.47.0","plan":"split each prose cell into a real argv row (or give the row an args source); rows that stay unresolvable keep the registration","renewal":"Renewed at 0.46.0 (expiry 0.47.0): the row is a prose table cell with no single argv; splitting the table into executable rows is one mechanical pass over CONTRIBUTING that this release did not include. The count is unchanged; the reduction is the split, not a per-row fix. Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the axis rows' reduction lands with the gate-table split / probe-baseline work tracked in W9-gates §4, scheduled before 0.47."},
  }),

  gate("ci-only-01", {
    kind: "script",
    tree: "overlay",
    title: "node packages/evolution/scripts/audit-release-tarballs.mjs packages/evolution/dist --version \"${RELEASE_VERSION#v}\" --platform-range \"^$RANGE\"",
    argv: ["node","packages/evolution/scripts/audit-release-tarballs.mjs","packages/evolution/dist","--version","\"${RELEASE_VERSION#v}\"","--platform-range","\"^$RANGE\""],
    lanes: ["ci-release"],
    reason: "payload audit of the packed dist — only meaningful after prepare-release has staged the release job's inputs",
    owner: "ci",
  }),
]
