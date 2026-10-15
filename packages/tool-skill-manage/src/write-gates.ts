/**
 * G1/1.2: the write-admission sequence moved to its nouns' home.
 *
 * The gate table used to be package-private to this tool, so every other write entry point - the graph
 * commands above all - either bypassed it or copied its semantics (audit: approval mirrors the confirm
 * vocabulary "mirrored, not imported"). It now lives in evolution-core next to `write-authority.ts`, and
 * this file re-exports it unchanged so nothing importing from here has to move.
 *
 * @module @deepseek-ai/dsh-tool-skill-manage/write-gates
 */
export * from '@deepseek-ai/dsh-evolution-core'
