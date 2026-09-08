/**
 * @deepseek-ai/dsh-evolution-all — full-functionality evolution bundle
 * (DEFAULT install target, 0.3.54).
 *
 * This package carries its own `dsh.bundle.patch` (`cordis.patch.yml`) whose
 * row set is the evolution-host infrastructure plane ∪ the four model-facing
 * tool rows (`tool-memory`, `tool-skill-manage`, `tool-session-query`,
 * `evolution-skill-catalog`), all mounted at PROFILE-ROOT level:
 * `dsh plugin add @lmzhen/dsh-evolution-all` is the "most complete first"
 * install — every session gets the background automation AND the memory /
 * skill tools AND the SKILLS/MEMORY guidance injection, with no agent-preset
 * step and no session choice.
 *
 * Package-selection is the shrink path: `@lmzhen/dsh-evolution-host` keeps the
 * same infra rows minus model tools (a profile can still run automation
 * without exposing `memory`/`skill_manage` to every session).
 *
 * 0.3.54 contract changes over the passive-aggregate era (H-08):
 *   • all is now a BUNDLE (row set), not a dependency-only aggregate — the old
 *     "one command installs packages but mounts only infra" behavior is gone;
 *   • all / host / one-click preset are ALTERNATIVE install targets (mounting
 *     two fails loud at startup: invariants "already registered");
 *   • all is ALSO exclusive with the layered Evolution agent preset (the
 *     preset scope's model rows would double-mount the tools); use layered =
 *     host + `/evolution preset install` if per-session tool choice is wanted.
 * This module carries no runtime API beyond the invariant.
 * @module @deepseek-ai/dsh-evolution-all
 */

export {}
