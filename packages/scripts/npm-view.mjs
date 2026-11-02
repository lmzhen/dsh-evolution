/**
 * Classify one npm registry READ. Only a definite "not found" may be treated as
 * absent: a timeout, proxy failure or auth error must abort a release, never
 * re-publish a version or report a package missing.
 * @module scripts/lib/npm-view
 */

/** npm/registry spellings of a MISSING package or version. */
const ABSENT = /E404|404 Not Found|No matching version found|is not in this registry/i

/** Whether one npm view failure proves the target does not exist. */
export function isAbsentViewError(error) {
  const text = String(error?.stderr ?? '') + String(error?.message ?? '')
  return ABSENT.test(text)
}

/**
 * Run one view command and classify its outcome.
 * @param run - synchronous command runner.
 * @returns present stdout, absent, or error.
 */
export function viewOutcome(run) {
  try {
    return { kind: 'present', stdout: String(run()) }
  } catch (error) {
    if (isAbsentViewError(error)) return { kind: 'absent' }
    return { kind: 'error', error }
  }
}
