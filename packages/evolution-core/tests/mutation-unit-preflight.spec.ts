// @tier fast
import { describe, expect, it } from 'vitest'
import { validateMutationRequest, type MutationRequest } from '@deepseek-ai/dsh-evolution-core'

const LIMITS = { maxSkillFileBytes: 10, maxSkillContentChars: 10 }

function request(overrides: Partial<MutationRequest> = {}): MutationRequest {
  return {
    name: 'source',
    roots: [
      { name: 'source', protection: 'write' },
      { name: 'target', protection: 'write' },
    ],
    ops: [
      { kind: 'write', target: 'source/SKILL.md', content: 'ok', skill: 'source' },
      { kind: 'write', target: 'target/SKILL.md', content: 'ok', skill: 'target' },
    ],
    origin: 'foreground',
    auditAction: 'extract',
    auditSummary: 'demo',
    eventAction: 'extract',
    ...overrides,
  }
}

describe('validateMutationRequest', () => {
  it('accepts a well-formed two-root request', () => {
    const result = validateMutationRequest(request(), LIMITS)
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.ops).toHaveLength(2)
  })

  it('rejects duplicate roots', () => {
    const result = validateMutationRequest(request({ roots: [
      { name: 'source', protection: 'write' },
      { name: 'source', protection: 'write' },
    ] }), LIMITS)
    expect(result.ok).toBe(false)
    expect(result.errors.map(error => error.code)).toContain('root-duplicate')
  })

  it('rejects a primary skill outside roots', () => {
    const result = validateMutationRequest(request({ name: 'other' }), LIMITS)
    expect(result.ok).toBe(false)
    expect(result.errors.map(error => error.code)).toContain('root-primary-missing')
  })

  it('rejects duplicate operation targets', () => {
    const result = validateMutationRequest(request({ ops: [
      { kind: 'write', target: 'source/SKILL.md', content: 'a', skill: 'source' },
      { kind: 'delete', target: 'source/SKILL.md', skill: 'source' },
    ] }), LIMITS)
    expect(result.ok).toBe(false)
    expect(result.errors.map(error => error.code)).toContain('target-duplicate')
  })

  it('rejects an operation outside declared roots', () => {
    const result = validateMutationRequest(request({ ops: [
      { kind: 'write', target: 'source/SKILL.md', content: 'a', skill: 'other' },
    ] }), LIMITS)
    expect(result.ok).toBe(false)
    expect(result.errors.map(error => error.code)).toContain('op-skill-unknown')
  })

  it('rejects a file over the byte limit', () => {
    const result = validateMutationRequest(request({ ops: [
      { kind: 'write', target: 'source/SKILL.md', content: '12345678901', skill: 'source' },
    ] }), LIMITS)
    expect(result.ok).toBe(false)
    expect(result.errors.map(error => error.code)).toContain('file-too-large')
  })

  it('rejects SKILL.md over the character limit inside the byte limit', () => {
    const result = validateMutationRequest(request({ ops: [
      { kind: 'write', target: 'source/SKILL.md', content: '12345678901', skill: 'source' },
    ] }), { maxSkillFileBytes: 100, maxSkillContentChars: 10 })
    expect(result.ok).toBe(false)
    expect(result.errors.map(error => error.code)).toContain('skill-too-large')
  })

  it('accepts a target under its declared root directory', () => {
    const result = validateMutationRequest(request({
      rootDirs: { source: 'D:/skills/source', target: 'D:/skills/target' },
      ops: [{ kind: 'write', target: 'D:/skills/source/SKILL.md', content: 'ok', skill: 'source' }],
    }), LIMITS)
    expect(result.ok).toBe(true)
  })

  it('rejects a target outside its declared root directory', () => {
    const result = validateMutationRequest(request({
      rootDirs: { source: 'D:/skills/source', target: 'D:/skills/target' },
      ops: [{ kind: 'write', target: 'D:/skills/target/SKILL.md', content: 'ok', skill: 'source' }],
    }), LIMITS)
    expect(result.ok).toBe(false)
    expect(result.errors.map(error => error.code)).toContain('target-outside-root')
  })

  it('rejects a declared root without a directory', () => {
    const result = validateMutationRequest(request({ rootDirs: { source: 'D:/skills/source' } }), LIMITS)
    expect(result.ok).toBe(false)
    expect(result.errors.map(error => error.code)).toContain('root-dir-missing')
  })

  it('accepts deletes', () => {
    const result = validateMutationRequest(request({ ops: [
      { kind: 'delete', target: 'source/references/a.md', skill: 'source' },
    ] }), LIMITS)
    expect(result.ok).toBe(true)
  })
})
