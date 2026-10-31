import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { aggregateJudge, validateJudgeRecord, type JudgeRecord } from '../src/index.ts'

interface Fixture { queries: Array<{ query: string; acceptable: string[] }> }
async function ids(): Promise<string[]> {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/search-eval-010.json', import.meta.url), 'utf8')) as Fixture
  return fixture.queries.map((_, index) => 'q' + index)
}
function record(kind: 'model' | 'human', queryIds: string[]): JudgeRecord {
  return { schemaVersion: 1, querySet: 'eval-010', judgeKind: kind, judgeId: kind + '-judge', observations: queryIds.map((queryId, index) => ({ queryId, relevant: index % 2 === 0 })) }
}

describe('EVAL-010 judge protocol', () => {
  it('requires full query coverage per judge and aggregates two blind records', async () => {
    const queryIds = await ids()
    const model = record('model', queryIds)
    const human = record('human', queryIds)
    expect(validateJudgeRecord(model, queryIds)).toEqual([])
    expect(aggregateJudge([model, human], queryIds)).toMatchObject({ hasModel: true, hasHuman: true, agreementRate: 1 })
    const missing = record('model', queryIds.slice(1))
    expect(validateJudgeRecord(missing, queryIds)).toContain('missing-query:q0')
  })
})
