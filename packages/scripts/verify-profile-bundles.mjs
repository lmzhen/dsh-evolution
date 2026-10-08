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
 *   node verify-profile-bundles.mjs --self-test
 *     在临时目录里造 4 个夹具 profile，判定四个方向（合规 0／双行 1／幽灵行 1／
 *     无清单 2）。门禁用这一形态：此前门禁不带参数，判的是**跑门禁那台机器**的
 *     `~/.dsh/profiles/web`——本机恰好存在才通过，换机器就变成 vacant guard 的
 *     exit 2，判的根本不是仓库内容。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { EVOLUTION_BUNDLE_TAILS as EVOLUTION_BUNDLES } from './lib-family-packages.mjs'

const tail = (name) => name.slice(name.lastIndexOf('/') + 1)

/**
 * Judge one profile directory.
 * @param profileDir - the profile directory holding package.json.
 * @returns the exit code and the text to print (0 = OK, 1 = violation, 2 = vacant).
 */
function checkProfile(profileDir) {
  const manifestPath = join(profileDir, 'package.json')
  if (!existsSync(manifestPath)) {
    return { code: 2, output: `verify-profile-bundles: no profile manifest at ${manifestPath} — pass a profile directory or install dsh profiles first (vacant guard: a missing profile is not a pass)` }
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''))
  const bundles = Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []
  const dependencies = manifest?.dependencies ?? {}

  // R1: mutual exclusion — at most ONE evolution bundle row.
  const evolutionRows = bundles.filter((entry) => typeof entry === 'string' && EVOLUTION_BUNDLES.some((b) => tail(entry) === b))
  if (evolutionRows.length > 1) {
    return {
      code: 1,
      output: `verify-profile-bundles: ${evolutionRows.length} evolution bundles are mounted together (${evolutionRows.join(', ')}) — `
        + 'they are ALTERNATIVE install targets (E-33): each bundle inserts the same infra rows into the profile '
        + 'composition and the cordis loader fails loud on the duplicate entry id at boot. '
        + 'Keep ONE: dsh-evolution-all is the DEFAULT full-functionality superset (host infra rows + the 4 model rows) — '
        + 'remove the others from dsh.profile.bundles (e.g. dsh plugin --profile web remove <name>) and keep the '
        + 'packages in dependencies only if another bundle depends on them.',
    }
  }

  // R2: a mounted evolution bundle row must be pinned in dependencies (no phantom row).
  const phantom = evolutionRows.filter((entry) => dependencies[entry] === undefined)
  if (phantom.length > 0) {
    return {
      code: 1,
      output: `verify-profile-bundles: mounted but not pinned as a dependency: ${phantom.join(', ')} — add the package to dependencies (dsh plugin --profile web add <name>), or the loader cannot resolve it`,
    }
  }

  return { code: 0, output: `verify-profile-bundles: OK — ${profileDir} carries ${evolutionRows.length} evolution bundle (${evolutionRows[0] ?? 'none'}), no mutual-exclusion or phantom-row issue` }
}

/** Write one fixture profile manifest.
 * @param dir - the profile directory to create.
 * @param bundles - its `dsh.profile.bundles` rows.
 * @param dependencies - the package names to pin in `dependencies`.
 */
function writeFixture(dir, bundles, dependencies) {
  mkdirSync(dir, { recursive: true })
  const manifest = {
    name: `dsh-profile-${basename(dir)}`,
    private: true,
    dependencies: Object.fromEntries(dependencies.map(name => [name, '1.0.0'])),
    dsh: { profile: { bundles } },
  }
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
}

/**
 * Prove all four decisions on temporary profiles, so the gate judges fixtures
 * instead of the machine it runs on.
 * @returns the exit code and the text to print.
 */
function selfTest() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-profile-bundles-'))
  try {
    const compliant = join(root, 'compliant')
    const doubled = join(root, 'doubled')
    const phantom = join(root, 'phantom')
    const [first, second] = EVOLUTION_BUNDLES
    const scoped = name => `@lmzhen/${name}`
    writeFixture(compliant, [scoped(first)], [scoped(first)])
    writeFixture(doubled, [scoped(first), scoped(second)], [scoped(first), scoped(second)])
    writeFixture(phantom, [scoped(first)], [])
    const cases = [
      { label: 'one pinned evolution bundle', dir: compliant, code: 0 },
      { label: 'two evolution bundle rows', dir: doubled, code: 1 },
      { label: 'mounted but unpinned', dir: phantom, code: 1 },
      { label: 'no manifest', dir: join(root, 'missing'), code: 2 },
    ]
    const wrong = cases.filter(item => checkProfile(item.dir).code !== item.code)
    if (wrong.length > 0) {
      return { code: 1, output: `verify-profile-bundles --self-test: ${wrong.map(item => `${item.label} expected ${item.code}`).join('; ')}` }
    }
    return { code: 0, output: `verify-profile-bundles --self-test: OK — ${cases.length} fixture(s) judged as expected (compliant 0, two rows 1, phantom row 1, vacant 2)` }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const argv = process.argv.slice(2)
const unknown = argv.filter(arg => arg.startsWith('--') && arg !== '--self-test')
if (unknown.length > 0) {
  console.error(`verify-profile-bundles: unknown flag ${unknown.join(', ')} — usage: verify-profile-bundles.mjs [profile-dir | --self-test]`)
  process.exit(2)
}
const result = argv.includes('--self-test')
  ? selfTest()
  : checkProfile(resolve(argv.find(arg => !arg.startsWith('--')) ?? join(homedir(), '.dsh', 'profiles', 'web')))
if (result.code === 0) console.log(result.output)
else console.error(result.output)
process.exit(result.code)
