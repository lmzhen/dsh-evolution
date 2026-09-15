#!/usr/bin/env node
/**
 * G5 (0.3.78) shared engine for verify-arch-guards rule N19: a family FACT has
 * exactly ONE home document, every other document CITES that home, and no
 * document claims a guard, rule id or template the tree does not have.
 *
 * Why this exists: the same conclusion used to be written in the root README,
 * the package README and the install documents, so it drifted where no build
 * could see it (0.3.77: "Sessions on other presets keep the shared automation"
 * stayed after the variant form made it false, and the agent README kept saying
 * there is no cordis base after bases.json grew one). The facts live in
 * scripts/family-facts.json; this module re-derives each one from its home
 * document and from the code/data that owns the value.
 *
 * Layout: the packages tree is passed in (flat mirror packages/, or the dev /
 * CI overlay packages/evolution). Repo-root documents (README.md, INSTALL.md,
 * README.zh.md, CHANGELOG.md, CONTRIBUTING.md) exist only in the flat mirror;
 * when the mirror root is not detected the repo-scope checks are SKIPPED BY
 * NAME and reported, never silently passed.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

export const FACTS_ASSET = join('scripts', 'family-facts.json')

const readText = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null)

/** Flat-mirror root detection: the marker pair only the publication repo has. */
function repoRootOf(root) {
  const parent = resolve(root, '..')
  return existsSync(join(parent, 'UPSTREAM_SHA')) && existsSync(join(parent, 'CHANGELOG.md')) ? parent : null
}

function treeDocs(root, skip) {
  const out = []
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) { visit(path); continue }
      if (entry.name.endsWith('.md')) out.push({ rel: relative(root, path).split('\\').join('/'), path, text: readFileSync(path, 'utf8'), scope: 'tree' })
    }
  }
  visit(root)
  return out
}

/**
 * Pure half of the rule: a fact table that cannot be trusted is a violation
 * before any document is read (an empty table, an unnamed fact, a fact with no
 * home or nothing to check would all "pass").
 */
export function factTableProblems(asset) {
  const out = []
  const facts = Array.isArray(asset?.facts) ? asset.facts : []
  if (facts.length === 0) out.push(`${FACTS_ASSET}: zero facts registered — the single-source table cannot pass by being empty`)
  for (const fact of facts) {
    const id = typeof fact?.id === 'string' && fact.id !== '' ? fact.id : '(no id)'
    if (id === '(no id)') out.push(`${FACTS_ASSET}: a fact entry has no id — an unnameable fact cannot be cited or fixed`)
    if (typeof fact?.home !== 'string' || fact.home === '') out.push(`${FACTS_ASSET}: fact "${id}" has no home document — one fact, one home`)
    if (!Array.isArray(fact?.must) || fact.must.length === 0) out.push(`${FACTS_ASSET}: fact "${id}" carries no \`must\` statement — a fact with nothing to verify passes vacuously`)
  }
  return out
}

