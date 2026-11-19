/**
 * The profile-context half of the family's platform contract.
 */
export interface ProfileContextPort {
  readonly name: string
  readonly dir: string
  readonly patchPath?: string
  readonly startedBundles?: readonly string[]
}
