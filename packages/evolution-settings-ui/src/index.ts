/**
 * Host half of the evolution settings-UI package: it registers NOTHING.
 *
 * The cards are the browser half (`./client`). The Host halves that own the
 * settings namespaces are the plugins themselves (evolution-review, memory-files,
 * tool-memory, evolution-curator, tool-skill-manage), so this row carries no
 * service and no behaviour: disabling it removes the cards and nothing else.
 * @module @deepseek-ai/dsh-evolution-settings-ui
 */

export const name = 'evolution-settings-ui'

/** No Host dependency: the row exists so the Loader discovers the package's
 * `dsh.client` manifest and serves `./client` to the page. */
export const inject: string[] = []

/** Intentionally empty: the Host half owns no state and no registration. */
export function apply(): void {}
