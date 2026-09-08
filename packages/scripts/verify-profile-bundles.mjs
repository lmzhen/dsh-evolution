#!/usr/bin/env node
/**
 * verify-profile-bundles — evolution 捆绑互斥守卫（0.3.61, v13 事故后新增）。
 *
 * 事故背景（2026-09-08）：`dsh plugin --profile web add …all …host` 同时装了
 * 两个互斥 bundle——dsh plugin 的 bundle reconcile 只增不减，all 行被追加而
 * host 行保留 → 双 bundle 把相同的 infra 行插入 profile 组合（evolution-policy
 * 是首个冲突），cordis loader 对重复 id fail-loud → `dsh web` 启动 abort。
 * doctor 与 INSTALL 早已明示互斥，但没有任何自动关卡拦住"用户侧 bundle 行"。
 *
 * 规则（与 install-layered / doctor 同一语义，fail-loud）：
 *   1. evolution 捆绑（all / host / preset，scope-agnostic tail 匹配）在
 *      `dsh.profile.bundles` 中至多 1 个——多个 = 双挂载，启动必炸；
 *   2. bundles 里的 evolution 捆绑行必须同时是 `dependencies` 的显式声明
 *      （幽灵行：bundle 在装、deps 未 pin——loader 解析不到包也是启动失败）。
 *
 * 用法（双布局：dev `packages/evolution/scripts/…`、mirror `packages/scripts/…`）：
 *   node verify-profile-bundles.mjs [profile-dir]
 *     profile-dir 默认 ~/.dsh/profiles/web（DSH_HOME 下 profiles/web）。
 *     profile-dir 下必须存在 package.json（vacant guard：空检 = 不通过）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const profileDir = resolve(process.argv[2] ?? join(homedir(), '.dsh', 'profiles', 'web'))
const manifestPath = join(profileDir, 'package.json')

if (!existsSync(manifestPath)) {
  console.error(`verify-profile-bundles: no profile manifest at ${manifestPath} — pass a profile directory or install dsh profiles first (vacant guard: a missing profile is not a pass)`)
  process.exit(2)
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''))
const bundles = Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []
const dependencies = manifest?.dependencies ?? {}

const EVOLUTION_BUNDLES = ['dsh-evolution-all', 'dsh-evolution-host', 'dsh-evolution-preset']
const tail = (name) => name.slice(name.lastIndexOf('/') + 1)

// R1: mutual exclusion — at most ONE evolution bundle row.
const evolutionRows = bundles.filter((entry) => typeof entry === 'string' && EVOLUTION_BUNDLES.some((b) => tail(entry) === b))
if (evolutionRows.length > 1) {
  console.error(
    `verify-profile-bundles: ${evolutionRows.length} evolution bundles are mounted together (${evolutionRows.join(', ')}) — `
    + 'they are ALTERNATIVE install targets (E-33): each bundle inserts the same infra rows into the profile '
    + 'composition and the cordis loader fails loud on the duplicate entry id at boot. '
    + 'Keep ONE: dsh-evolution-all is the DEFAULT full-functionality superset (host infra rows + the 4 model rows) — '
    + 'remove the others from dsh.profile.bundles (e.g. dsh plugin --profile web remove <name>) and keep the '
    + 'packages in dependencies only if another bundle depends on them.',
  )
  process.exit(1)
}

// R2: a mounted evolution bundle row must be pinned in dependencies (no phantom row).
const phantom = evolutionRows.filter((entry) => dependencies[entry] === undefined)
if (phantom.length > 0) {
  console.error(`verify-profile-bundles: mounted but not pinned as a dependency: ${phantom.join(', ')} — add the package to dependencies (dsh plugin --profile web add <name>), or the loader cannot resolve it`)
  process.exit(1)
}

console.log(`verify-profile-bundles: OK — ${profileDir} carries ${evolutionRows.length} evolution bundle (${evolutionRows[0] ?? 'none'}), no mutual-exclusion or phantom-row issue`)
