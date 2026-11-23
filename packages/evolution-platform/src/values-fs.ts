/** Narrow file-lock surface: keeps the platform VALUES barrel (which also
 * re-exports LLM/agent/tool runtime values) out of low-level family modules.
 * @module @deepseek-ai/dsh-evolution-platform/values/fs
 */
export { withFileLock } from '@deepseek-ai/dsh-atomic-write'
