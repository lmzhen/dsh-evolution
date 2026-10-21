export interface EngineScreenResult { readonly ok: boolean; readonly [key: string]: unknown }
export function screen(...args: unknown[]): Promise<EngineScreenResult>
export function selectCandidates(...args: unknown[]): unknown
