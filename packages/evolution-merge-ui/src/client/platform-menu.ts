/**
 * The one seam onto the platform's menu material and rows.
 *
 * The family bundle keeps `@deepseek-ai/*` external, so the platform components are reached through
 * the loader-provided `require` (the same door the Markdown seam uses). A deployment without the
 * row gets the panel's own menu fallback; the platform path is not a hard dependency.
 * @module dsh-evolution-merge-ui/client
 */
import { createElement, type ReactNode } from 'react'

/** The platform's menu surface: a styled container that accepts div props. */
export type MenuSurfaceComponent = (props: Record<string, unknown> & { children?: ReactNode }) => ReactNode
/** The platform's menu row: role=menuitem plus selected/disabled/danger semantics. */
export type MenuItemButtonComponent = (props: {
  children: ReactNode
  current?: boolean
  disabled?: boolean
  danger?: boolean
  separatorBefore?: boolean
  onSelect: () => void
}) => ReactNode

/** The two components this panel consumes from one platform module row. */
export interface MenuPrimitives {
  MenuSurface: MenuSurfaceComponent
  MenuItemButton: MenuItemButtonComponent
}

const PLATFORM_UI_MODULE = '@deepseek-ai/dsh-client-ui-primitives'

/** One row of the coordinate menu, independent of the renderer. */
export interface RowMenuAction {
  readonly id: string
  readonly label: string
  readonly onSelect: () => void
  readonly separatorBefore?: boolean
}

/**
 * Render the coordinate menu through the platform primitives.
 * @param primitives - the platform MenuSurface/MenuItemButton pair.
 * @param actions - rows in display order.
 * @param label - accessible menu name.
 * @param style - fixed position computed from the pointer.
 * @returns the menu element.
 */
export function renderPlatformMenu(primitives: MenuPrimitives, actions: readonly RowMenuAction[], label: string, style: Record<string, string | number>): ReactNode {
  return createElement(primitives.MenuSurface, {
    'data-role': 'sort-menu', 'data-platform': 'true', role: 'menu', 'aria-label': label, style,
  }, actions.map(action => createElement(primitives.MenuItemButton, {
    key: action.id,
    children: action.label,
    ...(action.separatorBefore === true ? { separatorBefore: true } : {}),
    onSelect: action.onSelect,
  })))
}

/**
 * Accept only the two component functions; a namespace row without them is not a menu.
 * @param row - the module row's exports.
 * @returns the two components, or undefined.
 */
export function menuPrimitivesFrom(row: Record<string, unknown>): MenuPrimitives | undefined {
  const surface = row.MenuSurface
  const item = row.MenuItemButton
  if (typeof surface !== 'function' || typeof item !== 'function') return undefined
  return { MenuSurface: surface as MenuSurfaceComponent, MenuItemButton: item as MenuItemButtonComponent }
}

/** The module-table row, when this deployment carries it. */
export const PLATFORM_MENU: MenuPrimitives | undefined = (() => {
  try {
    // oxlint-disable-next-line typescript/no-require-imports -- the client module table is reachable only through the loader's require
    return menuPrimitivesFrom(require(PLATFORM_UI_MODULE) as Record<string, unknown>)
  } catch {
    return undefined
  }
})()
