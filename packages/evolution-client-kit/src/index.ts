/** Shared browser seams and panel lifecycle for the evolution family. */
export type { ClientSeam, ConfigFormLike, ConfigFormSnapshotLike, ConfigFormsSeat, LocaleSeat, PanelBodyOptions, PanelRowOptions, SettingsFace, SlotsSeat } from './seam.ts'
export { registerSidebarPanel, type SidebarPanelSpec, type Translate } from './panel.ts'
export { panelWorkspaceId } from './workspace.ts'
export { ROUTES } from './generated/routes.generated.ts'
export { FALLBACKS } from './generated/fallbacks.generated.ts'
export * from './generated/contracts.generated.ts'
export * from './generated/states.generated.ts'
export { TOKEN_CSS, TOKENS } from './tokens.ts'
