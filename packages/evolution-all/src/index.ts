/**
 * @deepseek-ai/dsh-evolution-all — aggregate entry package.
 *
 * Deliberately passive: no composition rows of its own. Its substance is the
 * dependency closure — `evolution-host` (infrastructure + control plane), the
 * three model-tool packages (`tool-memory`, `tool-skill-manage`,
 * `evolution-skill-catalog`) and `evolution-agent-preset` (the delta preset
 * composition the installed preset is generated from; V6-52, 0.3.37) — so
 * `dsh plugin add @lmzhen/dsh-evolution-all` installs every family PACKAGE in
 * one command.
 *
 * H-08: "all packages installed" is NOT "model tools live in
 * sessions". Only the host bundle's rows mount automatically; the model-facing
 * tool rows are carried by the Evolution agent preset, and NOTHING registers
 * that preset for you. After installing this package you must do one of:
 *   • run the layered installer (`install-layered --mode agent`) to generate
 *     the Evolution agent preset from the runtime standard, or
 *   • produce/select the Evolution preset manually (e.g. `/evolution preset
 *     install`, then pick it in the session switcher).
 * Until then sessions see only the host bundle — no `memory`, no `skill_manage`,
 * no skill catalog. This module carries no runtime API.
 * @module @deepseek-ai/dsh-evolution-all
 */

export {}
