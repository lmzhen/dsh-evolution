# New preset base (`--base`)

**When to use:** you are adding a `--base` value — a new row in the **one** table
(`packages/evolution-agent/bases.json`) that the installer, the
`/evolution preset install` command and the docs all read, so a base cannot be
half-added.

Skeleton: `templates/base/bases-row.json.tmpl`.

## Checklist

- [ ] Add the row to `packages/evolution-agent/bases.json`: `name` (the
      `--base` value = the platform composition directory = the installed preset
      id source), `id` (the `.agent-presets/<id>/` directory), `metadata`
      (the `preset.<name>.yml` file you ship next to it).
- [ ] If the platform composition needs a service the family does not mount, say
      so in the row: `requires: { service: '<platformService>' }`. If the base
      cannot work at all, register `unsupported: '<reason>'` instead of leaving
      it out — a base the table omits is a base nobody refuses. — *both install
      paths must refuse it by name BEFORE any write: `install-layered.mjs` and
      `evolution-commands` share `baseUnavailableReason()` (the 0.3.78 TDZ
      incident: the refusal used to run before `profileDir` existed).*
- [ ] Ship the metadata file (`preset.<name>.yml`) beside `agent.cordis.yml`.
- [ ] Update the table in the fact's home, `evolution-agent/README.md`
      §Preset variants — the doc and `bases.json` are checked against each other.
      — *`verify-doc-facts.mjs` (N19 `preset-bases`) fails a base the home does
      not state, a precondition it does not mention, and any doc that denies a
      registered base ("there is no cordis base" was exactly that drift).*
- [ ] Parity: `AGENT_PRESET_BASES` must still equal the table and its first key
      must be `default`. — *`evolution-host/tests/installer-preset-base.spec.ts`.*
- [ ] Command path: `/evolution preset install --base <name>` writes that base's
      variant. — *`evolution-commands/tests/commands.spec.ts`.*
- [ ] Composition of the generated preset: no delta row may collide with the
      platform composition, and the cap injection must run for the new base too.
      — *the row-collision fail-loud and the byte-parity fixture in
      `installer.spec.ts`.*
- [ ] One real-machine run on the validated platform line
      (`--mode variant --base <name>`, then `dsh --profile <p> --dump-config`)
      before claiming the base works.
- [ ] No new `--base` value anywhere else in the docs. — *`verify-doc-facts.mjs`
      fails a `--base <x>` the table does not carry.*
