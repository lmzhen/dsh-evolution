/**
 * Release-lane runnable checks: pack/audit/evidence/probe coverage and the packed-install smokes.
 *
 * Data only: ids are FROZEN (see W10 §16.3) — never renumber, never derive from position.
 * `title` is the human Command column text; `argv` is the executable form (null = registered cannot-decide).
 */
import { gate } from './model.mjs'

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
    // Release-only product: .release-staging exists only after pack. In CI the family tree is the
    // workspace checkout and the artifact lives under upstream/, so the override runs there.
    lanes: ["ci-release"],
    after: ["gate-16", "gate-74"],
    ci: { cwd: "upstream", argv: ["node","packages/evolution/scripts/verify-platform-ranges.mjs","--manifest-dir","packages/evolution/.release-staging","--our-scope","$NPM_SCOPE"] },
  }),

  gate("gate-48", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-check-registry.mjs packages --strict`（七轴总账：闭包／可执行性／到期／**mutation 覆盖（读 reports/mutation-coverage.json 的签名台账，6 探针逐条）**／**生产者接线（每条 check.requires 的 producer 必须有 manifest 行或 CI action 执行）**／真空证伪／占位符——在册的轴计数与实测不符即红，闭包破了即红）",
    argv: ["node","packages/scripts/verify-check-registry.mjs","packages","--strict"],
    lanes: ["ci-release"],
    after: ["gate-27"],
  }),

  gate("gate-49", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-mutations.mjs --coverage`（G5/1 变异库：每条 check 需 `checkMutations` 记录，缺／残 ⇒ cannot-decide；`--only <id>` 现场打补丁→跑→断言语义→还原并校验哈希；`--self-test` 必须抓出等值 mutation 与矛盾期望，抓出即 **exit 0**；`--probes [--only <probe>] [--list] [--ledger <path>] [--no-stamp]` 逐条执行 `probes.json` 的 mutation fixture：快照→应用→探针必红→还原校验→写 `reports/mutation-coverage.json` 签名台账）",
    argv: ["node","packages/scripts/verify-mutations.mjs","--coverage"],
    lanes: ["ci-release"],
    after: ["gate-48"],
    registration: {"reason":"the mutation ledger is still being filled: 29 of 109 checks carry a proven red record","owner":"scripts/gates","expiry":"0.48.0","plan":"close records per check; coverage exits 0 once every check is proven","renewal":"Renewed at 0.46.0 (expiry 0.47.0): the row judges the build line/CI tree (platform typecheck, full suite, built entries, coverage records, health corpora) and the local overlay cannot supply those inputs; the CI action executes the same check. Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the axis rows' reduction lands with the gate-table split / probe-baseline work tracked in W9-gates §4, scheduled before 0.47."},
  }),

  gate("gate-56", {
    kind: "external",
    tree: "mirror",
    title: "`node packages/scripts/verify-release-evidence.mjs packages/evolution/dist/release-evidence.json`（W2/W3/W10/W11 发布证据：schemaVersion=2、platformLine 与 platform-line.json 逐字、manifests 范围一致；`--release` 时另要求 ciFace/gates/S1–S4 全 pass/52 项 traceability 全覆——blocked 不算 pass。缺文件/不可解析→**exit 2**）",
    lanes: ["ci-release"],
    reason: "Release evidence is a workflow job step (verify after assemble), not a gate: a gate must judge, not produce or re-verify a file the publish job owns. The table number stays reserved (ids are frozen).",
  }),

  gate("gate-57", {
    kind: "external",
    tree: "mirror",
    title: "`node packages/scripts/assemble-release-evidence.mjs packages/evolution/dist/release-evidence.json --rehearsal packages/evolution/scripts/release-evidence-rehearsal.json --gates-from-manifest ci --ci-face ci --os ci`（W3/W10 发布证据装配：把 pack 写出的 schema-2 骨架与本仓演练快照（S1–S4 spike 证据 + W11 52 项 traceability）合并，并写入 CI face 与本次 compat-check 已执行的 gate 台账；`--release` 在 publish 前复验；缺输入/不合格→exit 1/2）",
    lanes: ["ci-release"],
    reason: "Release evidence is assembled by the publish job (assemble → verify → publish), not by a gate: the old row produced the evidence inside a gate, which is the synthesis this phase removes. The table number stays reserved (ids are frozen).",
  }),

  gate("gate-59", {
    kind: "step",
    tree: "overlay",
    title: "node packages/evolution/scripts/audit-release-tarballs.mjs packages/evolution/dist --version \"${RELEASE_VERSION#v}\" --platform-range \"^$RANGE\"",
    command: "node packages/evolution/scripts/audit-release-tarballs.mjs packages/evolution/dist --version \"${RELEASE_VERSION#v}\" --platform-range \"^$RANGE\"",
    lanes: ["ci-release"],
    reason: "action step — executed by its lane/action step, not by run-gates",
  }),

  gate("gate-74", {
    kind: "step",
    tree: "overlay",
    title: "node packages/evolution/scripts/smoke-packed-install.mjs packages/evolution/dist --assets-only",
    command: "node packages/evolution/scripts/smoke-packed-install.mjs packages/evolution/dist --assets-only",
    lanes: ["ci-release","ci-windows"],
    needs: ["gate-59"],
    reason: "action step — executed by its lane/action step, not by run-gates",
  }),

]
