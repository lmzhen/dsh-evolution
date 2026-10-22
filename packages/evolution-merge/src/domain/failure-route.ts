/** Pure failure routing for merge errors. */
export type MergeFailureRoute = 
  | { readonly kind: 'parameter'; readonly reportOnly: false }
  | { readonly kind: 'source-gone'; readonly reportOnly: true }
  | { readonly kind: 'target-taken'; readonly reportOnly: true }
  | { readonly kind: 'validation'; readonly reportOnly: true }
  | { readonly kind: 'commit'; readonly reportOnly: true }
  | { readonly kind: 'schema'; readonly reportOnly: true }
  | { readonly kind: 'runtime'; readonly reportOnly: true }

const PARAMETER = new Set(['bad-pair', 'bad-target', 'bad-flag', 'usage'])
const SOURCE_GONE = new Set(['source-gone', 'source-missing'])
const TARGET_TAKEN = new Set(['target-taken', 'target-exists'])
const VALIDATION = new Set(['validation-failed', 'invalid-decision'])
const COMMIT = new Set(['commit-failed', 'commit-refused'])
const SCHEMA = new Set(['schema-invalid', 'schema-version'])

export function routeFailure(code: string): MergeFailureRoute {
  if (PARAMETER.has(code)) return { kind: 'parameter', reportOnly: false }
  if (SOURCE_GONE.has(code)) return { kind: 'source-gone', reportOnly: true }
  if (TARGET_TAKEN.has(code)) return { kind: 'target-taken', reportOnly: true }
  if (VALIDATION.has(code)) return { kind: 'validation', reportOnly: true }
  if (COMMIT.has(code)) return { kind: 'commit', reportOnly: true }
  if (SCHEMA.has(code)) return { kind: 'schema', reportOnly: true }
  return { kind: 'runtime', reportOnly: true }
}
