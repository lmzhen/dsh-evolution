/**
 * Lock fixtures for the specs that exercise the write-lock protocol.
 *
 * `DEAD_PID` has to be a pid NO live process can hold: above Linux's default `pid_max`
 * (4194304) and outside the range Windows assigns (multiples of four, small in practice). A
 * fabricated small pid is not good enough — `4242` was a LIVE pid on a windows-latest runner,
 * so a "stranded" lock looked live, the sweep kept it, and `skill-store-boundary.spec.ts`
 * failed there while passing on Linux. The counterpart (a live FOREIGN holder) is a spawned
 * child pid — see `spawnLivePid` in `io.spec.ts`.
 */
export const DEAD_PID = 0x7ffffffc

/**
 * A writer-lock body owned by {@link DEAD_PID} (the io layer's `<pid>:<token>` shape).
 * @param token - the claim token; defaults to a fixed literal for readable fixtures.
 * @returns the lock body text.
 */
export function deadLockBody(token = 'deadbeef'): string {
  return `${DEAD_PID}:${token}`
}
