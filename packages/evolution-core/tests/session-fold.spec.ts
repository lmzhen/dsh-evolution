// @tier fast
import { describe, expect, it } from 'vitest'
import { classifySessionEvent } from '../src/session-fold.ts'

const modelEvents = ['user/message', 'assistant/message', 'tool/call', 'tool/result'].map(type => ({ type }))
const pluginRecord = { type: 'plugin:evolution.test', ignorable: true }

describe('session event fold (G6-S1)', () => {
  it('classifies the model content frames as model', () => {
    for (const event of modelEvents) expect(classifySessionEvent(event)).toBe('model')
    expect(classifySessionEvent({ type: 'assistant/message' })).toBe('model')
  })

  it('tolerates platform plugin records read-only', () => {
    expect(classifySessionEvent(pluginRecord)).toBe('plugin-record')
    expect(classifySessionEvent({ type: 'plugin:evolution.test' })).toBe('unknown')
  })

  it('counts unknown frames as ignorable and never throws on malformed events', () => {
    expect(classifySessionEvent({ type: 'turn/start' })).toBe('unknown')
    expect(classifySessionEvent({})).toBe('unknown')
    expect(classifySessionEvent({ type: 'turn/start' })).not.toBe('model')
    expect(classifySessionEvent(pluginRecord)).not.toBe('model')
    expect(classifySessionEvent({ type: 'assistant/message' })).toBe('model')
  })
})
