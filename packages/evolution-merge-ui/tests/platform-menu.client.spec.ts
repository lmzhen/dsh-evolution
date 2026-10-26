// @tier fast
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { menuPrimitivesFrom, renderPlatformMenu } from '../src/client/platform-menu.ts'

it('accepts only a module row with both menu components', () => {
  const Surface = (): null => null
  const Item = (): null => null
  expect(menuPrimitivesFrom({ MenuSurface: Surface, MenuItemButton: Item })).toMatchObject({ MenuSurface: Surface, MenuItemButton: Item })
  expect(menuPrimitivesFrom({ MenuSurface: Surface })).toBeUndefined()
  expect(menuPrimitivesFrom({ MenuSurface: 'x', MenuItemButton: Item })).toBeUndefined()
  expect(menuPrimitivesFrom({})).toBeUndefined()
})

it('renders the coordinate menu through MenuSurface and MenuItemButton', () => {
  const Surface = (props: Record<string, unknown> & { children?: unknown }): unknown => createElement('div', props, props.children as never)
  const Item = (props: { children: unknown; separatorBefore?: boolean; onSelect: () => void }): unknown => createElement('button', { type: 'button', 'data-separator': props.separatorBefore === true ? 'true' : undefined, onClick: props.onSelect }, props.children as never)
  const html = renderToStaticMarkup(createElement(() => renderPlatformMenu({ MenuSurface: Surface as never, MenuItemButton: Item as never }, [
    { id: 'top', label: 'Top', onSelect: () => {} },
    { id: 'bottom', label: 'Bottom', onSelect: () => {} },
    { id: 'cancel', label: 'Cancel', separatorBefore: true, onSelect: () => {} },
  ], 'Sort', { position: 'fixed', left: '20px', top: '30px' })))
  expect(html).toContain('role="menu"')
  expect(html).toContain('aria-label="Sort"')
  expect(html).toContain('data-platform="true"')
  expect(html).toContain('Top')
  expect(html).toContain('data-separator="true"')
})
