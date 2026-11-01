/**
 * The four atoms the panel's tool face is built from (G3, §15.2 L2a atoms).
 *
 * Why atoms at all: the row used to be assembled from five different elements that each wrote their
 * own classes, so "what a control looks like" was spread over the stylesheet and a click target, a
 * state chip, a refusal and a glyph had no vocabulary at all (W7/W9/W13/W14). Every interactive
 * element now says what it IS — a control that acts, a control that only reveals more, a state, a
 * notice — and the stylesheet answers once per kind.
 *
 * No words live here: an atom takes the copy its caller already resolved.
 * @module @deepseek-ai/dsh-evolution-skill-history/client
 */
import { createElement, type ReactNode } from 'react'

/** The register one control speaks in. `primary` is reserved for the click that writes. */
export type Tone = 'quiet' | 'primary'

/**
 * What a control DOES, which is what makes them distinguishable at a glance: one acts, one reveals
 * more (and shows whether it is open), one chooses between two views of the same thing.
 */
export type ControlKind = 'action' | 'toggle' | 'switch'

/** The glyphs the panel draws. The platform's own arrows are text characters, which render in the
 * reader's fallback font at whatever weight it has (W7); a drawn path cannot. */
export type IconName = 'chevron-right' | 'chevron-down' | 'alert'

/** The stroked path of one glyph, in a 16x16 box. */
const PATHS: Readonly<Record<IconName, readonly string[]>> = {
  'chevron-right': ['M6.5 3.5L11 8l-4.5 4.5'],
  'chevron-down': ['M3.5 6.5L8 11l4.5-4.5'],
  alert: ['M8 2.5l5.5 10.5h-11z', 'M8 6.6v3.1', 'M8 11.4h.01'],
}

/**
 * One drawn glyph.
 * @param name - which glyph.
 * @returns an inline SVG that takes the surrounding colour and type size.
 */
export function icon(name: IconName): ReactNode {
  return createElement('svg', {
    className: 'evo-hist-icon',
    viewBox: '0 0 16 16',
    width: '1em',
    height: '1em',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  }, PATHS[name].map((d, index) => createElement('path', { key: index, d })))
}

/** What every atom takes. */
interface BaseProps {
  /** React key, for the callers that build lists. */
  readonly key?: string
  /** The copy, already resolved by the dictionary seat. */
  readonly children: ReactNode
}

/** One control. `kind` says whether it acts or only reveals; `tone` says whether it writes. */
export interface ButtonProps extends BaseProps {
  readonly kind?: ControlKind
  readonly tone?: Tone
  /** Hover text, when the label alone is ambiguous. */
  readonly title?: string
  /** Whether the thing this control reveals is currently open (`aria-expanded`). */
  readonly expanded?: boolean
  /** Whether this control is the side of a two-way choice that is showing. */
  readonly pressed?: boolean
  readonly onClick: () => void
}

/**
 * One control.
 * @param props - what it is, how it speaks, and what it does.
 * @returns the button element.
 */
export function button(props: ButtonProps): ReactNode {
  const { children, kind = 'action', tone = 'quiet', title, expanded, pressed, onClick } = props
  return createElement('button', {
    key: props.key,
    type: 'button',
    className: 'evo-hist-button',
    'data-kind': kind,
    'data-tone': tone,
    title,
    'aria-expanded': expanded,
    'aria-pressed': pressed,
    onClick,
  }, kind === 'toggle' ? icon(expanded === true ? 'chevron-down' : 'chevron-right') : null, children)
}

/**
 * One state, spelled as a chip: never clickable, never in the primary colour (W9).
 * @param props - the copy.
 * @returns the chip element.
 */
export function chip(props: BaseProps): ReactNode {
  return createElement('span', { key: props.key, className: 'evo-hist-chip' }, props.children)
}

/** One notice: a sentence about what just happened, or why nothing did. */
export interface NoteProps extends BaseProps {
  /** Whether this is a refusal or a failure, which colours it and adds the glyph (W13). */
  readonly error?: boolean
}

/**
 * One notice.
 * @param props - the copy, and whether it reports a failure.
 * @returns the note element.
 */
export function note(props: NoteProps): ReactNode {
  return createElement('p', { key: props.key, className: 'evo-hist-note', 'data-error': props.error === true ? 'true' : undefined },
    props.error === true ? icon('alert') : null,
    createElement('span', { className: 'evo-hist-note-text' }, props.children))
}
