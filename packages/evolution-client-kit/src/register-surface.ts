/**
 * One registration verb for the family's client surfaces.
 *
 * Sidebar panels and workbench views keep their own seat implementations, but
 * feature packages call this single verb so a new surface kind cannot grow a
 * second registration style.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { registerSidebarPanel, type SidebarPanelSpec } from './panel.ts'
import { registerWorkbenchView, type WorkbenchViewSpec } from './workbench-view.ts'

export type SurfaceSpec<Face> =
  | ({ readonly surface: 'sidebar' } & SidebarPanelSpec<Face>)
  | ({ readonly surface: 'workbench' } & WorkbenchViewSpec<Face>)

export function registerSurface<Face>(ctx: ClientContext, spec: SurfaceSpec<Face>): void {
  if (spec.surface === 'sidebar') registerSidebarPanel(ctx, spec)
  else registerWorkbenchView(ctx, spec)
}
