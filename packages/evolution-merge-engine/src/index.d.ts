export interface EngineCfg { [key: string]: unknown }
export interface ScreenInput { corpusDir: string; outDir: string; cfg?: EngineCfg; signal?: AbortSignal; onProgress?: (p: { stage: string; done?: number; total?: number }) => void; runner?: (prompt: string, cfg?: Record<string, unknown>) => Promise<string>; onUsage?: (u: unknown) => void }
export interface EngineReport { reportDoc: Record<string, unknown>; sections: Record<string, unknown>; degradation: unknown; strictFail: boolean; envelope: Record<string, unknown> }
export type ScreenResult = { ok: true; report: EngineReport } | { ok: false; error: { code: string; stage?: string; retryable?: boolean; detail?: string; exitCode?: number } }
export declare function runPipeline(input: Record<string, unknown>): Promise<unknown>
export declare function buildScanStages(): unknown[]
export declare function makeConfig(overrides?: Record<string, unknown>): Record<string, unknown>
export declare function runScan(input: Record<string, unknown>): Promise<unknown>
export declare function screen(input: ScreenInput): Promise<ScreenResult>
export declare function probe(cfg?: EngineCfg): { models: 'ok' | 'missing' | 'partial'; judge: string; ranker: string; onnx: boolean }
export declare function ensureModels(): Promise<never>
export declare function selectCandidates(report: Record<string, unknown>): unknown
