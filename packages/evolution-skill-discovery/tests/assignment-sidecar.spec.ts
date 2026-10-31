import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { DomainAssignmentService, DomainMapFileStore, MemoryAssignmentQueue, installAssignmentSidecar } from '../src/index.ts'

class Io implements EvolutionIoLike {
  files = new Map<string, string>()
  async readText(path: string): Promise<string | null> { return this.files.get(path) ?? null }
  async writeText(path: string, content: string): Promise<void> { this.files.set(path, content) }
  async remove(path: string): Promise<void> { this.files.delete(path) }
  async list(): Promise<string[]> { return [...this.files.keys()] }
  async exists(path: string): Promise<boolean> { return this.files.has(path) }
  async rename(from: string, to: string): Promise<void> { const value = this.files.get(from); if (value === undefined) throw new Error('missing'); this.files.set(to, value); this.files.delete(from) }
  async copy(from: string, to: string): Promise<void> { const value = this.files.get(from); if (value === undefined) throw new Error('missing'); this.files.set(to, value) }
}

it('observes successful skill_manage create without touching the tool transaction', async () => {
  const queue = new MemoryAssignmentQueue()
  const store = new DomainMapFileStore(new Io(), 'map.json', () => 1)
  const service = new DomainAssignmentService(queue, store, { createClassificationEnabled: true, now: () => 1 })
  const ctx = new Context()
  installAssignmentSidecar(ctx, service, { provider: 'dsh-evolution', source: 'user-dsh' })
  const exec = { callId: 'c', name: 'skill_manage', arguments: { action: 'create', name: 'alpha', content: '---\nname: alpha\ndescription: alpha desc\n---\nbody', domain: { mode: 'new', proposed: { title: 'D', purpose: 'purpose', inScope: ['a'], outOfScope: ['b'], triggers: ['t'], evidenceSkillKeys: ['alpha'] }, confidence: 1, reason: 'r', mapVersion: '0' } }, agent: { id: 'a' }, signal: new AbortController().signal } as unknown as ToolExecution
  const result: ToolExecutionResult = { isError: false, value: { ok: true }, content: [] }
  ctx.emit('tools/result', exec, result)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(queue.list()).toHaveLength(1)
})


it('does not enqueue a staged create before approval', async () => {
  const queue = new MemoryAssignmentQueue()
  const store = new DomainMapFileStore(new Io(), 'map.json', () => 1)
  const service = new DomainAssignmentService(queue, store, { createClassificationEnabled: true, now: () => 1 })
  const ctx = new Context()
  installAssignmentSidecar(ctx, service, { provider: 'dsh-evolution', source: 'user-dsh' })
  const exec = { callId: 'c', name: 'skill_manage', arguments: { action: 'create', name: 'alpha', content: '---\nname: alpha\ndescription: alpha desc\n---\nbody', domain: { mode: 'new', proposed: { title: 'D', purpose: 'purpose', inScope: ['a'], outOfScope: ['b'], triggers: ['t'], evidenceSkillKeys: ['alpha'] }, confidence: 1, reason: 'r', mapVersion: '0' } }, agent: { id: 'a' }, signal: new AbortController().signal } as unknown as ToolExecution
  const result: ToolExecutionResult = { isError: false, value: { ok: true, pending_id: 'p1' }, content: [{ type: 'text', text: 'OK: 写入已暂存待批准 (staged id: p1)' }] }
  ctx.emit('tools/result', exec, result)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(queue.list()).toHaveLength(0)
})


it('enqueues a staged create only after approval succeeds', async () => {
  const queue = new MemoryAssignmentQueue()
  const store = new DomainMapFileStore(new Io(), 'map.json', () => 1)
  const service = new DomainAssignmentService(queue, store, { createClassificationEnabled: true, now: () => 1 })
  const ctx = new Context()
  installAssignmentSidecar(ctx, service, { provider: 'dsh-evolution', source: 'user-dsh' })
  const args = { operation: { action: 'create', name: 'alpha', content: '---\nname: alpha\ndescription: alpha desc\n---\nbody', domain: { mode: 'new', proposed: { title: 'D', purpose: 'purpose', inScope: ['a'], outOfScope: ['b'], triggers: ['t'], evidenceSkillKeys: ['alpha'] }, confidence: 1, reason: 'r', mapVersion: '0' } }, origin: 'foreground', libraryOrigin: 'dsh-evolution' }
  ctx.emit('evolution/approval-decided', { record: { kind: 'skill', args }, action: 'reject', ok: false })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(queue.list()).toHaveLength(0)
  ctx.emit('evolution/approval-decided', { record: { kind: 'skill', args }, action: 'approve', ok: true })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(queue.list()).toHaveLength(1)
})
