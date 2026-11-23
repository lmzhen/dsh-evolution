// Build note: the published engine is src/index.bundle.js. After editing this file,
// regenerate it with scripts/bundle-source.mjs before building lib.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runScan } from '../vendor/skill-merge-pipeline/src/scan.js'
import { makeConfig } from '../vendor/skill-merge-pipeline/src/config.js'
import { buildScanStages } from '../vendor/skill-merge-pipeline/src/pipeline/compose.js'
import { runPipeline } from '../vendor/skill-merge-pipeline/src/pipeline/index.js'
import { defineStage } from '../vendor/skill-merge-pipeline/src/pipeline/stage.js'
import { resolveJudge, judgeCascade } from '../vendor/skill-merge-pipeline/src/judge.js'
import { ensureDir } from '../vendor/skill-merge-pipeline/src/io/bytes.js'
import { resolveModels } from '../vendor/skill-merge-pipeline/src/models/firstrun.js'
import * as corpus from '../vendor/skill-merge-pipeline/src/corpus.js'
import * as ledger from '../vendor/skill-merge-pipeline/src/ledger.js'
import * as report from '../vendor/skill-merge-pipeline/src/report.js'
import { assessDegradation } from '../vendor/skill-merge-pipeline/src/degrade.js'
import path from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const VERSION = '0.29.0'

function registrySha() {
  const p = join(ROOT, 'vendor', 'skill-merge-pipeline', 'models', 'registry.json')
  return existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : ''
}

function envelope(corpusDir, outDir) {
  return { corpusDir, outDir, modelSha: registrySha(), engineVersion: VERSION }
}

function wrapJudgeStage(stage, runner) {
  return defineStage({
    id: stage.id,
    requires: stage.requires,
    async run(ctx, env) {
      const cfg = Object.assign({}, ctx.cfg)
      const resolution = resolveJudge(cfg, ctx.env)
      if (cfg.judge === 'auto') cfg.judge = resolution.mode
      if (cfg.judge === 'stub2' && env.semantic && env.semantic.floors_used) {
        cfg.stub2_floors = { body: env.semantic.floors_used.body, summary: env.semantic.floors_used.summary }
        ctx.state.stub2Floors = cfg.stub2_floors
      }
      ctx.state.judgeMode = cfg.judge
      const [verdicts, stats] = await judgeCascade(env.rerank.ranked, env.semantic.byPath, cfg, path.join(ctx.out, 'prompts'), runner)
      return { data: { verdicts, fallback: resolution.fallback }, stats, counters: { pairs: verdicts.length } }
    }
  })
}

async function runWithRunner({ corpusDir, outDir, cfg, signal, onProgress, runner }) {
  const o = { cfg, corpus: [corpusDir], out: outDir, signal, onProgress }
  ensureDir(outDir)
  const [skills] = corpus.loadCorpus(o.corpus)
  const bp = corpus.stripBoilerplate(skills, cfg)
  cfg.rank_checkpoint = path.join(outDir, 'rank_scores.json')
  if (cfg.judge_cache && !cfg.judge_cache_path) cfg.judge_cache_path = path.join(outDir, 'judge_cache.json')
  const stages = buildScanStages().map(s => s.id === 'judge' ? wrapJudgeStage(s, runner) : s)
  const res = await runPipeline({ cfg, out: outDir, stages, input: { skills }, signal, onProgress })
  if (!res.ok) return { ok: false, error: res.error, exitCode: res.exitCode }
  const degradation = assessDegradation({ res, cfg })
  const pairs = res.stages.find(s => s.id === 'candidates')?.data?.pairs
  let ledgerAfter
  if (cfg.ledger_path) {
    const allPairs = [...pairs.keys()].map(k => k.split('\u0000'))
    ledger.mark(cfg.ledger_path, allPairs, { run_out: outDir })
    ledgerAfter = Object.keys(ledger.load(cfg.ledger_path)).length
  }
  const built = report.buildScanReport({ cfg, res, roots: o.corpus, skills, bp, ledgerAfter, degradation, command: null, generatedAt: null })
  report.writeArtifacts(outDir, { cfg, config: cfg, report: built.reportDoc, markdown: report.candidatesMarkdown({ rows: built.verdicts, rerankStats: built.rerankStats, rankPlan: built.rankPlan, judgeFallback: built.judgeFallback }), candidatesRows: report.candidatesCsvRows(built.verdicts), pairsRows: report.pairsCsvRows(built.verdicts) })
  return { ok: true, reportDoc: built.reportDoc, sections: built.sections, degradation, strictFail: cfg.strict === true && degradation.degraded }
}

