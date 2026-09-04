/**
 * @deepseek-ai/dsh-evolution-all — aggregate entry package.
 *
 * Deliberately passive: no composition rows of its own. Its substance is the
 * dependency closure — `evolution-host` (infrastructure + control plane) plus
 * the three model-tool packages (`tool-memory`, `tool-skill-manage`,
 * `evolution-skill-catalog`) — so `dsh plugin add @lmzhen/dsh-evolution-all`
 * installs the complete family in one command (the host bundle's patch rows
 * carry the profile composition; the model tools mount via the Evolution
 * agent preset). This module carries no runtime API.
 * @module @deepseek-ai/dsh-evolution-all
 */

export {}
