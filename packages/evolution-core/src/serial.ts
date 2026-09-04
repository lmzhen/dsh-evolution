/**
 * A process-local serial task queue: each task starts only after the previous
 * one settles (success or failure), so read-modify-write sequences that share
 * one file never interleave inside this process. The durable cross-process
 * serialization layer is the IO backend's transact lock; this chain is the
 * second layer (0.3.17 S2.8, T-1: the shape was duplicated in state-json and
 * memory-files — one factory now).
 */
export function makeSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let chain: Promise<unknown> = Promise.resolve()
  return (task) => {
    const run = chain.then(task, task)
    chain = run.then(() => undefined, () => undefined)
    return run
  }
}
