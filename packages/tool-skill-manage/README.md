# @lmzhen/dsh-tool-skill-manage

Model-facing `skill_manage` tool for reading and mutating reusable skills. It ships in `all` and the layered/full model-tool presets, not in host-only.

## Actions

`review`, `list`, `create`, `edit`, `update`, `patch`, `delete`, `write_file`, `remove_file`, `restructure`, `extract`, `pin`, and `unpin`.

Create/edit/update take a complete `SKILL.md`; patch replaces the first anchor unless `replace_all=true`. Support files are addressed by `file_path`. Restructure moves a body section into a support file; extract moves a reusable part into an existing owner skill. Delete archives to `.archive`, with `absorbed_into` recording an umbrella where applicable.

Created or edited skill files require valid YAML frontmatter. Protected bundled/hub skills reject mutation; pinned skills reject deletion and are read-only to background review.

## Write controls

The four authoring caps are tighten-only at the user layer: `skillContentChars`, `maxSkillFileBytes`, `maxSkillNameLength`, and `maxDescriptionLength`. `descriptionStrict`, `strictCrossSource`, citation/reference policy, support-file policy, version retention, and threat exemptions are described in [PARAMETERS.md](../PARAMETERS.md).

`skillWriteConfirm` defaults to `auto`, so unattended runs do not park on a question. `ask` waits for an answer; `timeout` cancels after `skillWriteConfirmTimeoutSeconds`. Ordinary approval can instead return a `pending_id` for replay through the approval service.

History keeps the configured number of content versions per skill. Older version entries leave the index, but their stored blobs currently have no automatic sweep, so long-lived libraries can retain historical bytes.

`maxSkillContentChars` remains a readable deprecated alias of `skillContentChars`; writes to the old name are refused.
