// @tier pre-tag
import { expect, it } from 'vitest'
import { Config } from '../src/index.ts'

it('defaults reviewMode to the plugin-owned aux loop', () => {
  expect((Config({}).reviewMode as { get(): unknown }).get()).toBe('aux')
})
