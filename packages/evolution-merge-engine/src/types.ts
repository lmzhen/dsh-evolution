export type ModelStatus = 'ok' | 'missing' | 'partial'
export type RankSource = 'api' | 'local' | 'vec'
export type JudgeMode = 'stub' | 'stub2' | 'deepseek' | 'auto'
export type EngineStage = 'prefilter' | 'candidates' | 'lexical' | 'provision' | 'rank_plan' | 'semantic' | 'rerank' | 'judge'

export interface EngineCfg {
  models_dir?: string
  offline?: boolean
  auto_provision?: boolean
  hf_endpoint?: string
  embed_backend?: 'chain' | 'local' | 'onnx' | 'remote'
  embedder_model?: string
  embedder_model_last?: string
  strict?: boolean
  write_prompts?: boolean
  rank_mode?: 'auto' | 'local' | 'api' | 'vec'
  rank_server?: string
  rank_server_q8?: string
  rank_server_q4?: string
  rank_local_chain?: string
  rank_n?: number
  rank_concurrency?: number
  rank_vec_topk?: number
  semantic_top_n?: number
  semantic_top_n_wide?: number
  judge?: JudgeMode
  judge_model?: string
  judge_effort?: string
  judge_cache?: boolean
  seed_mode?: 'run' | 'fixed'
  audit_seed?: number
  ledger_path?: string
  emit_only_new?: boolean
  tokenizer_cache?: boolean
  tokenizer_cache_dir?: string
  lsh_floor?: number
  round_count?: number
}

export interface EngineReport {
  reportDoc: Record<string, unknown>
  sections: Record<string, unknown>
  degradation: { degraded: boolean; reason_code?: string; reasons: { code: string; stage?: string; detail?: string }[]; attempts?: unknown[] }
  strictFail: boolean
  envelope: { corpusDir: string; outDir: string; modelSha: string; engineVersion: string }
}

export type ScreenResult =
  | { ok: true; report: EngineReport }
  | { ok: false; error: { code: string; stage?: string; retryable?: boolean; detail?: string; exitCode?: number } }

export type JudgeRunner = (prompt: string, cfg: Record<string, unknown>) => Promise<string>
export interface ScreenInput {
  corpusDir: string
  outDir: string
  cfg?: EngineCfg
  signal?: AbortSignal
  onProgress?: (p: { stage: string; done?: number; total?: number }) => void
  runner?: JudgeRunner
  onUsage?: (u: unknown) => void
}