/** Machine owners: re-derive the value a fact states so a changed value fails. */
function machineViolations(fact, root, docs, home) {
  const out = []
  const machine = fact.machine
  if (machine === undefined) return out
  const file = join(root, machine.file)
  const text = readText(file)
  if (text === null) {
    out.push(`${machine.file}: fact ${fact.id} names a machine owner that does not exist under ${root} — the fact cannot be re-derived (a missing owner is not a pass)`)
    return out
  }
  if (machine.kind === 'bases-json') {
    let table
    try { table = JSON.parse(text) } catch (error) {
      out.push(`${machine.file}: unreadable base table (${error instanceof Error ? error.message : String(error)}) — N19 cannot re-derive the --base fact`)
      return out
    }
    for (const base of table.bases ?? []) {
      for (const value of [base.name, base.id, base.metadata]) {
        if (!home.includes(String(value))) out.push(`${fact.home}: the base table entry "${String(value)}" (${machine.file}) is not stated in the fact's home — the doc and the table disagree`)
      }
      if (base.requires !== undefined && !home.includes(base.requires.service)) {
        out.push(`${fact.home}: base "${base.name}" requires service ${base.requires.service} (${machine.file}) but the home does not state the precondition`)
      }
      if (base.unsupported !== undefined && !/unsupported/i.test(home)) {
        out.push(`${fact.home}: base "${base.name}" is registered as unsupported in ${machine.file} but the home does not say so`)
      }
      for (const re of [`no \`${base.name}\` base`, `There is no \`${base.name}\` base`, `no ${base.name} base is published`]) {
        for (const doc of docs) {
          if (doc.rel === fact.home || doc.reasonLayer) continue
          if (doc.text.includes(re)) out.push(`${doc.label}: claims "${re}" while ${machine.file} registers that base — a doc may not deny a base the table carries`)
        }
      }
    }
    const names = new Set((table.bases ?? []).map(base => base.name))
    for (const doc of docs) {
      if (doc.reasonLayer) continue
      for (const match of doc.text.matchAll(/--base\s+(?:`)?([A-Za-z][\w-]*)/g)) {
        if (!names.has(match[1])) out.push(`${doc.label}: offers \`--base ${match[1]}\` which ${machine.file} does not carry (bases: ${[...names].join(', ')})`)
      }
    }
    return out
  }
  if (machine.kind === 'row-override-cap') {
    const value = new RegExp(`${machine.key}:\\s*(\\d+)`).exec(text)?.[1]
    if (value === undefined) {
      out.push(`${machine.file}: no \`${machine.key}: <digits>\` line — the row-override value the fact states cannot be re-derived`)
      return out
    }
    if (!home.includes(`${value}-char`)) out.push(`${fact.home}: ${machine.file} sets ${machine.key}: ${value}, but the home does not state the "${value}-char" cap`)
    for (const doc of docs) {
      if (doc.rel === fact.home || doc.reasonLayer) continue
      for (const match of doc.text.matchAll(/(\d+)-char catalog cap/g)) {
        if (match[1] !== value) out.push(`${doc.label}: says "${match[1]}-char catalog cap" while ${machine.file} sets ${value} — one value, one number`)
      }
    }
    return out
  }
  if (machine.kind === 'doctor-forms') {
    const declared = [...text.matchAll(new RegExp(`${machine.field}\\s*:([^\\n]*)`, 'g'))].map(match => match[1] ?? '')
    const richest = declared.sort((a, b) => [...b.matchAll(/'/g)].length - [...a.matchAll(/'/g)].length)[0] ?? ''
    const forms = [...new Set([...richest.matchAll(/'([a-z-]+)'/g)].map(match => match[1]))]
    if (forms.length === 0) {
      out.push(`${machine.file}: no \`${machine.field}\` union found — the doctor report shape the fact cites cannot be read (looked for ${machine.field}: 'a' | 'b')`)
      return out
    }
    for (const form of forms) {
      if (!home.includes(form)) out.push(`${fact.home}: ${machine.file} reports \`deployment: ${form}\` but the home has no entry for it — every reported form needs a documented meaning`)
    }
    return out
  }
  out.push(`${fact.id}: unknown machine kind "${String(machine.kind)}" — N19 cannot re-derive this fact`)
  return out
}

/** Citation check: a doc may cite a guard script, a rule id or a template only if it exists. */
function checklistViolations(root, repoRoot, asset, violations) {
  const config = asset.checklists
  if (config === undefined) return 0
  const docs = []
  for (const rel of config.repoDocs ?? []) {
    const text = repoRoot === null ? null : readText(join(repoRoot, rel))
    if (text !== null) docs.push({ rel: `repo:${rel}`, text })
  }
  for (const rel of config.docs ?? []) {
    const text = readText(join(root, rel))
    if (text === null) violations.push(`${rel}: the checklist the facts asset lists does not exist — a missing checklist is a missing surface, not a pass`)
    else docs.push({ rel, text })
  }
  const registry = readText(join(root, config.ruleRegistry))
  // Only the registry entries count: the self-test samples below the array also
  // carry `{ id: 'x' }` literals and must not be mistaken for rule ids.
  const ruleIds = new Set(registry === null ? [] : [...registry.matchAll(/^ *\{ id: '([^']+)'/gm)].map(match => match[1]))
  if (registry === null) violations.push(`${config.ruleRegistry}: no rule registry to check checklist citations against (the N19 citation check cannot decide)`)
  const guardDir = join(root, config.guardDir)
  for (const doc of docs) {
    // S3-G1: the pattern used to match ONLY `verify-*.mjs`, so a checklist citing
    // a scripts-dir helper under another name (the phantom `check-manifests.cjs`)
    // was structurally invisible to this existence check. Bare dotted script
    // names cited from a checklist must resolve under the scripts dir; names
    // preceded by a path (`node_modules/vitest/vitest.mjs`) or continuing into
    // a template suffix (`rule-snippet.mjs.tmpl`) are excluded.
    for (const match of doc.text.matchAll(/(?<![/\w-])([a-z][a-z0-9-]*\.(?:mjs|cjs))(?!\.[a-z0-9])/g)) {
      if (!existsSync(join(guardDir, match[1]))) violations.push(`${doc.rel}: cites guard \`${match[1]}\` which does not exist under ${config.guardDir}`)
    }
    for (const match of doc.text.matchAll(/\b(N\d+[a-z]?)\b/g)) {
      if (ruleIds.size > 0 && !ruleIds.has(match[1])) violations.push(`${doc.rel}: cites rule ${match[1]} which the registry does not carry (rules: ${[...ruleIds].join(', ')})`)
    }
    for (const match of doc.text.matchAll(/templates\/([\w./-]+)/g)) {
      if (!existsSync(join(root, config.templateRoot, match[1]))) violations.push(`${doc.rel}: cites template \`templates/${match[1]}\` which does not exist`)
    }
  }
  return docs.length
}

/**
 * The whole N19 pass.
 * @returns {{ armed: boolean, violations: string[], note: string, counts: object }}
 */
export function docFactViolations(root, options = {}) {
  const result = { armed: false, violations: [], note: '', counts: { facts: 0, docs: 0, repoDocs: 0, unique: 0 } }
  const assetPath = join(root, FACTS_ASSET)
  const familyTree = existsSync(join(root, 'evolution-core', 'package.json'))
  if (!existsSync(assetPath)) {
    if (familyTree) {
      result.armed = true
      result.violations.push(`${FACTS_ASSET}: no single-source facts asset under ${root} — the N19 scan has nothing to verify (a vacuum pass is not a pass; restore the asset or the rule cannot run)`)
    } else {
      result.note = `not armed: no evolution-core manifest under ${root} (a synthetic fixture tree, not the family tree)`
    }
    return result
  }
  result.armed = true
  let asset
  try { asset = JSON.parse(readFileSync(assetPath, 'utf8')) } catch (error) {
    result.violations.push(`${FACTS_ASSET}: unreadable facts asset (${error instanceof Error ? error.message : String(error)})`)
    return result
  }
  const facts = Array.isArray(asset.facts) ? asset.facts : []
  result.violations.push(...factTableProblems(asset))

  const skip = new Set(asset.scan?.treeDocSkip ?? [])
  const reasonLayer = new Set(asset.scan?.reasonLayer ?? [])
  const docs = treeDocs(root, skip)
  const repoRoot = repoRootOf(root)
  const repoDocs = []
  if (repoRoot === null) {
    const requested = (options.requireRepoDocs ?? false) ? result.violations : []
    requested.push(`${root}: repo-root documents (README.md / INSTALL.md / README.zh.md / CHANGELOG.md) are absent in this layout — the repo-scope facts are NOT verified here; run the guard from the flat mirror or pass --require-repo-docs`)
    result.note = 'repo-root docs absent (overlay layout): repo-scope facts reported as unverified'
  } else {
    for (const rel of asset.scan?.repoDocs ?? []) {
      const text = readText(join(repoRoot, rel))
      if (text !== null) repoDocs.push({ rel, label: `repo:${rel}`, path: join(repoRoot, rel), text, scope: 'repo', reasonLayer: reasonLayer.has(rel) })
    }
  }
  for (const doc of docs) { doc.label = `packages/${doc.rel}`; doc.reasonLayer = reasonLayer.has(doc.rel.split('/').pop()) }
  const all = [...repoDocs, ...docs]
  result.counts.facts = facts.length
  result.counts.docs = docs.length
  result.counts.repoDocs = repoDocs.length
  if (all.length === 0) result.violations.push(`${root}: no Markdown document scanned — the fact homes cannot be verified (a vacuum pass is not a pass)`)

  for (const fact of facts) {
    const homeDoc = docs.find(doc => doc.rel === fact.home)
    if (homeDoc === undefined) {
      result.violations.push(`${fact.home}: fact "${fact.id}" names a home document that is not in the scanned tree — every fact needs ONE existing home`)
      continue
    }
    for (const must of fact.must ?? []) {
      if (!homeDoc.text.includes(must.text)) {
        result.violations.push(`${fact.home}: fact "${fact.id}" lost its canonical statement "${must.text}" — re-state it in the home, or move the home in ${FACTS_ASSET}`)
        continue
      }
      if (must.unique !== true) continue
      result.counts.unique += 1
      for (const doc of all) {
        if (doc === homeDoc || doc.reasonLayer) continue
        if (doc.text.includes(must.text)) {
          result.violations.push(`${doc.label}: a SECOND copy of "${must.text}" — this fact already lives in ${fact.home}; cite the home instead of restating it (rule N19; register the fact in ${FACTS_ASSET} if it is a new one)`)
        }
      }
    }
    for (const forbid of fact.forbid ?? []) {
      for (const doc of all) {
        if (doc === homeDoc || doc.reasonLayer) continue
        if (new RegExp(forbid.re).test(doc.text)) {
          result.violations.push(`${doc.label}: states "${forbid.re}" — ${forbid.why ?? 'a claim the single source contradicts'}`)
        }
      }
    }
    for (const cite of fact.cites ?? []) {
      const doc = cite.scope === 'repo' ? repoDocs.find(entry => entry.rel === cite.file) : docs.find(entry => entry.rel === cite.file)
      if (doc === undefined) {
        const label = cite.scope === 'repo' ? `repo:${cite.file}` : `packages/${cite.file}`
        const known = cite.scope === 'repo' ? repoDocs.length > 0 : true
        if (known) result.violations.push(`${label}: fact "${fact.id}" expects this document to cite ${fact.home}, but the file is not there — fix the citation path in ${FACTS_ASSET}`)
        continue
      }
      if (!doc.text.includes(cite.text)) {
        result.violations.push(`${doc.label}: fact "${fact.id}" is stated in ${fact.home} — this document must cite it (expected the text "${cite.text}")`)
      }
    }
    result.violations.push(...machineViolations(fact, root, all, homeDoc.text))
  }
  const checklistDocs = checklistViolations(root, repoRoot, asset, result.violations)
  result.counts.checklists = checklistDocs
  return result
}

export function formatDocFacts(result, root) {
  const head = `doc-facts (root: ${root})`
  if (!result.armed) return `${head}: N19 ${result.note}`
  return `${head}: ${result.counts.facts} fact(s) over ${result.counts.docs} tree doc(s) + ${result.counts.repoDocs} repo doc(s), ${result.counts.unique} unique anchor(s), ${result.counts.checklists} checklist doc(s) — ${result.violations.length} violation(s)`
}
