// Session-event classification for EVERY family reader (G6-S1; C-03/C-05).
//
// Platform contract: native session events are the model-visible content frames; a plugin record is
// an `ignorable: true` event whose type is `plugin:<name>` (session/src/index.ts pluginRecordOf).
// Family readers must classify BEFORE they count or index: unknown frames are tolerated (never
// interpreted, never written), plugin records are tolerated read-only. The family never appends
// plugin records.
// The platform rule is `pluginRecordOf(event) = ignorable && type startsWith('plugin:')`
// (session/src/index.ts). Spelled structurally here: the preflight's machine-state resolution can
// point at an older session closure than the platform line this build targets, so importing the
// helper would make the contract depend on the bed rather than on the rule.

export type SessionEventClass = 'model' | 'plugin-record' | 'unknown'

/** Frames the model authored/saw (the only frames evidence, reads and usage accounting may consume). */
export const MODEL_SESSION_EVENTS = Object.freeze(['user/message', 'assistant/message', 'tool/call', 'tool/result'] as const)

const MODEL_EVENT_TYPES: ReadonlySet<string> = new Set(MODEL_SESSION_EVENTS)

/** Classify one session event WITHOUT interpreting it (pure). */
export function classifySessionEvent(event: { readonly type?: unknown; readonly ignorable?: unknown }): SessionEventClass {
  const type = typeof event.type === 'string' ? event.type : ''
  if (type.startsWith('plugin:')) {
    return event.ignorable === true ? 'plugin-record' : 'unknown'
  }
  return MODEL_EVENT_TYPES.has(type) ? 'model' : 'unknown'
}

/** True when the event must be skipped by evidence/usage readers (tolerant, never fatal). */
export function isIgnorableEvent(event: { readonly type?: unknown; readonly ignorable?: unknown }): boolean {
  return classifySessionEvent(event) !== 'model'
}
