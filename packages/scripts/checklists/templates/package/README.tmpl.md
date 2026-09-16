# @deepseek-ai/dsh-<pkg>

<One line: what this package owns, and what it deliberately does not.>

## Model surface

<!-- Three facts, one line each. Say "nothing of its own" when the package only
     serves other rows — do not restate the family-level prefix/cache rules:
     they are single-sourced in packages/README.md and cited here. -->

- **Model-visible:** <nothing of its own (consumers own the injection) | the exact
  injection and what it is attached to>
- **Prompt prefix / KV cache:** <unchanged by this package | the exact effect>;
  the family-level rules are single-sourced in `packages/README.md`
  §"Model-visible prompt prefix and the KV cache".
- **Mount it?** <yes — the row this package contributes, and to which bundles |
  no — a library/seam consumed by <consumers>>

## Configuration

<!-- Only when the package declares config keys. One row or line per key:
     key — values/default — what changes. Delete the section when it has none. -->

## Known limitations

- <A limitation a user must know, with its mechanism and its workaround.>

**Runtime invariant:** No companion is published. The platform auto-assembles
nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion
here would never execute (v37 S2.1 / I-3).

## Notes and history

<!-- Optional. Only when the package's behaviour is explained by a version-stamped
     decision or audit finding: move those sentences here VERBATIM (do not
     rewrite them) so the sections above stay about today's behaviour. Delete the
     section when there is nothing to move. -->

- <version-stamped sentence, copied as-is>
