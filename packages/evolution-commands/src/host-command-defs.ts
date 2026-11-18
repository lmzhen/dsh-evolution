/** Typed host-command definitions: one source for help, surface and dispatch. */
import type { CommandDef } from './command-catalog.ts'

export interface HostCommandDef extends CommandDef {
  readonly usageLine: string
}

export const HOST_COMMAND_DEFS: readonly HostCommandDef[] = [
  { id: 'merge', words: ['merge'], summaryKey: 'summary.merge', helpKey: 'help.merge', flags: [], positional: [], readOnly: false, needsRun: false, fallback: "merge <subcommand> [<args>]", usageLine: "merge <subcommand> [<args>]" },
  { id: 'pending', words: ['pending'], summaryKey: 'summary.pending', helpKey: 'help.pending', flags: [{ name: 'detail', kind: 'boolean' }], positional: [], readOnly: true, needsRun: false, fallback: "pending [--detail]", usageLine: "pending [--detail]" },
  { id: 'approve', words: ['approve'], summaryKey: 'summary.approve', helpKey: 'help.approve', flags: [], positional: [], readOnly: false, needsRun: false, fallback: "approve <id>", usageLine: "approve <id>" },
  { id: 'reject', words: ['reject'], summaryKey: 'summary.reject', helpKey: 'help.reject', flags: [], positional: [], readOnly: false, needsRun: false, fallback: "reject <id>", usageLine: "reject <id>" },
  { id: 'release', words: ['release'], summaryKey: 'summary.release', helpKey: 'help.release', flags: [], positional: [], readOnly: false, needsRun: false, fallback: "release <id>", usageLine: "release <id>" },
  { id: 'doctor', words: ['doctor'], summaryKey: 'summary.doctor', helpKey: 'help.doctor', flags: [{ name: 'json', kind: 'boolean' }], positional: [], readOnly: true, needsRun: false, fallback: "doctor [--json]", usageLine: "doctor [--json]" },
  { id: 'curator', words: ['curator'], summaryKey: 'summary.curator', helpKey: 'help.curator', flags: [], positional: [], readOnly: false, needsRun: false, fallback: "curator run|pause|resume|status|report|scope", usageLine: "curator run|pause|resume|status|report|scope" },
  { id: 'mutations', words: ['mutations'], summaryKey: 'summary.mutations', helpKey: 'help.mutations', flags: [], positional: [], readOnly: true, needsRun: false, fallback: "mutations", usageLine: "mutations" },
  { id: 'restore', words: ['restore'], summaryKey: 'summary.restore', helpKey: 'help.restore', flags: [], positional: [], readOnly: false, needsRun: false, fallback: "restore", usageLine: "restore" },
  { id: 'skill.restore', words: ['skill', 'restore'], summaryKey: 'summary.skill restore', helpKey: 'help.skill restore', flags: [], positional: [], readOnly: false, needsRun: false, fallback: "skill restore <name>", usageLine: "skill restore <name>" },
  { id: 'skill.history', words: ['skill', 'history'], summaryKey: 'summary.skill history', helpKey: 'help.skill history', flags: [], positional: [], readOnly: true, needsRun: false, fallback: "skill history <name>", usageLine: "skill history <name>" },
  { id: 'skill.undo', words: ['skill', 'undo'], summaryKey: 'summary.skill undo', helpKey: 'help.skill undo', flags: [{ name: 'to', kind: 'value' }], positional: [], readOnly: false, needsRun: false, fallback: "skill undo <name> [--to v<N>]", usageLine: "skill undo <name> [--to v<N>]" },
  { id: 'skill.pin', words: ['skill', 'pin'], summaryKey: 'summary.skill pin', helpKey: 'help.skill pin', flags: [], positional: [], readOnly: false, needsRun: false, fallback: "skill pin <name>", usageLine: "skill pin <name>" },
  { id: 'skill.unpin', words: ['skill', 'unpin'], summaryKey: 'summary.skill unpin', helpKey: 'help.skill unpin', flags: [], positional: [], readOnly: false, needsRun: false, fallback: "skill unpin <name>", usageLine: "skill unpin <name>" },
  { id: 'propose', words: ['propose'], summaryKey: 'summary.propose', helpKey: 'help.propose', flags: [], positional: [], readOnly: false, needsRun: false, fallback: "propose", usageLine: "propose" },
  { id: 'skills.health', words: ['skills', 'health'], summaryKey: 'summary.skills health', helpKey: 'help.skills health', flags: [], positional: [], readOnly: true, needsRun: false, fallback: "skills health", usageLine: "skills health" },
  { id: 'skills.refresh', words: ['skills', 'refresh'], summaryKey: 'summary.skills refresh', helpKey: 'help.skills refresh', flags: [], positional: [], readOnly: false, needsRun: false, fallback: "skills refresh", usageLine: "skills refresh" },
  { id: 'learn', words: ['learn'], summaryKey: 'summary.learn', helpKey: 'help.learn', flags: [], positional: [], readOnly: false, needsRun: false, fallback: "learn [request]", usageLine: "learn [request]" },
  { id: 'review', words: ['review'], summaryKey: 'summary.review', helpKey: 'help.review', flags: [], positional: [], readOnly: false, needsRun: false, fallback: "review [memory|skill|combined]", usageLine: "review [memory|skill|combined]" },
  { id: 'maintain', words: ['maintain'], summaryKey: 'summary.maintain', helpKey: 'help.maintain', flags: [{ name: 'timeout', kind: 'value' }, { name: 'facts', kind: 'boolean' }], positional: [], readOnly: false, needsRun: false, fallback: "maintain [--timeout=<ms> | --facts]", usageLine: "maintain [--timeout=<ms> | --facts]" },
  { id: 'maintain.status', words: ['maintain', 'status'], summaryKey: 'summary.maintain status', helpKey: 'help.maintain status', flags: [], positional: [], readOnly: true, needsRun: false, fallback: "maintain status [<id>]", usageLine: "maintain status [<id>]" },
  { id: 'maintain.report', words: ['maintain', 'report'], summaryKey: 'summary.maintain report', helpKey: 'help.maintain report', flags: [], positional: [], readOnly: true, needsRun: false, fallback: "maintain report [<id>]", usageLine: "maintain report [<id>]" },
  { id: 'maintain.handoff', words: ['maintain', 'handoff'], summaryKey: 'summary.maintain handoff', helpKey: 'help.maintain handoff', flags: [], positional: [], readOnly: false, needsRun: false, fallback: "maintain handoff [<id>]", usageLine: "maintain handoff [<id>]" },
  { id: 'maintain.cancel', words: ['maintain', 'cancel'], summaryKey: 'summary.maintain cancel', helpKey: 'help.maintain cancel', flags: [], positional: [], readOnly: false, needsRun: false, fallback: "maintain cancel [<id>]", usageLine: "maintain cancel [<id>]" },
  { id: 'params', words: ['params'], summaryKey: 'summary.params', helpKey: 'help.params', flags: [{ name: 'group', kind: 'value' }, { name: 'json', kind: 'boolean' }], positional: [], readOnly: true, needsRun: false, fallback: "params [--group <name>] [--json]", usageLine: "params [--group <name>] [--json]" },
  { id: 'offload', words: ['offload'], summaryKey: 'summary.offload', helpKey: 'help.offload', flags: [{ name: 'heading', kind: 'value' }, { name: 'dry-run', kind: 'boolean' }], positional: [], readOnly: false, needsRun: false, fallback: "offload <name> [--heading <heading>] [--dry-run]", usageLine: "offload <name> [--heading <heading>] [--dry-run]" },
  { id: 'condense', words: ['condense'], summaryKey: 'summary.condense', helpKey: 'help.condense', flags: [{ name: 'dry-run', kind: 'boolean' }], positional: [], readOnly: false, needsRun: false, fallback: "condense <name> [--dry-run]", usageLine: "condense <name> [--dry-run]" },
  { id: 'replay', words: ['replay'], summaryKey: 'summary.replay', helpKey: 'help.replay', flags: [], positional: [], readOnly: true, needsRun: false, fallback: "replay", usageLine: "replay" },
]

/** Resolve a parsed command to its declaration: the longest `words` prefix wins. */
export function hostCommandDefForCommand(command: { readonly name: string; readonly positionals: readonly string[] }): HostCommandDef | undefined {
  let found: HostCommandDef | undefined
  for (const def of HOST_COMMAND_DEFS) {
    const matches = def.words.every((word, index) => (index === 0 ? command.name : command.positionals[index - 1]) === word)
    if (matches && (found === undefined || def.words.length > found.words.length)) found = def
  }
  return found
}

/** Resolve one single-token command name to its declaration. */
export function hostCommandDefForName(name: string): HostCommandDef | undefined {
  return HOST_COMMAND_DEFS.find(def => def.words.length === 1 && def.words[0] === name)
}
