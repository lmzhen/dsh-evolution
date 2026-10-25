/** Static command-face fallback for a Facts read failure; the API fallback is unavailable then. */
export const FALLBACK_COMMANDS: readonly string[] = [
  '/evolution merge scan',
  '/evolution merge pair <a> <b>',
  '/evolution merge pending',
  '/evolution merge pending --expired',
  '/evolution merge skipped',
  '/evolution merge candidates',
  '/evolution merge status',
  '/evolution merge report',
  '/evolution doctor',
]
