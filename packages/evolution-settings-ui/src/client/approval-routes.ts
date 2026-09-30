/**
 * The approval paths this browser half calls.
 *
 * A browser half cannot import the host package's table at runtime (the family's client bundles treat
 * every `@deepseek-ai/*` specifier as external), so the literals are declared here and a spec compares
 * them against `APPROVAL_ROUTES` in `evolution-approval` — a rename on one side would otherwise surface
 * as a 404 in the GUI instead of in CI.
 * @module @deepseek-ai/dsh-evolution-settings-ui/client/approval-routes
 */

/** One path per call the pending card makes. */
export const APPROVAL_CLIENT_ROUTES = {
  pending: '/api/dsh-evolution/approval/pending',
  approve: '/api/dsh-evolution/approval/approve',
  reject: '/api/dsh-evolution/approval/reject',
  preview: '/api/dsh-evolution/approval/preview',
} as const
