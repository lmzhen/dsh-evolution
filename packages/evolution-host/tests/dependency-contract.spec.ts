// @tier ci-only
// G5 merge (audit P1-2): ONE dependency-contract suite for the three packages that carry the
// contract. The host and preset copies shared two word-for-word `it` titles and the agent copy
// repeated them; the per-package differences are TABLE ROWS here, and the agent copy's unique
// assertion (a host-plane package must not be a runtime dependency) is kept below instead of
// being dropped with its file.
import { describe, expect, it } from 'vitest'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { AGENT_EVOLUTION_ROW_NAMES, HOST_ROW_NAMES } from '../../test-support/row-contract.ts'
import { cordisRows, insertedRows, rowIds, rowName } from '../../test-support/cordis-rows.ts'

interface Subject {
  id: string
  manifestUrl: URL
  patchUrl: URL
  rows: 'inserted' | 'all'
  bundlePatch?: string
  toolVector?: Record<string, string>
}

const SUBJECTS: Subject[] = [
  { id: 'evolution-host', manifestUrl: new URL('../package.json', import.meta.url), patchUrl: new URL('../cordis.patch.yml', import.meta.url), rows: 'inserted', bundlePatch: './cordis.patch.yml' },
  { id: 'evolution-preset', manifestUrl: new URL('../../evolution-preset/package.json', import.meta.url), patchUrl: new URL('../../evolution-preset/cordis.patch.yml', import.meta.url), rows: 'inserted', bundlePatch: './cordis.patch.yml' },
  { id: 'evolution-agent', manifestUrl: new URL('../../evolution-agent/package.json', import.meta.url), patchUrl: new URL('../../evolution-agent/agent.cordis.yml', import.meta.url), rows: 'all', toolVector: AGENT_EVOLUTION_ROW_NAMES },
]

const HOST_PLANE_NOT_RUNTIME = [HOST_ROW_NAMES.memory, HOST_ROW_NAMES['memory-files'], HOST_ROW_NAMES['skill-usage'], HOST_ROW_NAMES['evolution-state'], HOST_ROW_NAMES['evolution-approval']]

describe('dependency contract (one suite, three subjects)', () => {
  for (const subject of SUBJECTS) {
    it(subject.id + ': declares every row package it carries', () => {
      const manifest = JSON.parse(readFileSync(fileURLToPath(subject.manifestUrl), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; peerDependencies?: Record<string, string> }
      const declared = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})])
      const patch = loadOverlayPatches('test', fileURLToPath(subject.patchUrl))
      const names = subject.rows === 'inserted' ? insertedRows(patch).map(row => rowName(row)) : cordisRows(patch).map(row => rowName(row))
      for (const name of names) {
        if (!name.startsWith('@deepseek-ai/')) continue
        const declaredName = name.split('/').slice(0, 2).join('/')
        expect(declared.has(declaredName), subject.id + ' must declare ' + declaredName).toBe(true)
      }
      for (const name of Object.values(subject.toolVector ?? {})) expect(declared.has(name), subject.id + ' must declare ' + name).toBe(true)
    })
  }
  for (const subject of SUBJECTS.filter(entry => entry.bundlePatch !== undefined)) {
    it(subject.id + ': declares the bundle patch entry for profile resolution', () => {
      const manifest = JSON.parse(readFileSync(fileURLToPath(subject.manifestUrl), 'utf8')) as { dsh?: { bundle?: { patch?: string } } }
      expect(manifest.dsh?.bundle?.patch).toBe(subject.bundlePatch)
    })
  }
  it('evolution-agent: does not declare host-plane packages as runtime dependencies', () => {
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../../evolution-agent/package.json', import.meta.url)), 'utf8')) as { dependencies?: Record<string, string> }
    for (const name of HOST_PLANE_NOT_RUNTIME) expect(manifest.dependencies?.[name]).toBeUndefined()
  })
  it('evolution-agent: keeps every row id unique in the full preset', () => {
    const rows = cordisRows(loadOverlayPatches('test', fileURLToPath(new URL('../../evolution-agent/agent.cordis.yml', import.meta.url))))
    const ids = rowIds(rows)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
