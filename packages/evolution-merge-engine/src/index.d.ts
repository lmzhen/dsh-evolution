export declare function runPipeline(input: Record<string, unknown>): Promise<unknown>;
export declare function buildScanStages(): unknown[];
export declare function makeConfig(overrides?: Record<string, unknown>): Record<string, unknown>;
export declare function runScan(input: Record<string, unknown>): Promise<unknown>;
export declare function screen(input: import('./types.ts').ScreenInput): Promise<import('./types.ts').ScreenResult>;
export declare function probe(cfg?: import('./types.ts').EngineCfg): { models: 'ok' | 'missing' | 'partial'; judge: string; ranker: string; onnx: boolean };
export declare function ensureModels(): Promise<never>;
