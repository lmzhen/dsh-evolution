/**
 * Host half of the merge UI package: it registers nothing. The Loader discovers the
 * `dsh.client` manifest and serves `./client` to the page; this entry exists so the row
 * is a valid plugin.
 */
export const name = 'evolution-merge-ui'
export const inject: string[] = []
export function apply(): void {}
