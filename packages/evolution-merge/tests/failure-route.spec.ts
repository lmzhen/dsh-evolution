// @tier pre-tag
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { routeFailure } from '../src/domain/failure-route.ts'

it('routes parameter errors and report-only failures', () => {
  assert.deepEqual(routeFailure('bad-pair'), { kind: 'parameter', reportOnly: false })
  assert.deepEqual(routeFailure('source-gone'), { kind: 'source-gone', reportOnly: true })
  assert.deepEqual(routeFailure('target-taken'), { kind: 'target-taken', reportOnly: true })
  assert.deepEqual(routeFailure('commit-failed'), { kind: 'commit', reportOnly: true })
  assert.deepEqual(routeFailure('schema-invalid'), { kind: 'schema', reportOnly: true })
  assert.deepEqual(routeFailure('unknown-code'), { kind: 'runtime', reportOnly: true })
})
