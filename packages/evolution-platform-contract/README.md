# `@lmzhen/dsh-evolution-platform-contract`

Pure family-facing platform contract for the dsh-evolution family.

- `CONTRACT`: the family-facing contract generation.
- `PlatformCapability`: semantic host capability names.
- `PlatformCapabilities`: the live capability set the adapter resolves.
- `Result` / `FamilyError`: the family's typed result vocabulary.
- Port interfaces: `agents`, `commands`, `connection`, `llm`, `platformView`,
  `presets`, `profileContext`, `projections`, `settings`, `skills`,
  `storageDomain`, `subagents`, `systemPrompt`, `tools`, `userQuestions`,
  `workingDirectory`, and the resolved `HostPlatformPorts` table.

This package carries no runtime host import. The host adapter is
`@lmzhen/dsh-evolution-adapter`; feature packages depend on the contract for
types and on the adapter for host-provided runtime helpers.

The contract number changes only when the family-facing port surface changes
in a way the adapter cannot hide; host releases do not change it by
themselves.
