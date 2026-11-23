// @tier fast
/**
 * Runtime assertions for the substantive freeze surfaces in 84 §4.3.1: the
 * byte/fingerprint gate must never be the only evidence that stage order,
 * defaults, model tiers, floors, seed and degradation stayed put.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { buildScanStages, makeConfig } from '@deepseek-ai/dsh-evolution-merge-engine'

const registryPath = fileURLToPath(new URL('../../evolution-merge-engine/vendor/skill-merge-pipeline/models/registry.json', import.meta.url))
const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as {
  tiers: Array<{ id: string }>
  models: Array<{ id: string; floors: { body: number; summary: number } }>
}

it('keeps the stage order that the substance gate protects', () => {
  expect(buildScanStages().map(stage => stage.id)).toEqual([
    'prefilter', 'candidates', 'lexical', 'provision', 'rank_plan', 'semantic', 'rerank', 'judge',
  ])
})

it('keeps the pipeline defaults, seed and degradation wiring', () => {
  const cfg = makeConfig({}) as Record<string, unknown>
  expect(cfg).toMatchObject({
    embed_backend: 'chain',
    rank_mode: 'auto',
    seed_mode: 'run',
    minhash_seed: 1,
    floor_jitter: 0.02,
    round_count: 1,
    rank_local_chain: 'q8,q4',
    embed_remote_url: 'https://api.siliconflow.cn/v1/embeddings',
    rank_api_model: 'startlux-decision-27b-autothink',
    judge: 'stub',
  })
})

it('keeps the tier order and fixed floors of the dedicated models', () => {
  expect(registry.tiers.map(tier => tier.id)).toEqual([
    'qwen3-embedding-8b', 'bge-m3', 'local:int8-256', 'local:pca64-int8',
  ])
  expect(registry.models.map(model => [model.id, model.floors.body, model.floors.summary])).toEqual([
    ['qwen3-embedding-8b', 0.75, 0.85],
    ['bge-m3', 0.8, 0.6],
    ['local:int8-256', 0.95, 0.6],
    ['local:pca64-int8', 0.95, 0.6],
  ])
})