// The vendored engine is byte-frozen: it reads these two keys from process.env.
// This wrapper is the only credential bridge; values are applied for the scan and
// left in place for the next scan (the same placement the historical env path used).
const CREDENTIAL_ENV = Object.freeze({
  embedding: 'SILICONFLOW_API_KEY',
  ranker: 'BAMBOO_API_KEY',
})
const appliedCredentials = new Map()

function applyRetrievalCredentials(credentials) {
  for (const [field, envName] of Object.entries(CREDENTIAL_ENV)) {
    const value = credentials === undefined ? undefined : credentials[field]
    const applied = appliedCredentials.get(envName)
    if (typeof value === 'string' && value !== '') {
      if (applied === undefined) appliedCredentials.set(envName, { previous: process.env[envName] })
      process.env[envName] = value
      continue
    }
    if (applied !== undefined) {
      if (applied.previous === undefined) delete process.env[envName]
      else process.env[envName] = applied.previous
      appliedCredentials.delete(envName)
    }
  }
}

/** Drop any UI-supplied keys and restore the ambient env values (plugin unload/test). */
export function clearRetrievalCredentials() {
  applyRetrievalCredentials(undefined)
}

async function screenOnce(input) {
  const { corpusDir, outDir, signal, onProgress, runner } = input
  if (!corpusDir || !outDir) return { ok: false, error: { code: 'BAD_INPUT', detail: 'corpusDir/outDir required' } }
  const cfg = makeConfig(input.cfg ?? {})
  try {
    const resolvedJudge = resolveJudge(cfg, process.env)
    if (resolvedJudge.mode === 'deepseek') {
      if (!runner) return { ok: false, error: { code: 'RUNNER_REQUIRED', stage: 'judge', retryable: false } }
      const scan = await runWithRunner({ corpusDir, outDir, cfg, signal, onProgress, runner })
      if (!scan.ok) return { ok: false, error: { code: 'SCAN_FAILED', stage: 'pipeline', detail: String(scan.error ?? ''), exitCode: scan.exitCode } }
      return { ok: true, report: { ...scan, envelope: envelope(corpusDir, outDir) } }
    }
    const scan = await runScan({ corpus: [corpusDir], out: outDir, cfg, signal, onProgress })
    if (!scan.ok) return { ok: false, error: { code: 'SCAN_FAILED', stage: 'pipeline', detail: String(scan.error ?? ''), exitCode: scan.exitCode } }
    return { ok: true, report: { reportDoc: scan.reportDoc, sections: scan.sections, degradation: scan.degradation, strictFail: scan.strictFail, envelope: envelope(corpusDir, outDir) } }
  } catch (err) {
    return { ok: false, error: { code: 'ENGINE_ERROR', detail: String(err && err.stack || err) } }
  }
}

export async function screen(input) {
  applyRetrievalCredentials(input.credentials)
  return await screenOnce(input)
}

export function probe(cfgInput) {
  const cfg = makeConfig(cfgInput ?? {})
  const int8 = cfg.embedder_model ? join(cfg.embedder_model, 'config.json') : ''
  const pca = cfg.embedder_model_last ? join(cfg.embedder_model_last, 'config.json') : ''
  const models = int8 && pca && existsSync(int8) && existsSync(pca) ? 'ok' : 'missing'
  return { models, judge: cfg.judge === 'deepseek' ? 'platform' : 'stub', ranker: cfg.rank_mode === 'vec' ? 'vec' : 'auto', onnx: false }
}

export async function ensureModels(cfgInput) {
  const cfg = makeConfig(cfgInput ?? {})
  const resolved = await resolveModels({ cfg, rootDir: cfg.models_dir || undefined })
  return { ok: true, models: 'ok', dirs: resolved.dirs }
}
