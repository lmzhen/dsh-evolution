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

export async function screen(input) {
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

export function probe(cfgInput) {
  const cfg = makeConfig(cfgInput ?? {})
  const int8 = cfg.embedder_model ? join(cfg.embedder_model, 'config.json') : ''
  const pca = cfg.embedder_model_last ? join(cfg.embedder_model_last, 'config.json') : ''
  const models = int8 && pca && existsSync(int8) && existsSync(pca) ? 'ok' : 'missing'
  return { models, judge: cfg.judge === 'deepseek' ? 'platform' : 'stub', ranker: cfg.rank_mode === 'vec' ? 'vec' : 'auto', onnx: false }
}

export async function ensureModels() {
  throw new Error('ensureModels is implemented in G3')
}
