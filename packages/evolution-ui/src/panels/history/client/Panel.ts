/**
 * The skill page: a thin frame around the list, the detail and the state hook.
 *
 * The state machine lives in `skills/useSkillHistory.ts`; the markup lives in `skills/SkillList.ts` and
 * `skills/SkillDetail.ts`. This file only wires them together, so adding a view or a control does not
 * grow the state machine again.
 * @module @deepseek-ai/dsh-evolution-ui/panels/history/client
 */
import { createElement, type ReactNode } from 'react'
import type { Copy } from './chrome.ts'
import { SkillList } from './skills/SkillList.ts'
import { SkillDetail } from './skills/SkillDetail.ts'
import { useSkillHistory } from './skills/useSkillHistory.ts'
import type { GovernanceRow, HealthPayload, SkillRow, VersionBodyRow, VersionDiffRow, VersionsPayload } from './api.ts'
import type { SkillStatsSnapshot } from '@deepseek-ai/dsh-evolution-core/skills'
import type { MarkdownWords } from './markdown.ts'

/** What the panel is handed: the dictionary seat, the renderer's words, and the host's callbacks. */
export interface PanelFace extends Copy {
  /** The two words the platform Markdown renderer needs; the dictionary owns them. */
  readonly markdownWords: MarkdownWords
  readonly loadSkills: () => Promise<readonly SkillRow[]>
  readonly loadVersions: (name: string) => Promise<VersionsPayload>
  readonly loadGovernance?: () => Promise<readonly GovernanceRow[]>
  readonly loadHealth?: () => Promise<HealthPayload>
  readonly loadStats?: () => Promise<SkillStatsSnapshot>
  readonly loadDiff: (name: string, v: number) => Promise<VersionDiffRow>
  readonly loadBody: (name: string, v: number) => Promise<VersionBodyRow>
  readonly undo: (name: string, v?: number, unitId?: string) => Promise<string>
  /** One explicit navigation request: select this skill when the revision is new. */
  readonly focusSkill?: string | undefined
  readonly focusRevision?: number | undefined
}

/**
 * The panel body.
 * @param face - copy plus the data callbacks.
 * @returns the panel element.
 */
export function SkillHistoryPanel(face: PanelFace): ReactNode {
  const history = useSkillHistory(face)
  return createElement('div', { className: 'evo-hist-frame' },
    createElement('div', { className: 'evo-hist-root' },
      createElement(SkillList, {
        copy: face,
        query: history.query,
        onQuery: history.onQuery,
        skills: history.skills,
        visible: history.visible,
        skillsLoaded: history.skillsLoaded,
        selected: history.selected,
        onOpen: history.onOpen,
        healthByName: history.healthByName,
      }),
      createElement(SkillDetail, {
        copy: face,
        onRefresh: history.onRefresh,
        selected: history.selected,
        noteText: history.noteText,
        noteError: history.noteError,
        governance: history.governance,
        counts: history.counts,
        failureNode: history.failureNode,
        skills: history.skills,
        skillsLoaded: history.skillsLoaded,
        loaded: history.loaded,
        versionsFailed: history.versionsFailed,
        model: history.model,
        pending: history.pending,
        expanded: history.expanded,
        expandedOf: history.expandedOf,
        onRestore: history.onRestore,
        onCancelRestore: history.onCancelRestore,
        onToggle: history.onToggle,
      }),
    ),
  )
}
