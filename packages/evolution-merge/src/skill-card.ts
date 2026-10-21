export interface SkillCard {
  readonly name: string
  readonly description: string
  readonly body: string
  readonly files?: readonly { readonly path: string; readonly content: string }[]
}
