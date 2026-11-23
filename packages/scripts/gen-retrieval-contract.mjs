#!/usr/bin/env node
// gen-retrieval-contract.mjs — one source for the credential refs, help links,
// and fixed model ids shared by the merge host and the settings UI.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const SOURCE = join(HERE, 'retrieval-contract.json')
const TARGETS = [
  'packages/evolution-merge/src/domain/retrieval-contract.generated.ts',
  'packages/evolution-client-kit/src/generated/retrieval.generated.ts',
]
const check = process.argv.includes('--check')

function render(source) {
  const refs = source.refs
  const links = source.links
  const models = source.models
  return [
    '// GENERATED FILE — do not edit. Source: packages/scripts/retrieval-contract.json',
    '// Regenerate with: node packages/scripts/gen-retrieval-contract.mjs',
    '',
    'export const RETRIEVAL_CREDENTIAL_REFS = {',
    `  embedding: '${refs.embedding}',`,
    `  ranker: '${refs.ranker}',`,
    '} as const',
    '',
    'export const RETRIEVAL_HELP_LINKS = {',
    `  siliconflow: '${links.siliconflow}',`,
    `  bambooRegister: '${links.bambooRegister}',`,
    `  bambooKeys: '${links.bambooKeys}',`,
    '} as const',
    '',
    'export const RETRIEVAL_FIXED_MODELS = {',
    `  embedding: '${models.embedding}',`,
    `  embeddingFallback: '${models.embeddingFallback}',`,
    `  ranker: '${models.ranker}',`,
    `  embeddingLabel: '${models.embeddingLabel}',`,
    `  embeddingFallbackLabel: '${models.embeddingFallbackLabel}',`,
    `  rankerLabel: '${models.rankerLabel}',`,
    '} as const',
    '',
  ].join('\n')
}

const source = JSON.parse(readFileSync(SOURCE, 'utf8'))
const text = render(source)
const stale = []
for (const relative of TARGETS) {
  const target = join(ROOT, relative)
  let current = ''
  try { current = readFileSync(target, 'utf8') } catch { current = '' }
  if (check) {
    if (current !== text) stale.push(relative)
  } else {
    writeFileSync(target, text)
  }
}
if (check) {
  if (stale.length > 0) {
    console.error('gen-retrieval-contract --check: stale ' + stale.join(', '))
    process.exit(1)
  }
  console.log('gen-retrieval-contract: OK — generated contract matches the source')
} else {
  console.log('gen-retrieval-contract: wrote ' + TARGETS.length + ' generated file(s)')
}
