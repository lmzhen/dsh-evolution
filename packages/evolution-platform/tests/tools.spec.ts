// @tier fast
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { registerEvolutionTool } from '../src/tools.ts'

const definition = { name: 'probe', description: 'probe', parameters: {} } as never

describe('registerEvolutionTool', () => {
  it('warns instead of silently dropping the tool when tools is absent', () => {
    const ctx = new Context()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const dispose = registerEvolutionTool(ctx, definition)
    expect(dispose).toBeTypeOf('function')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"probe" was not registered'))
    warn.mockRestore()
  })

  it('registers through the port when tools is mounted', () => {
    const ctx = new Context()
    const register = vi.fn(() => () => {})
    ctx.provide('tools', { register, guard: vi.fn(), restrict: vi.fn(), get: vi.fn() } as never)
    const dispose = registerEvolutionTool(ctx, definition)
    expect(register).toHaveBeenCalledWith(definition, undefined)
    expect(dispose).toBeTypeOf('function')
  })
})
