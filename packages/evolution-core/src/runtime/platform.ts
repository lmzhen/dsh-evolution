/**
 * Compatibility re-export of the adapter service.
 *
 * The concrete `EvolutionPlatform` service lives in
 * `@deepseek-ai/dsh-evolution-adapter`; core runtime still mounts it while P0
 * keeps the existing composition order.
 *
 * @module @deepseek-ai/dsh-evolution-core/runtime/platform
 */
export { EvolutionPlatform } from '@deepseek-ai/dsh-evolution-adapter/service'
export type { HostPlatformPorts } from '@deepseek-ai/dsh-evolution-adapter/service'
